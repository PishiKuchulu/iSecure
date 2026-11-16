package com.isecure.app;

import android.os.Bundle;
import android.view.WindowManager;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Local plugin backing the in-app updater (signer check + install).
        registerPlugin(ApkInstallerPlugin.class);
        super.onCreate(savedInstanceState);
        // iSecure is a password manager: block screenshots, screen
        // recording and recent-apps thumbnails of vault content at OS level.
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
    }
}
