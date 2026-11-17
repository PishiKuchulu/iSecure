package com.isecure.biometric

import android.content.Context
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import com.isecure.core.platform.BiometricService
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import java.nio.charset.StandardCharsets
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import kotlin.coroutines.resume

/**
 * Fingerprint unlock — the Kotlin port of the Capacitor
 * BiometricUnlock plugin. The master secret itself is stored,
 * encrypted with an AES-256-GCM key that lives in the Android Keystore
 * and is bound to biometric authentication (every single use requires a
 * fresh biometric check via the prompt's CryptoObject). Only the
 * ciphertext + IV are kept, in app-private SharedPreferences. The
 * plaintext is released exclusively inside the biometric success
 * callback.
 *
 * Some devices (notably several Xiaomi/MIUI builds) report their
 * fingerprint sensor as BIOMETRIC_WEAK even though it is enrolled and
 * works. STRONG is preferred wherever the device offers it; the class
 * falls back to WEAK so the feature exists at all there.
 */
class AndroidBiometric(private val activity: FragmentActivity) : BiometricService {

    companion object {
        private const val KEY_ALIAS = "isecure_biometric_key"
        private const val PREFS = "isecure_biometric"
        private const val PREF_IV = "iv"
        private const val PREF_CT = "ct"
    }

    private val context: Context get() = activity

    private fun prefs() =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private fun strongAvailable(): Boolean =
        BiometricManager.from(context).canAuthenticate(
            BiometricManager.Authenticators.BIOMETRIC_STRONG,
        ) == BiometricManager.BIOMETRIC_SUCCESS

    override fun isAvailable(): Boolean =
        strongAvailable() ||
            BiometricManager.from(context).canAuthenticate(
                BiometricManager.Authenticators.BIOMETRIC_WEAK,
            ) == BiometricManager.BIOMETRIC_SUCCESS

    override fun hasStoredSecret(): Boolean =
        prefs().getString(PREF_CT, null) != null

    private fun promptAuthenticators(): Int =
        if (strongAvailable()) {
            BiometricManager.Authenticators.BIOMETRIC_STRONG
        } else {
            BiometricManager.Authenticators.BIOMETRIC_WEAK
        }

    private fun getOrCreateKey(): SecretKey {
        val keyStore = KeyStore.getInstance("AndroidKeyStore")
        keyStore.load(null)
        if (keyStore.containsAlias(KEY_ALIAS)) {
            return keyStore.getKey(KEY_ALIAS, null) as SecretKey
        }
        val builder = KeyGenParameterSpec.Builder(
            KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .setUserAuthenticationRequired(true)
        if (Build.VERSION.SDK_INT >= 30 && strongAvailable()) {
            // 0 = authentication required for every use of the key.
            builder.setUserAuthenticationParameters(
                0, KeyProperties.AUTH_BIOMETRIC_STRONG,
            )
        } else {
            // Per-use authentication via the prompt's CryptoObject; also
            // the only option when the sensor is classified WEAK.
            builder.setUserAuthenticationValidityDurationSeconds(-1)
        }
        val generator = KeyGenerator.getInstance(
            KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore",
        )
        generator.init(builder.build())
        return generator.generateKey()
    }

    /** Runs the prompt with the prepared cipher; resumes with the
     *  decrypted secret (retrieve), true (store), or null/false on any
     *  cancel or error. */
    private suspend fun runPrompt(
        cipher: Cipher,
        encrypting: Boolean,
        plainText: String?,
        title: String,
        subtitle: String,
        cancelLabel: String,
    ): String? = withContext(Dispatchers.Main) {
        suspendCancellableCoroutine { cont ->
            val executor = ContextCompat.getMainExecutor(context)
            val prompt = BiometricPrompt(
                activity,
                executor,
                object : BiometricPrompt.AuthenticationCallback() {
                    override fun onAuthenticationError(
                        errorCode: Int,
                        errString: CharSequence,
                    ) {
                        if (cont.isActive) cont.resume(null)
                    }

                    override fun onAuthenticationSucceeded(
                        result: BiometricPrompt.AuthenticationResult,
                    ) {
                        if (!cont.isActive) return
                        try {
                            val authed = result.cryptoObject?.cipher
                            if (authed == null) {
                                cont.resume(null)
                                return
                            }
                            if (encrypting) {
                                val ct = authed.doFinal(
                                    plainText!!.toByteArray(StandardCharsets.UTF_8),
                                )
                                prefs().edit()
                                    .putString(
                                        PREF_IV,
                                        Base64.encodeToString(
                                            authed.iv, Base64.NO_WRAP,
                                        ),
                                    )
                                    .putString(
                                        PREF_CT,
                                        Base64.encodeToString(
                                            ct, Base64.NO_WRAP,
                                        ),
                                    )
                                    .apply()
                                cont.resume("")
                            } else {
                                val stored = prefs().getString(PREF_CT, null)
                                if (stored == null) {
                                    cont.resume(null)
                                    return
                                }
                                val plain = authed.doFinal(
                                    Base64.decode(stored, Base64.NO_WRAP),
                                )
                                cont.resume(
                                    String(plain, StandardCharsets.UTF_8),
                                )
                            }
                        } catch (e: Exception) {
                            if (cont.isActive) cont.resume(null)
                        }
                    }
                },
            )
            val info = BiometricPrompt.PromptInfo.Builder()
                .setTitle(title)
                .setSubtitle(subtitle)
                .setNegativeButtonText(cancelLabel)
                .setAllowedAuthenticators(promptAuthenticators())
                .build()
            prompt.authenticate(info, BiometricPrompt.CryptoObject(cipher))
        }
    }

    override suspend fun storeSecret(
        secret: String,
        title: String,
        subtitle: String,
        cancelLabel: String,
    ): Boolean {
        if (secret.isEmpty()) return false
        val cipher = try {
            Cipher.getInstance("AES/GCM/NoPadding").apply {
                init(Cipher.ENCRYPT_MODE, getOrCreateKey())
            }
        } catch (e: Exception) {
            return false
        }
        return runPrompt(cipher, true, secret, title, subtitle, cancelLabel) != null
    }

    override suspend fun retrieveSecret(
        title: String,
        subtitle: String,
        cancelLabel: String,
    ): String? {
        val ivB64 = prefs().getString(PREF_IV, null)
        val ctB64 = prefs().getString(PREF_CT, null)
        if (ivB64 == null || ctB64 == null) return null
        val cipher = try {
            Cipher.getInstance("AES/GCM/NoPadding").apply {
                init(
                    Cipher.DECRYPT_MODE,
                    getOrCreateKey(),
                    GCMParameterSpec(128, Base64.decode(ivB64, Base64.NO_WRAP)),
                )
            }
        } catch (e: Exception) {
            return null
        }
        return runPrompt(cipher, false, null, title, subtitle, cancelLabel)
    }

    override fun clearSecret() {
        prefs().edit().clear().apply()
        try {
            val keyStore = KeyStore.getInstance("AndroidKeyStore")
            keyStore.load(null)
            if (keyStore.containsAlias(KEY_ALIAS)) {
                keyStore.deleteEntry(KEY_ALIAS)
            }
        } catch (e: Exception) {
            // Best effort: without the ciphertext the key alone is useless.
        }
    }
}
