package com.isecure.desktop.crypto

import com.isecure.desktop.model.EncryptedVaultEnvelope
import com.isecure.desktop.model.VaultPayload
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
    ): VaultPayload {
        require(envelope.isValid()) { "Not a valid iSecure vault envelope." }
        val salt = VaultCrypto.base64ToBytes(envelope.salt)
        val iv = VaultCrypto.base64ToBytes(envelope.iv)
        val ciphertext = VaultCrypto.base64ToBytes(envelope.ciphertext)
        val key = VaultCrypto.deriveKey(masterSecret, salt, envelope.iterations)
        val plaintext = VaultCrypto.aesGcmDecrypt(key, iv, ciphertext)
        return json.decodeFromString(
            VaultPayload.serializer(),
            plaintext.toString(Charsets.UTF_8),
        )
    }
}
