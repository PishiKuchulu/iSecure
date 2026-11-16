package com.isecure.app;

import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Arrays;

/**
 * Minimal native bridge for the in-app updater:
 *  - verifySigner: fail-closed same-certificate check between a downloaded
 *    APK and the installed app (the Anvex updater rule).
 *  - install: hands a verified APK to the system package installer via the
 *    app's FileProvider, routing through the "Install unknown apps"
 *    settings screen first when that permission is off.
 */
@CapacitorPlugin(name = "ApkInstaller")
public class ApkInstallerPlugin extends Plugin {

    private File toFile(String path) {
        if (path == null) return null;
        if (path.startsWith("file://")) {
            String p = Uri.parse(path).getPath();
            return p == null ? null : new File(p);
        }
        return new File(path);
    }

    private Signature[] signaturesOf(PackageInfo info) {
        if (Build.VERSION.SDK_INT >= 28) {
            if (info.signingInfo == null) return null;
            return info.signingInfo.getApkContentsSigners();
        }
        return info.signatures;
    }

    @PluginMethod
    public void verifySigner(PluginCall call) {
        File file = toFile(call.getString("path"));
        if (file == null || !file.exists()) {
            call.reject("APK file not found");
            return;
        }
        try {
            PackageManager pm = getContext().getPackageManager();
            int flags = Build.VERSION.SDK_INT >= 28
                ? PackageManager.GET_SIGNING_CERTIFICATES
                : PackageManager.GET_SIGNATURES;
            PackageInfo archive = pm.getPackageArchiveInfo(file.getAbsolutePath(), flags);
            PackageInfo installed = pm.getPackageInfo(getContext().getPackageName(), flags);
            if (archive == null || installed == null) {
                call.reject("Could not read package signing info");
                return;
            }
            Signature[] a = signaturesOf(archive);
            Signature[] b = signaturesOf(installed);
            boolean matches = a != null && b != null && Arrays.equals(a, b);
            JSObject ret = new JSObject();
            ret.put("matches", matches);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Signer verification failed: " + e.getMessage());
        }
    }

    private void notifyProgress(String url, long bytes, long total) {
        JSObject data = new JSObject();
        data.put("url", url);
        data.put("bytes", bytes);
        data.put("contentLength", total);
        notifyListeners("downloadProgress", data);
    }

    /**
     * Download a file into the app cache directory with plain
     * HttpURLConnection, following redirects manually. Native HTTP is not
     * subject to WebView CORS rules, so hosts that redirect to a CDN
     * without CORS headers (GitHub release assets) work here even though
     * a WebView fetch() to the same URL fails. Emits "downloadProgress"
     * events roughly every 256 KB.
     */
    @PluginMethod
    public void download(PluginCall call) {
        String url = call.getString("url");
        String fileName = call.getString("fileName");
        if (url == null || fileName == null) {
            call.reject("url and fileName are required");
            return;
        }
        File dest = new File(getContext().getCacheDir(), fileName);
        new Thread(() -> {
            HttpURLConnection conn = null;
            try {
                String current = url;
                for (int hop = 0; hop <= 5; hop++) {
                    URL u = new URL(current);
                    conn = (HttpURLConnection) u.openConnection();
                    conn.setInstanceFollowRedirects(false);
                    conn.setConnectTimeout(30000);
                    conn.setReadTimeout(60000);
                    conn.setRequestProperty("User-Agent", "iSecure-Updater");
                    int code = conn.getResponseCode();
                    if (code >= 300 && code < 400) {
                        String loc = conn.getHeaderField("Location");
                        conn.disconnect();
                        conn = null;
                        if (loc == null) throw new IOException("Redirect without Location");
                        current = new URL(u, loc).toString();
                        continue;
                    }
                    if (code != HttpURLConnection.HTTP_OK) {
                        throw new IOException("HTTP " + code);
                    }
                    long total = conn.getContentLengthLong();
                    try (InputStream in = conn.getInputStream();
                         FileOutputStream out = new FileOutputStream(dest)) {
                        byte[] buf = new byte[64 * 1024];
                        long done = 0;
                        long lastNotify = 0;
                        int n;
                        while ((n = in.read(buf)) != -1) {
                            out.write(buf, 0, n);
                            done += n;
                            if (done - lastNotify >= 256 * 1024) {
                                lastNotify = done;
                                notifyProgress(url, done, total);
                            }
                        }
                    }
                    notifyProgress(url, dest.length(), total > 0 ? total : dest.length());
                    JSObject ret = new JSObject();
                    ret.put("path", dest.getAbsolutePath());
                    call.resolve(ret);
                    return;
                }
                throw new IOException("Too many redirects");
            } catch (Exception e) {
                if (dest.exists()) {
                    // Never leave a partial download behind.
                    dest.delete();
                }
                call.reject("Download failed: " + e.getMessage());
            } finally {
                if (conn != null) conn.disconnect();
            }
        }).start();
    }

    @PluginMethod
    public void install(PluginCall call) {
        File file = toFile(call.getString("path"));
        if (file == null || !file.exists()) {
            call.reject("APK file not found");
            return;
        }
        if (Build.VERSION.SDK_INT >= 26
            && !getContext().getPackageManager().canRequestPackageInstalls()) {
            Intent settings = new Intent(
                Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:" + getContext().getPackageName()));
            settings.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(settings);
            call.reject(
                "Allow installs from iSecure, then tap Install again.",
                "INSTALL_PERMISSION");
            return;
        }
        try {
            Uri uri = FileProvider.getUriForFile(
                getContext(),
                getContext().getPackageName() + ".fileprovider",
                file);
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(uri, "application/vnd.android.package-archive");
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
                | Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not open the installer: " + e.getMessage());
        }
    }
}
