package com.isecure.update

import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.content.pm.Signature
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import com.isecure.core.platform.HttpTransport
import com.isecure.core.platform.InstallResult
import com.isecure.core.platform.JvmHttpTransport
import com.isecure.core.platform.UpdateCheckResult
import com.isecure.core.platform.UpdateService
import com.isecure.core.update.UpdateFeed
import com.isecure.core.update.UpdateInfo
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.net.HttpURLConnection
import java.net.URI
import java.security.MessageDigest

/**
 * In-app updater — the Kotlin port of the Capacitor updater chain
 * (updateLogic.ts + ApkInstaller plugin + the Cloudflare feed).
 *
 * Trust chain: the manifest is fetched only from the feed origin and
 * strictly validated by UpdateFeed; the APK streams from the same
 * origin with a hard size cap (4x the manifest size, enforced while
 * streaming — the AUD-010 fix); the downloaded bytes must hash to the
 * manifest SHA-256 and the archive's signer certificate must match the
 * installed app's signer exactly (fail-closed, like Anvex). Install is
 * handed to the system installer via FileProvider.
 */
class AndroidUpdater(private val context: Context) : UpdateService {

    private val transport: HttpTransport = JvmHttpTransport()

    override fun currentVersion(): String = try {
        @Suppress("DEPRECATION")
        context.packageManager.getPackageInfo(context.packageName, 0)
            .versionName ?: "0.0.0"
    } catch (e: Exception) {
        "0.0.0"
    }

    override suspend fun checkForUpdate(): UpdateCheckResult {
        // AUD-017: failures are reported, never collapsed into a null
        // that the UI cannot distinguish from "no update available".
        val res = try {
            transport.request("GET", UpdateFeed.MANIFEST_URL)
        } catch (e: Exception) {
            return UpdateCheckResult.Failed(e.message)
        }
        if (res.status !in 200..299) {
            return UpdateCheckResult.Failed(
                "Update feed returned HTTP ${res.status}",
            )
        }
        UpdateFeed.parseManifest(res.body)
            ?: return UpdateCheckResult.Failed("Update feed manifest was invalid")
        val available = UpdateFeed.availableUpdate(res.body, currentVersion())
        return if (available != null) {
            UpdateCheckResult.Available(available)
        } else {
            UpdateCheckResult.UpToDate
        }
    }

    override suspend fun downloadAndVerify(
        info: UpdateInfo,
        onProgress: (Int) -> Unit,
    ): String = withContext(Dispatchers.IO) {
        val dir = File(context.cacheDir, "updates").apply { mkdirs() }
        val target = File(dir, info.fileName)
        val capBytes = info.sizeBytes * 4
        val digest = MessageDigest.getInstance("SHA-256")
        var total = 0L
        val connection =
            URI(info.downloadUrl).toURL().openConnection() as HttpURLConnection
        try {
            connection.connectTimeout = 30_000
            connection.readTimeout = 60_000
            connection.instanceFollowRedirects = true
            if (connection.responseCode !in 200..299) {
                throw Exception("Download failed (${connection.responseCode})")
            }
            connection.inputStream.use { input ->
                target.outputStream().use { output ->
                    val buffer = ByteArray(64 * 1024)
                    while (true) {
                        val read = input.read(buffer)
                        if (read < 0) break
                        total += read
                        if (total > capBytes) {
                            throw Exception("Download exceeded the size cap")
                        }
                        digest.update(buffer, 0, read)
                        output.write(buffer, 0, read)
                        if (info.sizeBytes > 0) {
                            val pct = (total * 100 / info.sizeBytes)
                                .toInt().coerceIn(0, 100)
                            withContext(Dispatchers.Main) { onProgress(pct) }
                        }
                    }
                }
            }
        } catch (e: Exception) {
            target.delete()
            throw e
        } finally {
            connection.disconnect()
        }
        if (total != info.sizeBytes) {
            target.delete()
            throw Exception("Downloaded size does not match the manifest")
        }
        val hex = digest.digest().joinToString("") { "%02x".format(it) }
        if (!hex.equals(info.sha256, ignoreCase = true)) {
            target.delete()
            throw Exception("SHA-256 mismatch")
        }
        if (!signerMatches(target)) {
            target.delete()
            throw Exception("Update signer does not match the installed app")
        }
        target.absolutePath
    }

    private fun signaturesOf(info: PackageInfo?): Set<String> {
        if (info == null) return emptySet()
        val signatures: Array<Signature> = if (Build.VERSION.SDK_INT >= 28) {
            info.signingInfo?.apkContentsSigners ?: emptyArray()
        } else {
            @Suppress("DEPRECATION")
            info.signatures ?: emptyArray()
        }
        return signatures.map { signature ->
            MessageDigest.getInstance("SHA-256")
                .digest(signature.toByteArray())
                .joinToString("") { "%02x".format(it) }
        }.toSet()
    }

    private fun signerMatches(apk: File): Boolean {
        val flags = if (Build.VERSION.SDK_INT >= 28) {
            PackageManager.GET_SIGNING_CERTIFICATES
        } else {
            @Suppress("DEPRECATION")
            PackageManager.GET_SIGNATURES
        }
        val archive = context.packageManager
            .getPackageArchiveInfo(apk.absolutePath, flags)
        val installed = try {
            context.packageManager.getPackageInfo(context.packageName, flags)
        } catch (e: Exception) {
            null
        }
        val archiveSigners = signaturesOf(archive)
        val installedSigners = signaturesOf(installed)
        return archiveSigners.isNotEmpty() &&
            installedSigners.isNotEmpty() &&
            archiveSigners == installedSigners
    }

    override fun install(path: String): InstallResult {
        if (Build.VERSION.SDK_INT >= 26 &&
            !context.packageManager.canRequestPackageInstalls()
        ) {
            val settings = Intent(
                Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:${context.packageName}"),
            ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(settings)
            return InstallResult.NEEDS_PERMISSION
        }
        val uri = FileProvider.getUriForFile(
            context,
            "${context.packageName}.fileprovider",
            File(path),
        )
        val intent = Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(
                Intent.FLAG_GRANT_READ_URI_PERMISSION or
                    Intent.FLAG_ACTIVITY_NEW_TASK,
            )
        context.startActivity(intent)
        return InstallResult.STARTED
    }
}
