package com.isecure.core.crypto

import com.isecure.core.model.EncryptedVaultEnvelope
import com.isecure.core.model.VaultPayload

/**
 * Common-code view of the vault crypto. The implementation lives in the
 * JVM source set (javax.crypto) and is identical for desktop and
 * Android; common code (state holder, UI) only ever sees this
 * interface, wired through PlatformServices.
 */
interface VaultCipher {
    fun encryptPayload(
        payload: VaultPayload,
        masterSecret: String,
        iterations: Int = DEFAULT_ITERATIONS,
    ): EncryptedVaultEnvelope

    fun decryptEnvelope(
        envelope: EncryptedVaultEnvelope,
        masterSecret: String,
    ): VaultPayload

    fun decryptEnvelopeWithKey(
        envelope: EncryptedVaultEnvelope,
        masterSecret: String,
    ): Pair<VaultPayload, ByteArray>

    fun encryptPayloadWithKey(
        payload: VaultPayload,
        key: ByteArray,
        saltBase64: String,
        iterations: Int,
    ): EncryptedVaultEnvelope

    fun parseEnvelope(jsonText: String): EncryptedVaultEnvelope?

    fun envelopeToJson(envelope: EncryptedVaultEnvelope): String

    companion object {
        const val DEFAULT_ITERATIONS = 600_000
    }
}
