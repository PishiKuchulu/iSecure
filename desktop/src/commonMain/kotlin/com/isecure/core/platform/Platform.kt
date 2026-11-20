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

/** Save/open dialogs for backup export/import. Desktop shows Swing
 *  dialogs; Android uses the Storage Access Framework. Suspend because
 *  the Android implementation completes asynchronously; null hides the
 *  buttons. */
interface FileExchange {
    suspend fun saveTextFile(suggestedName: String, content: String): Boolean
    suspend fun openTextFile(): String?
}

/** Minimal HTTP transport so the Drive REST layer and the update-feed
 *  check can live in common code with fake-transport unit tests. The
 *  JVM implementation (HttpURLConnection) serves both current targets. */
interface HttpTransport {
    suspend fun request(
        method: String,
        url: String,
        headers: Map<String, String> = emptyMap(),
        body: ByteArray? = null,
    ): HttpResponse
}

data class HttpResponse(val status: Int, val body: String)

/** Signed-in Google profile (email + display name only — the UI never
 *  needs more). Mirrors DriveUserProfile in the web edition. */
data class DriveUserProfile(val email: String?, val displayName: String?)

/**
 * Obtains a Google OAuth access token carrying the drive.file scope.
 * Android implements this with the Google Identity Authorization API
 * (the port of the Capacitor GoogleDriveAuth plugin); the token itself
 * is kept strictly in memory by the caller, never persisted.
 */
interface DriveAuthProvider {
    suspend fun authorize(): String
}

/**
 * Biometric-guarded storage of the master secret (the port of the
 * Capacitor BiometricUnlock plugin): the secret is stored as
 * AES-256-GCM ciphertext under an Android Keystore key that requires a
 * fresh biometric authentication for every use, and the plaintext is
 * released only inside the prompt's success callback.
 */
interface BiometricService {
    fun isAvailable(): Boolean
    fun hasStoredSecret(): Boolean
    suspend fun storeSecret(
        secret: String,
        title: String,
        subtitle: String,
        cancelLabel: String,
    ): Boolean

    /** The stored secret after a successful prompt, or null on
     *  cancel/error/no-secret. */
    suspend fun retrieveSecret(
        title: String,
        subtitle: String,
        cancelLabel: String,
    ): String?

    fun clearSecret()
}

enum class InstallResult { STARTED, NEEDS_PERMISSION }

/** Outcome of an update check (AUD-017). The UI must be able to tell
 *  "up to date" and "check failed" apart from "update available" — a
 *  bare nullable UpdateInfo collapses all three into silence. */
sealed interface UpdateCheckResult {
    data class Available(
        val info: com.isecure.core.update.UpdateInfo,
    ) : UpdateCheckResult

    data object UpToDate : UpdateCheckResult

    data class Failed(val message: String?) : UpdateCheckResult
}

/** In-app updater (Android; the port of the Capacitor updater chain):
 *  feed check → native download with a size cap → SHA-256 → same-signer
 *  verification → system installer handoff. */
interface UpdateService {
    fun currentVersion(): String
    suspend fun checkForUpdate(): UpdateCheckResult
    suspend fun downloadAndVerify(
        info: com.isecure.core.update.UpdateInfo,
        onProgress: (Int) -> Unit,
    ): String

    fun install(path: String): InstallResult
}

enum class PlatformKind { DESKTOP, ANDROID }

interface PlatformServices {
    val vaultStore: VaultStore
    val settingsStore: SettingsStore
    val clipboard: ClipboardService
    val random: RandomSource
    val cipher: com.isecure.core.crypto.VaultCipher
    val fileExchange: FileExchange?
    val httpTransport: HttpTransport
    val driveAuth: DriveAuthProvider?
    val biometric: BiometricService?
    val updater: UpdateService?
    val platformKind: PlatformKind
}
