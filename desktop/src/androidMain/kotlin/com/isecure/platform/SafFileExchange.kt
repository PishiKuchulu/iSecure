package com.isecure.platform

import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import com.isecure.core.platform.FileExchange
import kotlinx.coroutines.CompletableDeferred

/**
 * Backup export/import through the Storage Access Framework — the
 * Android counterpart of the desktop Swing dialogs. The launchers are
 * registered at construction (in MainActivity.onCreate, before the
 * activity is started, as the activity-result API requires); each call
 * suspends until the user picks a location or cancels.
 */
class SafFileExchange(private val activity: ComponentActivity) : FileExchange {

    private var pendingContent: String = ""
    private var saveDeferred: CompletableDeferred<Boolean>? = null
    private var openDeferred: CompletableDeferred<String?>? = null

    private val saveLauncher = activity.registerForActivityResult(
        ActivityResultContracts.CreateDocument("application/json"),
    ) { uri ->
        val deferred = saveDeferred
        saveDeferred = null
        if (deferred == null) return@registerForActivityResult
        if (uri == null) {
            deferred.complete(false)
            return@registerForActivityResult
        }
        val ok = try {
            activity.contentResolver.openOutputStream(uri)?.use { stream ->
                stream.write(pendingContent.encodeToByteArray())
            } != null
        } catch (e: Exception) {
            false
        }
        deferred.complete(ok)
    }

    private val openLauncher = activity.registerForActivityResult(
        ActivityResultContracts.OpenDocument(),
    ) { uri ->
        val deferred = openDeferred
        openDeferred = null
        if (deferred == null) return@registerForActivityResult
        if (uri == null) {
            deferred.complete(null)
            return@registerForActivityResult
        }
        val text = try {
            activity.contentResolver.openInputStream(uri)?.use { stream ->
                stream.readBytes().decodeToString()
            }
        } catch (e: Exception) {
            null
        }
        deferred.complete(text)
    }

    override suspend fun saveTextFile(
        suggestedName: String,
        content: String,
    ): Boolean {
        if (saveDeferred != null) return false
        pendingContent = content
        val deferred = CompletableDeferred<Boolean>()
        saveDeferred = deferred
        saveLauncher.launch(suggestedName)
        return deferred.await()
    }

    override suspend fun openTextFile(): String? {
        if (openDeferred != null) return null
        val deferred = CompletableDeferred<String?>()
        openDeferred = deferred
        openLauncher.launch(arrayOf("application/json", "text/plain", "*/*"))
        return deferred.await()
    }
}
