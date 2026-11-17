package com.isecure.core.crypto

import com.isecure.core.model.EncryptedVaultEnvelope
import com.isecure.core.model.VaultPayload

/** VaultCipher backed by the vector-verified VaultService. */
object JvmVaultCipher : VaultCipher {
    override fun encryptPayload(
        payload: VaultPayload,
        masterSecret: String,
        iterations: Int,
    ): EncryptedVaultEnvelope =
        VaultService.encryptPayload(payload, masterSecret, iterations)

    override fun decryptEnvelope(
        envelope: EncryptedVaultEnvelope,
        masterSecret: String,
    ): VaultPayload = VaultService.decryptEnvelope(envelope, masterSecret)

    override fun decryptEnvelopeWithKey(
        envelope: EncryptedVaultEnvelope,
        masterSecret: String,
    ): Pair<VaultPayload, ByteArray> =
        VaultService.decryptEnvelopeWithKey(envelope, masterSecret)

    override fun encryptPayloadWithKey(
        payload: VaultPayload,
        key: ByteArray,
        saltBase64: String,
        iterations: Int,
    ): EncryptedVaultEnvelope =
        VaultService.encryptPayloadWithKey(payload, key, saltBase64, iterations)

    override fun parseEnvelope(jsonText: String): EncryptedVaultEnvelope? =
        try {
            val parsed = VaultService.json.decodeFromString(
                EncryptedVaultEnvelope.serializer(),
                jsonText,
            )
            if (parsed.isValid()) parsed else null
        } catch (e: Exception) {
            null
        }

    override fun envelopeToJson(envelope: EncryptedVaultEnvelope): String =
        VaultService.json.encodeToString(
            EncryptedVaultEnvelope.serializer(),
            envelope,
        )
}
