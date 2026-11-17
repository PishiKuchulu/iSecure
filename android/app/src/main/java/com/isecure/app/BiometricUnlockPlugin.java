package com.isecure.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import androidx.annotation.NonNull;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.FragmentActivity;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.concurrent.Executor;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Fingerprint unlock for the vault.
 *
 * The master secret itself is stored, encrypted with an AES-256-GCM key
 * that lives in the Android Keystore and is bound to biometric
 * authentication (every single use requires a fresh biometric check via
 * the prompt's CryptoObject). Only the ciphertext + IV are kept, in
 * app-private SharedPreferences. The plaintext is released exclusively
 * inside the biometric success callback, so neither the WebView nor any
 * other app can read it without the user's fingerprint.
 */
@CapacitorPlugin(name = "BiometricUnlock")
public class BiometricUnlockPlugin extends Plugin {

    private static final String KEY_ALIAS = "isecure_biometric_key";
    private static final String PREFS = "isecure_biometric";
    private static final String PREF_IV = "iv";
    private static final String PREF_CT = "ct";

    private PluginCall pendingCall;

    /**
     * Some devices (notably several Xiaomi/MIUI builds) report their
     * fingerprint sensor as BIOMETRIC_WEAK even though it is enrolled
     * and works. STRONG is preferred wherever the device offers it; the
     * plugin falls back to WEAK so the feature exists at all there.
     */
    private boolean strongAvailable() {
        return BiometricManager.from(getContext())
            .canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG)
            == BiometricManager.BIOMETRIC_SUCCESS;
    }

    private boolean anyBiometricAvailable() {
        return strongAvailable()
            || BiometricManager.from(getContext())
                .canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_WEAK)
                == BiometricManager.BIOMETRIC_SUCCESS;
    }

    private int promptAuthenticators() {
        return strongAvailable()
            ? BiometricManager.Authenticators.BIOMETRIC_STRONG
            : BiometricManager.Authenticators.BIOMETRIC_WEAK;
    }

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private SecretKey getOrCreateKey() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        if (ks.containsAlias(KEY_ALIAS)) {
            return (SecretKey) ks.getKey(KEY_ALIAS, null);
        }
        KeyGenParameterSpec.Builder builder = new KeyGenParameterSpec.Builder(
            KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .setUserAuthenticationRequired(true);
        if (Build.VERSION.SDK_INT >= 30 && strongAvailable()) {
            // 0 = authentication required for every use of the key.
            builder.setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG);
        } else {
            // Per-use authentication via the prompt's CryptoObject; also
            // the only option when the sensor is classified WEAK.
            builder.setUserAuthenticationValidityDurationSeconds(-1);
        }
        KeyGenerator kg = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        kg.init(builder.build());
        return kg.generateKey();
    }

    private BiometricPrompt.PromptInfo promptInfo(PluginCall call) {
        String title = call.getString("title", "iSecure");
        String subtitle = call.getString("subtitle", "");
        String cancel = call.getString("cancelLabel", "Cancel");
        return new BiometricPrompt.PromptInfo.Builder()
            .setTitle(title)
            .setSubtitle(subtitle)
            .setNegativeButtonText(cancel)
            .setAllowedAuthenticators(promptAuthenticators())
            .build();
    }

    private void showPrompt(PluginCall call, Cipher cipher, boolean encrypting, String plainText) {
        FragmentActivity activity = (FragmentActivity) getActivity();
        Executor executor = ContextCompat.getMainExecutor(getContext());
        pendingCall = call;
        BiometricPrompt prompt = new BiometricPrompt(activity, executor,
            new BiometricPrompt.AuthenticationCallback() {
                @Override
                public void onAuthenticationError(int errorCode, @NonNull CharSequence errString) {
                    PluginCall c = pendingCall;
                    pendingCall = null;
                    if (c == null) return;
                    String code = (errorCode == BiometricPrompt.ERROR_USER_CANCELED
                        || errorCode == BiometricPrompt.ERROR_NEGATIVE_BUTTON
                        || errorCode == BiometricPrompt.ERROR_CANCELED)
                        ? "CANCELLED" : "ERROR";
                    c.reject(errString.toString(), code);
                }

                @Override
                public void onAuthenticationSucceeded(@NonNull BiometricPrompt.AuthenticationResult result) {
                    PluginCall c = pendingCall;
                    pendingCall = null;
                    if (c == null) return;
                    try {
                        Cipher authed = result.getCryptoObject() == null ? null : result.getCryptoObject().getCipher();
                        if (authed == null) {
                            c.reject("Missing crypto object", "ERROR");
                            return;
                        }
                        if (encrypting) {
                            byte[] ct = authed.doFinal(plainText.getBytes(StandardCharsets.UTF_8));
                            prefs().edit()
                                .putString(PREF_IV, Base64.encodeToString(authed.getIV(), Base64.NO_WRAP))
                                .putString(PREF_CT, Base64.encodeToString(ct, Base64.NO_WRAP))
                                .apply();
                            c.resolve();
                        } else {
                            String stored = prefs().getString(PREF_CT, null);
                            if (stored == null) {
                                c.reject("No stored secret", "NO_SECRET");
                                return;
                            }
                            byte[] plain = authed.doFinal(Base64.decode(stored, Base64.NO_WRAP));
                            JSObject ret = new JSObject();
                            ret.put("value", new String(plain, StandardCharsets.UTF_8));
                            c.resolve(ret);
                        }
                    } catch (Exception e) {
                        c.reject("Biometric operation failed: " + e.getMessage(), "ERROR");
                    }
                }

                @Override
                public void onAuthenticationFailed() {
                    // A single non-matching attempt; the system prompt stays
                    // open and manages retries/lockout itself.
                }
            });
        new Handler(Looper.getMainLooper()).post(() ->
            prompt.authenticate(promptInfo(call), new BiometricPrompt.CryptoObject(cipher)));
    }

    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("available", anyBiometricAvailable());
        call.resolve(ret);
    }

    @PluginMethod
    public void hasStored(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("stored", prefs().getString(PREF_CT, null) != null);
        call.resolve(ret);
    }

    @PluginMethod
    public void storeSecret(PluginCall call) {
        String value = call.getString("value");
        if (value == null || value.isEmpty()) {
            call.reject("Nothing to store", "ERROR");
            return;
        }
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey());
            showPrompt(call, cipher, true, value);
        } catch (Exception e) {
            call.reject("Could not prepare biometric storage: " + e.getMessage(), "ERROR");
        }
    }

    @PluginMethod
    public void retrieveSecret(PluginCall call) {
        String ivB64 = prefs().getString(PREF_IV, null);
        String ctB64 = prefs().getString(PREF_CT, null);
        if (ivB64 == null || ctB64 == null) {
            call.reject("No stored secret", "NO_SECRET");
            return;
        }
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            byte[] iv = Base64.decode(ivB64, Base64.NO_WRAP);
            cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), new GCMParameterSpec(128, iv));
            showPrompt(call, cipher, false, null);
        } catch (Exception e) {
            call.reject("Could not prepare biometric unlock: " + e.getMessage(), "ERROR");
        }
    }

    @PluginMethod
    public void clearSecret(PluginCall call) {
        prefs().edit().clear().apply();
        try {
            KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
            ks.load(null);
            if (ks.containsAlias(KEY_ALIAS)) ks.deleteEntry(KEY_ALIAS);
        } catch (Exception ignored) {
            // Best effort: without the ciphertext the key alone is useless.
        }
        call.resolve();
    }
}
