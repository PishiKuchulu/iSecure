package com.isecure.app;

import android.app.Activity;
import android.view.Window;
import android.view.WindowManager;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Bridge for the screenshot-protection setting (AUD-006): the Settings
 * toggle genuinely controls the OS-level FLAG_SECURE window flag instead
 * of only the web watermark. MainActivity sets FLAG_SECURE at startup
 * (secure by default, before settings load); this bridge applies the
 * user's saved choice once settings are available and on every change.
 */
@CapacitorPlugin(name = "AppSecurity")
public class AppSecurityPlugin extends Plugin {

    @PluginMethod
    public void setScreenshotProtection(PluginCall call) {
        Boolean enabled = call.getBoolean("enabled");
        if (enabled == null) {
            call.reject("enabled is required");
            return;
        }
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("No activity");
            return;
        }
        activity.runOnUiThread(() -> {
            Window window = activity.getWindow();
            if (enabled) {
                window.addFlags(WindowManager.LayoutParams.FLAG_SECURE);
            } else {
                window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
            }
            call.resolve();
        });
    }
}
