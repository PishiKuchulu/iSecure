package com.isecure.desktop

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.window.Window
import androidx.compose.ui.window.application
import com.isecure.core.platform.ClipboardService
import com.isecure.core.platform.FileVaultStore
import com.isecure.core.platform.JvmRandomSource
import com.isecure.core.platform.PlatformKind
import com.isecure.core.platform.PlatformServices
import com.isecure.core.platform.PropertiesSettingsStore
import com.isecure.core.platform.RandomSource
import com.isecure.core.platform.SettingsStore
import com.isecure.core.platform.VaultStore
import com.isecure.ui.ISecureApp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.awt.Toolkit
import java.awt.datatransfer.DataFlavor
import java.awt.datatransfer.StringSelection
import java.io.File

/** Per-OS application data directory (vault file + settings live here). */
fun desktopDataDir(): File {
    val os = System.getProperty("os.name").lowercase()
    val home = File(System.getProperty("user.home"))
    return when {
        os.contains("win") -> {
            val appData = System.getenv("APPDATA")
            if (appData != null) File(appData, "iSecure") else File(home, "iSecure")
        }
        os.contains("mac") ->
            File(home, "Library/Application Support/iSecure")
        else -> {
            val xdg = System.getenv("XDG_DATA_HOME")
            if (xdg != null) File(xdg, "isecure") else File(home, ".local/share/isecure")
        }
    }
}

class AwtClipboardService : ClipboardService {
    override fun copy(text: String) {
        Toolkit.getDefaultToolkit().systemClipboard
            .setContents(StringSelection(text), null)
    }

    override fun currentText(): String? = try {
        val clipboard = Toolkit.getDefaultToolkit().systemClipboard
        if (clipboard.isDataFlavorAvailable(DataFlavor.stringFlavor)) {
            clipboard.getData(DataFlavor.stringFlavor) as? String
        } else {
            null
        }
    } catch (e: Exception) {
        null
    }

    override fun clear() {
        Toolkit.getDefaultToolkit().systemClipboard
            .setContents(StringSelection(""), null)
    }
}

class SwingFileExchange : com.isecure.core.platform.FileExchange {
    override suspend fun saveTextFile(
        suggestedName: String,
        content: String,
    ): Boolean = withContext(Dispatchers.IO) {
        val chooser = javax.swing.JFileChooser()
        chooser.selectedFile = File(suggestedName)
        if (chooser.showSaveDialog(null) != javax.swing.JFileChooser.APPROVE_OPTION) {
            return@withContext false
        }
        chooser.selectedFile.writeText(content, Charsets.UTF_8)
        true
    }

    override suspend fun openTextFile(): String? = withContext(Dispatchers.IO) {
        val chooser = javax.swing.JFileChooser()
        if (chooser.showOpenDialog(null) != javax.swing.JFileChooser.APPROVE_OPTION) {
            return@withContext null
        }
        chooser.selectedFile.readText(Charsets.UTF_8)
    }
}

class DesktopServices(baseDir: File) : PlatformServices {
    override val vaultStore: VaultStore = FileVaultStore(baseDir)
    override val settingsStore: SettingsStore =
        PropertiesSettingsStore(File(baseDir, "settings.properties"))
    override val clipboard: ClipboardService = AwtClipboardService()
    override val random: RandomSource = JvmRandomSource()
    override val cipher: com.isecure.core.crypto.VaultCipher =
        com.isecure.core.crypto.JvmVaultCipher
    override val fileExchange: com.isecure.core.platform.FileExchange =
        SwingFileExchange()
    override val httpTransport: com.isecure.core.platform.HttpTransport =
        com.isecure.core.platform.JvmHttpTransport()
    // Desktop Drive sign-in (system browser + loopback OAuth) and the
    // desktop updater arrive in the desktop phase; the sections stay
    // hidden while these are null.
    override val driveAuth: com.isecure.core.platform.DriveAuthProvider? = null
    override val biometric: com.isecure.core.platform.BiometricService? = null
    override val updater: com.isecure.core.platform.UpdateService? = null
    override val platformKind: PlatformKind = PlatformKind.DESKTOP
}

@Composable
private fun rememberDesktopServices(): DesktopServices =
    remember { DesktopServices(desktopDataDir()) }

fun main() = application {
    val services = rememberDesktopServices()
    Window(onCloseRequest = ::exitApplication, title = "iSecure") {
        ISecureApp(services)
    }
}
