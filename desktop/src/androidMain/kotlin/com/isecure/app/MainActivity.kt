package com.isecure.app

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.compose.setContent
import androidx.fragment.app.FragmentActivity
import com.isecure.biometric.AndroidBiometric
import com.isecure.core.platform.BiometricService
import com.isecure.core.platform.ClipboardService
import com.isecure.core.platform.DriveAuthProvider
import com.isecure.core.platform.FileExchange
import com.isecure.core.platform.FileVaultStore
import com.isecure.core.platform.HttpTransport
import com.isecure.core.platform.JvmHttpTransport
import com.isecure.core.platform.JvmRandomSource
import com.isecure.core.platform.PlatformKind
import com.isecure.core.platform.PlatformServices
import com.isecure.core.platform.RandomSource
import com.isecure.core.platform.SettingsStore
import com.isecure.core.platform.UpdateService
import com.isecure.core.platform.VaultStore
import com.isecure.drive.AndroidDriveAuth
import com.isecure.platform.SafFileExchange
import com.isecure.ui.ISecureApp
import com.isecure.update.AndroidUpdater

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

/**
 * The Android platform services. The activity-bound services (Drive
 * authorization, biometric prompt, SAF file exchange) register their
 * activity-result launchers at construction, so this must be created
 * in onCreate before setContent. The activity is a FragmentActivity
 * because BiometricPrompt requires one (it still extends
 * ComponentActivity, so setContent works unchanged).
 */
class AndroidServices(activity: FragmentActivity) : PlatformServices {
    private val appContext: Context = activity.applicationContext

    // filesDir matches Capacitor's Directory.Data, so the vault file the
    // current app wrote (vault/pishisecure_vault_v2.json) is picked up
    // in place on upgrade.
    override val vaultStore: VaultStore = FileVaultStore(appContext.filesDir)
    override val settingsStore: SettingsStore = SharedPrefsSettingsStore(appContext)
    override val clipboard: ClipboardService = AndroidClipboardService(appContext)
    override val random: RandomSource = JvmRandomSource()
    override val cipher: com.isecure.core.crypto.VaultCipher =
        com.isecure.core.crypto.JvmVaultCipher
    override val fileExchange: FileExchange = SafFileExchange(activity)
    override val httpTransport: HttpTransport = JvmHttpTransport()
    override val driveAuth: DriveAuthProvider = AndroidDriveAuth(activity)
    override val biometric: BiometricService = AndroidBiometric(activity)
    override val updater: UpdateService = AndroidUpdater(appContext)
    override val platformKind: PlatformKind = PlatformKind.ANDROID
}

class MainActivity : FragmentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Same always-on screenshot protection as the Capacitor build.
        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        val services = AndroidServices(this)
        setContent {
            ISecureApp(services)
        }
    }
}
