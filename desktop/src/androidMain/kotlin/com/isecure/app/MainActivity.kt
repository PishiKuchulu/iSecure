package com.isecure.app

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import com.isecure.core.platform.ClipboardService
import com.isecure.core.platform.FileVaultStore
import com.isecure.core.platform.JvmRandomSource
import com.isecure.core.platform.PlatformKind
import com.isecure.core.platform.PlatformServices
import com.isecure.core.platform.RandomSource
import com.isecure.core.platform.SettingsStore
import com.isecure.core.platform.VaultStore
import com.isecure.ui.ISecureApp

class SharedPrefsSettingsStore(context: Context) : SettingsStore {
    private val prefs =
        context.getSharedPreferences("isecure_settings", Context.MODE_PRIVATE)

    override fun get(key: String): String? = prefs.getString(key, null)

    override fun put(key: String, value: String) {
        prefs.edit().putString(key, value).apply()
    }

    override fun remove(key: String) {
        prefs.edit().remove(key).apply()
    }
}

class AndroidClipboardService(context: Context) : ClipboardService {
    private val manager =
        context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager

    override fun copy(text: String) {
        manager.setPrimaryClip(ClipData.newPlainText("iSecure", text))
    }

    override fun currentText(): String? {
        val clip = manager.primaryClip ?: return null
        if (clip.itemCount == 0) return null
        return clip.getItemAt(0).coerceToText(null)?.toString()
    }

    override fun clear() {
        manager.setPrimaryClip(ClipData.newPlainText("", ""))
    }
}

class AndroidServices(context: Context) : PlatformServices {
    // filesDir matches Capacitor's Directory.Data, so the vault file the
    // current app wrote (vault/pishisecure_vault_v2.json) is picked up
    // in place on upgrade.
    override val vaultStore: VaultStore = FileVaultStore(context.filesDir)
    override val settingsStore: SettingsStore = SharedPrefsSettingsStore(context)
    override val clipboard: ClipboardService = AndroidClipboardService(context)
    override val random: RandomSource = JvmRandomSource()
    override val cipher: com.isecure.core.crypto.VaultCipher =
        com.isecure.core.crypto.JvmVaultCipher
    // SAF file picker arrives with the Android port phase.
    override val fileExchange: com.isecure.core.platform.FileExchange? = null
    override val platformKind: PlatformKind = PlatformKind.ANDROID
}

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Same always-on screenshot protection as the Capacitor build.
        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        val services = AndroidServices(applicationContext)
        setContent {
            ISecureApp(services)
        }
    }
}
