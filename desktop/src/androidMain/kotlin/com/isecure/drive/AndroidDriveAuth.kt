package com.isecure.drive

import android.app.Activity
import androidx.activity.ComponentActivity
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import com.google.android.gms.auth.api.identity.AuthorizationRequest
import com.google.android.gms.auth.api.identity.AuthorizationResult
import com.google.android.gms.auth.api.identity.Identity
import com.google.android.gms.common.api.Scope
import com.isecure.core.platform.DriveAuthProvider
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * Google Drive authorization — the Kotlin port of the Capacitor
 * GoogleDriveAuth plugin. The Firebase popup flow cannot run inside an
 * app UI (its handler escapes and is rejected), so this uses the Google
 * Identity Authorization API to obtain an OAuth access token for the
 * drive.file scope directly. The token is returned to the caller and
 * kept strictly in memory there.
 *
 * Requires the app's package + signing SHA-1 to be registered in the
 * Firebase/GCP project (an Android OAuth client must exist server-side)
 * — already done for com.isecure.app with the release key.
 */
class AndroidDriveAuth(private val activity: ComponentActivity) : DriveAuthProvider {

    companion object {
        const val DRIVE_FILE_SCOPE =
            "https://www.googleapis.com/auth/drive.file"
    }

    private var pendingToken: CompletableDeferred<String>? = null

    private val launcher = activity.registerForActivityResult(
        ActivityResultContracts.StartIntentSenderForResult(),
    ) { result ->
        val deferred = pendingToken
        pendingToken = null
        if (deferred == null) return@registerForActivityResult
        val data = result.data
        if (result.resultCode != Activity.RESULT_OK || data == null) {
            deferred.completeExceptionally(
                Exception("Google sign-in was cancelled."),
            )
            return@registerForActivityResult
        }
        try {
            val authResult = Identity.getAuthorizationClient(activity)
                .getAuthorizationResultFromIntent(data)
            val token = authResult.accessToken
            if (token.isNullOrEmpty()) {
                deferred.completeExceptionally(
                    Exception("Google did not return an access token."),
                )
            } else {
                deferred.complete(token)
            }
        } catch (e: Exception) {
            deferred.completeExceptionally(
                Exception("Google sign-in failed: ${e.message}"),
            )
        }
    }

    override suspend fun authorize(): String {
        val request = AuthorizationRequest.builder()
            .setRequestedScopes(listOf(Scope(DRIVE_FILE_SCOPE)))
            .build()
        val result = suspendCancellableCoroutine<AuthorizationResult> { cont ->
            Identity.getAuthorizationClient(activity)
                .authorize(request)
                .addOnSuccessListener { if (cont.isActive) cont.resume(it) }
                .addOnFailureListener {
                    if (cont.isActive) {
                        cont.resumeWithException(
                            Exception("Google authorization failed: ${it.message}"),
                        )
                    }
                }
        }
        if (!result.hasResolution()) {
            return result.accessToken?.takeIf { it.isNotEmpty() }
                ?: throw Exception("Google did not return an access token.")
        }
        if (pendingToken != null) {
            throw Exception("A Google sign-in is already in progress.")
        }
        val pendingIntent = result.pendingIntent
            ?: throw Exception("Google sign-in did not provide a resolution.")
        val deferred = CompletableDeferred<String>()
        pendingToken = deferred
        try {
            launcher.launch(
                IntentSenderRequest.Builder(
                    pendingIntent.intentSender,
                ).build(),
            )
        } catch (e: Exception) {
            pendingToken = null
            throw Exception("Could not open Google sign-in: ${e.message}")
        }
        return deferred.await()
    }
}
