package com.isecure.core.platform

import java.io.File
import java.nio.file.AtomicMoveNotSupportedException
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.security.SecureRandom
import java.util.Properties

class JvmRandomSource : RandomSource {
    private val secureRandom = SecureRandom()
    override fun nextBytes(count: Int): ByteArray =
        ByteArray(count).also { secureRandom.nextBytes(it) }
}

/** Vault envelope as a file under [baseDir]/vault/ — the same relative
 *  layout the Capacitor build used, so existing vaults are picked up. */
class FileVaultStore(private val baseDir: File) : VaultStore {
    private val vaultFile: File
        get() = File(File(baseDir, "vault"), "pishisecure_vault_v2.json")

    override fun exists(): Boolean = vaultFile.isFile

    override fun readText(): String? =
        if (vaultFile.isFile) vaultFile.readText(Charsets.UTF_8) else null

    override fun writeText(text: String) {
        vaultFile.parentFile?.mkdirs()
        // Write-then-move so a crash mid-write cannot truncate the vault.
        // Files.move with ATOMIC_MOVE replaces the destination atomically
        // on the same filesystem — including on Windows, where
        // File.renameTo refuses to replace an existing file and the old
        // fallback (a direct overwrite of the only vault copy) was the
        // routine path (AUD-016). There is deliberately no overwrite
        // fallback: if the move fails, the exception propagates (callers
        // surface it as a persist error) and the old vault file is left
        // untouched.
        val tmp = File(vaultFile.parentFile, vaultFile.name + ".tmp")
        tmp.writeText(text, Charsets.UTF_8)
        try {
            Files.move(
                tmp.toPath(), vaultFile.toPath(),
                StandardCopyOption.ATOMIC_MOVE,
                StandardCopyOption.REPLACE_EXISTING,
            )
        } catch (e: AtomicMoveNotSupportedException) {
            Files.move(
                tmp.toPath(), vaultFile.toPath(),
                StandardCopyOption.REPLACE_EXISTING,
            )
        }
    }

    override fun delete() {
        vaultFile.delete()
        File(vaultFile.parentFile, vaultFile.name + ".tmp").delete()
    }
}

/** Desktop settings as a properties file (Android uses SharedPreferences). */
class PropertiesSettingsStore(private val file: File) : SettingsStore {
    private fun load(): Properties {
        val props = Properties()
        if (file.isFile) {
            file.inputStream().use { props.load(it) }
        }
        return props
    }

    private fun save(props: Properties) {
        file.parentFile?.mkdirs()
        file.outputStream().use { props.store(it, "iSecure settings") }
    }

    override fun get(key: String): String? = load().getProperty(key)

    override fun put(key: String, value: String) {
        val props = load()
        props.setProperty(key, value)
        save(props)
    }

    override fun remove(key: String) {
        val props = load()
        props.remove(key)
        save(props)
    }
}
