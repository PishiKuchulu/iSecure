package com.isecure.core.platform

/** Randomness for IDs, salts and the password generator. The secure
 *  integer algorithm itself (rejection sampling) lives in common code;
 *  platforms only supply raw bytes from their CSPRNG. */
interface RandomSource {
    fun nextBytes(count: Int): ByteArray
}

/** The encrypted vault envelope file. On Android this is the SAME
 *  relative path the Capacitor build used (vault/pishisecure_vault_v2.json
 *  under the app files dir), so an in-place upgrade keeps the vault. */
interface VaultStore {
    fun exists(): Boolean
    fun readText(): String?
    fun writeText(text: String)
    fun delete()
}

/** Plain key-value settings (theme, language, timers) — never secrets. */
interface SettingsStore {
    fun get(key: String): String?
    fun put(key: String, value: String)
    fun remove(key: String)
}

interface ClipboardService {
    fun copy(text: String)
    fun currentText(): String?
    fun clear()
}

/** Blocking save/open dialogs for backup export/import. Desktop only
 *  for now (Android gets the Storage Access Framework in a later
 *  phase); null hides the buttons. */
interface FileExchange {
    fun saveTextFile(suggestedName: String, content: String): Boolean
    fun openTextFile(): String?
}

enum class PlatformKind { DESKTOP, ANDROID }

interface PlatformServices {
    val vaultStore: VaultStore
    val settingsStore: SettingsStore
    val clipboard: ClipboardService
    val random: RandomSource
    val cipher: com.isecure.core.crypto.VaultCipher
    val fileExchange: FileExchange?
    val platformKind: PlatformKind
}
