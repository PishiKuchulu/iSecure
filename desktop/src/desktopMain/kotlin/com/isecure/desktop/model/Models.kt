package com.isecure.desktop.model

import kotlinx.serialization.Serializable

/**
 * Wire models — field names and optionality mirror src/types.ts and
 * src/crypto.ts EXACTLY, so a vault envelope written by any edition
 * (web, Android, desktop) opens in every other edition.
 */

@Serializable
data class PasswordHistoryItem(
    val id: String,
    val password: String,
    val changedAt: String,
)

@Serializable
data class CustomField(
    val label: String,
    val value: String,
    val isSecret: Boolean,
)

@Serializable
data class VaultEntry(
    val id: String,
    val title: String,
    val username: String,
    val password: String? = null,
    val url: String? = null,
    val notes: String? = null,
    val tags: List<String> = emptyList(),
    val category: String,
    val isFavorite: Boolean = false,
    val isTrash: Boolean = false,
    val deletedAt: String? = null,
    val createdDate: String,
    val modifiedDate: String,
    val entryType: String,
    val history: List<PasswordHistoryItem> = emptyList(),
    val customFields: List<CustomField>? = null,
)

@Serializable
data class VaultPayload(
    val entries: List<VaultEntry> = emptyList(),
    val customCategories: List<String> = emptyList(),
    val lastBackupTime: String? = null,
)

/** The encrypted envelope — identical shape to the TS EncryptedVaultEnvelope. */
@Serializable
data class EncryptedVaultEnvelope(
    val version: Int,
    val kdf: String,
    val iterations: Int,
    val salt: String,
    val iv: String,
    val ciphertext: String,
) {
    /** Mirrors isValidEncryptedEnvelope in src/crypto.ts (incl. the
     *  integer + range checks added for probe #7). */
    fun isValid(): Boolean =
        version == 2 &&
            kdf == "PBKDF2-SHA256" &&
            iterations in 1_000..10_000_000 &&
            salt.isNotEmpty() &&
            iv.isNotEmpty() &&
            ciphertext.isNotEmpty()
}
