package com.isecure.core.state

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.isecure.core.crypto.VaultCipher
import com.isecure.core.i18n.Strings
import com.isecure.core.i18n.stringsFor
import com.isecure.core.logic.VaultLogic
import com.isecure.core.model.EncryptedVaultEnvelope
import com.isecure.core.model.PasswordHistoryItem
import com.isecure.core.model.VaultEntry
import com.isecure.core.model.VaultPayload
import com.isecure.core.platform.PlatformServices
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.datetime.Clock
import kotlinx.datetime.Instant

enum class VaultScreen { LOADING, SETUP, UNLOCK, MAIN, CORRUPT }

enum class MainTab { VAULT, GENERATOR, AUDIT, TRASH, SETTINGS }

data class AppSettings(
    val theme: String = "system",
    val language: String = "en",
    val autoLockMinutes: Int = 5,
    val clipboardClearSeconds: Int = 30,
)

/**
 * The whole vault session, mirroring the web App.tsx semantics:
 * session key + salt live only in memory; every mutation re-encrypts
 * and persists; the stored-envelope reference only advances after a
 * successful write (the P-02 lesson); a corrupt store never falls into
 * setup (the P-03 lesson).
 */
class VaultAppState(
    private val services: PlatformServices,
    private val scope: CoroutineScope,
) {
    var screen by mutableStateOf(VaultScreen.LOADING)
        private set
    var tab by mutableStateOf(MainTab.VAULT)
    var settings by mutableStateOf(AppSettings())
        private set
    var entries by mutableStateOf<List<VaultEntry>>(emptyList())
        private set
    var customCategories by mutableStateOf<List<String>>(emptyList())
        private set
    var lastBackupTime by mutableStateOf<String?>(null)
        private set
    var saveError by mutableStateOf<String?>(null)
        private set
    var unlockError by mutableStateOf(false)
        private set
    var isBusy by mutableStateOf(false)
        private set

    private var storedEnvelope: EncryptedVaultEnvelope? = null
    private var sessionKey: ByteArray? = null
    private var sessionSalt: String? = null
    private var sessionIterations: Int = VaultCipher.DEFAULT_ITERATIONS
    private var lastActivity: Instant = Clock.System.now()
    private var autoLockSuppressedUntilMs: Long = 0
    private var lastCopied: String? = null
    private var clipboardJob: Job? = null

    val strings: Strings get() = stringsFor(settings.language)
    val isUnlocked: Boolean get() = screen == VaultScreen.MAIN

    /** CSPRNG for the generator tab (platform-provided). */
    val random: com.isecure.core.platform.RandomSource get() = services.random

    /** Backup export/import is offered only where the platform has a
     *  file picker (desktop dialogs, Android SAF). */
    val fileExchangeAvailable: Boolean get() = services.fileExchange != null

    suspend fun saveBackupFile(content: String): Boolean {
        // The picker round trip is user-paced; the vault must not
        // auto-lock while it is open (the Capacitor edition learned
        // this with its suppression window).
        suppressAutoLock(180)
        return services.fileExchange
            ?.saveTextFile("pishisecure-backup.json", content) ?: false
    }

    suspend fun openBackupFile(): String? {
        suppressAutoLock(180)
        return services.fileExchange?.openTextFile()
    }

    fun initialize() {
        settings = AppSettings(
            theme = services.settingsStore.get("theme") ?: "system",
            language = services.settingsStore.get("language") ?: "en",
            autoLockMinutes = services.settingsStore.get("autoLockMinutes")?.toIntOrNull() ?: 5,
            clipboardClearSeconds = services.settingsStore.get("clipboardClearSeconds")?.toIntOrNull() ?: 30,
        )
        biometricEnabled =
            services.settingsStore.get("biometricEnabled") == "1"
        if (!services.vaultStore.exists()) {
            screen = VaultScreen.SETUP
            return
        }
        val raw = services.vaultStore.readText()
        val parsed = raw?.let { services.cipher.parseEnvelope(it) }
        if (parsed == null) {
            // A vault exists but cannot be parsed — NEVER offer setup
            // here; that would overwrite the stored bytes (P-03).
            screen = VaultScreen.CORRUPT
            return
        }
        storedEnvelope = parsed
        screen = VaultScreen.UNLOCK
    }

    fun updateSettings(next: AppSettings) {
        settings = next
        services.settingsStore.put("theme", next.theme)
        services.settingsStore.put("language", next.language)
        services.settingsStore.put("autoLockMinutes", next.autoLockMinutes.toString())
        services.settingsStore.put("clipboardClearSeconds", next.clipboardClearSeconds.toString())
        touch()
    }

    suspend fun setupVault(secret: String) {
        isBusy = true
        try {
            // PBKDF2 at 600k iterations is CPU work — keep it off the UI
            // thread on both platforms.
            val payload = VaultPayload()
            val envelope = withContext(Dispatchers.Default) {
                services.cipher.encryptPayload(payload, secret)
            }
            services.vaultStore.writeText(services.cipher.envelopeToJson(envelope))
            val (_, key) = withContext(Dispatchers.Default) {
                services.cipher.decryptEnvelopeWithKey(envelope, secret)
            }
            beginSession(envelope, key, payload)
        } finally {
            isBusy = false
        }
    }

    suspend fun unlock(secret: String): Boolean {
        val envelope = storedEnvelope ?: return false
        isBusy = true
        unlockError = false
        return try {
            val (payload, key) = withContext(Dispatchers.Default) {
                services.cipher.decryptEnvelopeWithKey(envelope, secret)
            }
            // 30-day trash purge on unlock, like the web app.
            val purged = VaultLogic.purgeExpiredTrash(payload.entries, Clock.System.now())
            val effective = payload.copy(entries = purged)
            beginSession(envelope, key, effective)
            if (purged.size != payload.entries.size) {
                persist()
            }
            true
        } catch (e: Exception) {
            unlockError = true
            false
        } finally {
            isBusy = false
        }
    }

    private fun beginSession(
        envelope: EncryptedVaultEnvelope,
        key: ByteArray,
        payload: VaultPayload,
    ) {
        storedEnvelope = envelope
        sessionKey = key
        sessionSalt = envelope.salt
        sessionIterations = envelope.iterations
        entries = payload.entries
        customCategories = payload.customCategories
        lastBackupTime = payload.lastBackupTime
        tab = MainTab.VAULT
        screen = VaultScreen.MAIN
        touch()
    }

    fun lock() {
        clearClipboardIfOurs()
        sessionKey = null
        sessionSalt = null
        entries = emptyList()
        customCategories = emptyList()
        lastBackupTime = null
        unlockError = false
        screen = if (storedEnvelope != null) VaultScreen.UNLOCK else VaultScreen.SETUP
    }

    /** Two-step confirmed factory reset from the corrupt screen. */
    fun eraseCorruptVault() {
        services.vaultStore.delete()
        storedEnvelope = null
        // The stored biometric copy of the master secret must not
        // survive a factory reset.
        services.biometric?.clearSecret()
        biometricEnabled = false
        services.settingsStore.remove("biometricEnabled")
        screen = VaultScreen.SETUP
    }

    fun touch() {
        lastActivity = Clock.System.now()
    }

    /** External flows (Google consent, file picker, installer) take the
     *  user out of the app for an unbounded moment; while the deadline
     *  runs, auto-lock is held off so the vault cannot lock mid-flow. */
    fun suppressAutoLock(seconds: Long) {
        autoLockSuppressedUntilMs = maxOf(
            autoLockSuppressedUntilMs,
            Clock.System.now().toEpochMilliseconds() + seconds * 1_000L,
        )
    }

    fun checkAutoLock() {
        if (!isUnlocked || settings.autoLockMinutes <= 0) return
        if (Clock.System.now().toEpochMilliseconds() <
            autoLockSuppressedUntilMs
        ) {
            return
        }
        val elapsedMs = Clock.System.now().toEpochMilliseconds() -
            lastActivity.toEpochMilliseconds()
        if (elapsedMs >= settings.autoLockMinutes * 60_000L) {
            lock()
        }
    }

    private fun persist() {
        val key = sessionKey ?: return
        val salt = sessionSalt ?: return
        val payload = VaultPayload(entries, customCategories, lastBackupTime)
        try {
            val envelope = services.cipher.encryptPayloadWithKey(
                payload, key, salt, sessionIterations,
            )
            services.vaultStore.writeText(services.cipher.envelopeToJson(envelope))
            storedEnvelope = envelope
            saveError = null
        } catch (e: Exception) {
            // Never silent (P-02): the UI shows this as a banner.
            saveError = e.message ?: "Save failed"
        }
    }

    fun dismissSaveError() {
        saveError = null
    }

    // ---- Entry operations (App.tsx semantics) ----

    fun addEntry(draft: VaultEntry) {
        val now = Clock.System.now().toString()
        val entry = draft.copy(
            id = VaultLogic.generateSecureId(services.random, "item"),
            createdDate = now,
            modifiedDate = now,
            isTrash = false,
            deletedAt = null,
            history = emptyList(),
        )
        entries = listOf(entry) + entries
        persist()
        touch()
    }

    fun editEntry(id: String, updated: VaultEntry) {
        val now = Clock.System.now().toString()
        entries = entries.map { entry ->
            if (entry.id != id) return@map entry
            val history = entry.history.toMutableList()
            val newSecret = updated.password
            if (!newSecret.isNullOrEmpty() &&
                newSecret != entry.password &&
                !entry.password.isNullOrEmpty()
            ) {
                history.add(
                    PasswordHistoryItem(
                        id = VaultLogic.generateSecureId(services.random, "hist"),
                        password = entry.password,
                        changedAt = now,
                    ),
                )
            }
            updated.copy(
                id = entry.id,
                createdDate = entry.createdDate,
                isTrash = entry.isTrash,
                deletedAt = entry.deletedAt,
                history = history,
                modifiedDate = now,
            )
        }
        persist()
        touch()
    }

    fun trashEntry(id: String) {
        val now = Clock.System.now().toString()
        entries = entries.map {
            if (it.id == id) it.copy(isTrash = true, deletedAt = now) else it
        }
        persist()
        touch()
    }

    fun restoreEntry(id: String) {
        entries = entries.map {
            if (it.id == id) it.copy(isTrash = false, deletedAt = null) else it
        }
        persist()
        touch()
    }

    fun deleteForever(id: String) {
        entries = entries.filter { it.id != id }
        persist()
        touch()
    }

    fun purgeTrash() {
        entries = entries.filter { !it.isTrash }
        persist()
        touch()
    }

    fun addCategory(name: String) {
        val trimmed = name.trim()
        if (trimmed.isEmpty() || trimmed in customCategories) return
        customCategories = customCategories + trimmed
        persist()
        touch()
    }

    // ---- Clipboard (auto-clear, clear-on-lock) ----

    fun copySecret(text: String) {
        services.clipboard.copy(text)
        lastCopied = text
        clipboardJob?.cancel()
        val seconds = settings.clipboardClearSeconds
        if (seconds > 0) {
            clipboardJob = scope.launch {
                delay(seconds * 1_000L)
                clearClipboardIfOurs()
            }
        }
        touch()
    }

    fun clearClipboardIfOurs() {
        val copied = lastCopied ?: return
        if (services.clipboard.currentText() == copied) {
            services.clipboard.clear()
        }
        lastCopied = null
    }

    // ---- Local backup export / import ----

    fun exportEnvelopeJson(): String? =
        storedEnvelope?.let { services.cipher.envelopeToJson(it) }

    /** Merge a decrypted backup into the open vault: per id, the newer
     *  modifiedDate wins; categories union. Returns false when the
     *  backup secret is wrong or the file is not a valid envelope. */
    suspend fun importBackup(jsonText: String, backupSecret: String): Boolean {
        val envelope = services.cipher.parseEnvelope(jsonText) ?: return false
        val imported = try {
            withContext(Dispatchers.Default) {
                services.cipher.decryptEnvelope(envelope, backupSecret)
            }
        } catch (e: Exception) {
            return false
        }
        val byId = entries.associateBy { it.id }.toMutableMap()
        for (candidate in imported.entries) {
            val existing = byId[candidate.id]
            if (existing == null || candidate.modifiedDate > existing.modifiedDate) {
                byId[candidate.id] = candidate
            }
        }
        entries = byId.values.sortedByDescending { it.modifiedDate }
        val mergedCategories = customCategories.toMutableList()
        for (category in imported.customCategories) {
            if (category !in mergedCategories) mergedCategories.add(category)
        }
        customCategories = mergedCategories
        persist()
        touch()
        return true
    }

    // ---- Biometric unlock (Android) ----

    var biometricEnabled by mutableStateOf(false)
        private set

    val biometricSupported: Boolean
        get() = services.biometric?.isAvailable() == true

    /** Offered on the unlock screen only when the feature is on and a
     *  secret is actually stored. */
    val biometricUnlockAvailable: Boolean
        get() = biometricEnabled &&
            services.biometric?.hasStoredSecret() == true

    suspend fun unlockWithBiometric(): Boolean {
        val biometric = services.biometric ?: return false
        val secret = biometric.retrieveSecret(
            strings.biometricPromptTitle,
            strings.biometricPromptSubtitle,
            strings.cancel,
        ) ?: return false
        val ok = unlock(secret)
        if (!ok) {
            // The stored copy no longer opens this vault (e.g. the
            // vault was re-created): wipe it instead of failing forever,
            // like the Capacitor edition does.
            disableBiometric()
            unlockError = false
        }
        return ok
    }

    /** Enabling requires proving the typed secret opens the current
     *  vault first, then a biometric prompt seals it. */
    suspend fun enableBiometric(secret: String): Boolean {
        val biometric = services.biometric ?: return false
        val envelope = storedEnvelope ?: return false
        val opens = try {
            withContext(Dispatchers.Default) {
                services.cipher.decryptEnvelope(envelope, secret)
            }
            true
        } catch (e: Exception) {
            false
        }
        if (!opens) return false
        val stored = biometric.storeSecret(
            secret,
            strings.biometricPromptTitle,
            strings.biometricPromptSubtitle,
            strings.cancel,
        )
        if (stored) {
            biometricEnabled = true
            services.settingsStore.put("biometricEnabled", "1")
        }
        return stored
    }

    fun disableBiometric() {
        services.biometric?.clearSecret()
        biometricEnabled = false
        services.settingsStore.remove("biometricEnabled")
    }

    // ---- Google Drive backup (Android) ----

    private val driveService =
        com.isecure.core.drive.DriveBackupService(services.httpTransport)

    var driveUser by mutableStateOf<
        com.isecure.core.platform.DriveUserProfile?>(null)
        private set
    var driveBusy by mutableStateOf(false)
        private set
    var driveBackups by mutableStateOf<
        List<com.isecure.core.drive.DriveBackupFile>>(emptyList())
        private set
    var driveError by mutableStateOf<String?>(null)
        private set

    /** Strictly in memory (zero-knowledge design): every app start
     *  begins signed out until the user taps sign-in. */
    private var driveToken: String? = null

    val driveSupported: Boolean get() = services.driveAuth != null
    val driveSignedIn: Boolean get() = driveToken != null

    private fun onDriveFailure(e: Exception) {
        if (e is com.isecure.core.drive.DriveAuthExpiredException) {
            driveToken = null
            driveUser = null
            driveBackups = emptyList()
        }
        driveError = e.message ?: "Google Drive request failed"
    }

    suspend fun signInToDrive() {
        val auth = services.driveAuth ?: return
        suppressAutoLock(180)
        driveBusy = true
        driveError = null
        try {
            val token = kotlinx.coroutines.withTimeoutOrNull(90_000) {
                auth.authorize()
            } ?: throw Exception("Google sign-in timed out. Please try again.")
            driveToken = token
            driveUser = driveService.fetchProfile(token)
            refreshDriveBackups()
        } catch (e: Exception) {
            onDriveFailure(e)
        } finally {
            driveBusy = false
        }
    }

    suspend fun signOutFromDrive() {
        val token = driveToken
        driveToken = null
        driveUser = null
        driveBackups = emptyList()
        driveError = null
        if (token != null) driveService.revoke(token)
    }

    suspend fun refreshDriveBackups() {
        val token = driveToken ?: return
        try {
            driveBackups = driveService.listBackups(token)
        } catch (e: Exception) {
            onDriveFailure(e)
        }
    }

    suspend fun backupToDrive() {
        val token = driveToken ?: return
        val envelopeJson = exportEnvelopeJson() ?: return
        driveBusy = true
        driveError = null
        try {
            driveService.uploadBackup(token, envelopeJson)
            lastBackupTime = Clock.System.now().toString()
            persist()
            refreshDriveBackups()
        } catch (e: Exception) {
            onDriveFailure(e)
        } finally {
            driveBusy = false
        }
    }

    /** The raw envelope JSON of a Drive backup, fed into the same
     *  secret-prompted merge flow as a local file import. */
    suspend fun downloadDriveBackup(
        file: com.isecure.core.drive.DriveBackupFile,
    ): String? {
        val token = driveToken ?: return null
        driveBusy = true
        driveError = null
        return try {
            driveService.downloadBackup(token, file.id)
        } catch (e: Exception) {
            onDriveFailure(e)
            null
        } finally {
            driveBusy = false
        }
    }

    suspend fun deleteDriveBackup(
        file: com.isecure.core.drive.DriveBackupFile,
    ) {
        val token = driveToken ?: return
        driveBusy = true
        driveError = null
        try {
            driveService.deleteBackup(token, file.id)
            refreshDriveBackups()
        } catch (e: Exception) {
            onDriveFailure(e)
        } finally {
            driveBusy = false
        }
    }

    // ---- In-app updates (Android) ----

    var updateInfo by mutableStateOf<
        com.isecure.core.update.UpdateInfo?>(null)
        private set
    var updateBusy by mutableStateOf(false)
        private set
    var updateProgress by mutableStateOf<Int?>(null)
        private set
    var updateError by mutableStateOf<String?>(null)
        private set

    val updaterSupported: Boolean get() = services.updater != null
    val appVersion: String get() = services.updater?.currentVersion() ?: "0.1.0"

    suspend fun checkForUpdate() {
        val updater = services.updater ?: return
        updateBusy = true
        updateError = null
        try {
            updateInfo = updater.checkForUpdate()
        } catch (e: Exception) {
            updateError = e.message
        } finally {
            updateBusy = false
        }
    }

    suspend fun downloadAndInstallUpdate() {
        val updater = services.updater ?: return
        val info = updateInfo ?: return
        updateError = null
        updateProgress = 0
        try {
            val path = updater.downloadAndVerify(info) { progress ->
                updateProgress = progress
            }
            suppressAutoLock(180)
            updater.install(path)
        } catch (e: Exception) {
            updateError = e.message ?: "Update failed"
        } finally {
            updateProgress = null
        }
    }

    companion object {
        val ENTRY_TYPES = listOf(
            "website", "email", "bank", "social", "gaming", "crypto",
            "license", "note", "custom",
        )
        val DEFAULT_CATEGORIES = listOf(
            "website", "email", "bank", "social", "gaming", "crypto",
            "license", "note", "custom",
        )
    }
}
