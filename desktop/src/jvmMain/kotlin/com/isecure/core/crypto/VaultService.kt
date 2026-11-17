package com.isecure.core.crypto

import com.isecure.core.model.EncryptedVaultEnvelope
import com.isecure.core.model.VaultPayload
import kotlinx.serialization.json.Json

/**
 * Envelope encrypt/decrypt, mirroring encryptVaultPayload /
 * decryptVaultEnvelope in src/crypto.ts.
 */
object VaultService {
    // explicitNulls = false matches JSON.stringify dropping `undefined`
    // fields; encodeDefaults keeps every present field on the wire.
    val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
        explicitNulls = false
    }

    fun encryptPayload(
        payload: VaultPayload,
        masterSecret: String,
        iterations: Int = VaultCrypto.DEFAULT_KDF_ITERATIONS,
    ): EncryptedVaultEnvelope {
        val salt = VaultCrypto.generateSalt()
        val key = VaultCrypto.deriveKey(masterSecret, salt, iterations)
        val iv = VaultCrypto.generateIv()
        val plaintext = json.encodeToString(VaultPayload.serializer(), payload)
        val ciphertext = VaultCrypto.aesGcmEncrypt(
            key,
            iv,
            plaintext.toByteArray(Charsets.UTF_8),
        )
        return EncryptedVaultEnvelope(
            version = 2,
            kdf = "PBKDF2-SHA256",
            iterations = iterations,
            salt = VaultCrypto.bytesToBase64(salt),
            iv = VaultCrypto.bytesToBase64(iv),
            ciphertext = VaultCrypto.bytesToBase64(ciphertext),
        )
    }

    /** @throws IllegalArgumentException on an invalid envelope;
     *  AEADBadTagException on a wrong master secret or tampered data. */
    fun decryptEnvelope(
        envelope: EncryptedVaultEnvelope,
        masterSecret: String,
    ): VaultPayload = decryptEnvelopeWithKey(envelope, masterSecret).first

    /** Decrypt and also return the derived key, so an unlocked session
     *  can re-encrypt with the SAME salt (exactly like the web app's
     *  session key + salt refs). */
    fun decryptEnvelopeWithKey(
        envelope: EncryptedVaultEnvelope,
        masterSecret: String,
    ): Pair<VaultPayload, ByteArray> {
        require(envelope.isValid()) { "Not a valid iSecure vault envelope." }
        val salt = VaultCrypto.base64ToBytes(envelope.salt)
        val iv = VaultCrypto.base64ToBytes(envelope.iv)
        val ciphertext = VaultCrypto.base64ToBytes(envelope.ciphertext)
        val key = VaultCrypto.deriveKey(masterSecret, salt, envelope.iterations)
        val plaintext = VaultCrypto.aesGcmDecrypt(key, iv, ciphertext)
        val payload = json.decodeFromString(
            VaultPayload.serializer(),
            plaintext.toString(Charsets.UTF_8),
        )
        return payload to key
    }

    /** Re-encrypt a payload under an existing session key + salt (fresh
     *  IV every time) — the persist path while the vault is unlocked. */
    fun encryptPayloadWithKey(
        payload: VaultPayload,
        key: ByteArray,
        saltBase64: String,
        iterations: Int,
    ): EncryptedVaultEnvelope {
        val iv = VaultCrypto.generateIv()
        val plaintext = json.encodeToString(VaultPayload.serializer(), payload)
        val ciphertext = VaultCrypto.aesGcmEncrypt(
            key,
            iv,
            plaintext.toByteArray(Charsets.UTF_8),
        )
        return EncryptedVaultEnvelope(
            version = 2,
            kdf = "PBKDF2-SHA256",
            iterations = iterations,
            salt = saltBase64,
            iv = VaultCrypto.bytesToBase64(iv),
            ciphertext = VaultCrypto.bytesToBase64(ciphertext),
        )
    }
}
