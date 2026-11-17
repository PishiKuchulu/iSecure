package com.isecure.core

import com.isecure.core.i18n.SUPPORTED_LOCALES
import com.isecure.core.i18n.stringsFor
import com.isecure.core.logic.PasswordGenerator
import com.isecure.core.logic.VaultLogic
import com.isecure.core.model.VaultEntry
import com.isecure.core.platform.RandomSource
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.datetime.Instant

/** Deterministic byte source (LCG) so logic tests are reproducible. */
private class FixedRandom(seed: Long) : RandomSource {
    private var state = seed
    override fun nextBytes(count: Int): ByteArray {
        val out = ByteArray(count)
        for (i in 0 until count) {
            state = state * 6364136223846793005L + 1442695040888963407L
            out[i] = (state ushr 33).toByte()
        }
        return out
    }
}

class LogicTest {

    @Test
    fun secureRandomIntStaysInRange() {
        val random = FixedRandom(42)
        repeat(2_000) {
            val value = VaultLogic.secureRandomInt(random, 7)
            assertTrue(value in 0 until 7, "value $value out of range")
        }
        assertEquals(0, VaultLogic.secureRandomInt(random, 1))
    }

    @Test
    fun secureIdHasUuidV4Shape() {
        val id = VaultLogic.generateSecureId(FixedRandom(7), "item")
        assertTrue(id.startsWith("item-"))
        val uuid = id.removePrefix("item-")
        assertEquals(36, uuid.length)
        assertEquals('4', uuid[14])
        assertTrue(uuid[19] in "89ab")
    }

    @Test
    fun entropyMatchesTypeScriptReferenceValues() {
        // Reference values produced by the web app's calculateEntropy.
        assertEquals(0, VaultLogic.calculateEntropy(""))
        assertEquals(34, VaultLogic.calculateEntropy("password"))
        assertEquals(67, VaultLogic.calculateEntropy("Tr0ub4dor&3"))
        assertEquals(50, VaultLogic.calculateEntropy("رمزعبور123"))
        assertEquals(22, VaultLogic.calculateEntropy("aaaaaaaaaaaaaaaa"))
        assertEquals(131, VaultLogic.calculateEntropy("Xk9#mQ2\$vL8&nR4!pZw7"))
    }

    @Test
    fun strengthMatchesTypeScriptReferenceValues() {
        assertEquals(
            VaultLogic.PasswordStrength.WEAK,
            VaultLogic.passwordStrength("password"),
        )
        assertEquals(
            VaultLogic.PasswordStrength.FAIR,
            VaultLogic.passwordStrength("Tr0ub4dor&3"),
        )
        assertEquals(
            VaultLogic.PasswordStrength.EXCELLENT,
            VaultLogic.passwordStrength("Xk9#mQ2\$vL8&nR4!pZw7"),
        )
    }

    private fun entry(
        id: String,
        secret: String?,
        modified: String = "2026-11-17T00:00:00Z",
        type: String = "website",
        trash: Boolean = false,
        deletedAt: String? = null,
    ) = VaultEntry(
        id = id,
        title = id,
        username = "user",
        password = secret,
        tags = emptyList(),
        category = "website",
        isFavorite = false,
        isTrash = trash,
        deletedAt = deletedAt,
        createdDate = "2026-01-01T00:00:00Z",
        modifiedDate = modified,
        entryType = type,
        history = emptyList(),
    )

    @Test
    fun auditFindsWeakReusedAndOld() {
        val now = Instant.parse("2026-11-17T00:00:00Z")
        val entries = listOf(
            entry("weak", "password"),
            entry("reuse-a", "__proto__"),
            entry("reuse-b", "__proto__"),
            entry("old", "Xk9#mQ2\$vL8&nR4!pZw7", modified = "2026-01-01T00:00:00Z"),
            // Notes are exempt from weak/reused even with a weak secret.
            entry("note", "password", type = "note"),
            // Trashed entries are excluded entirely.
            entry("gone", "password", trash = true, deletedAt = "2026-11-01T00:00:00Z"),
        )
        val result = VaultLogic.auditVault(entries, now)
        // Expectations verified against the TS auditVault on this exact
        // fixture: "__proto__" is itself a WEAK password, so both reused
        // entries are weak too, and the score clamps at the 15 floor.
        assertEquals(listOf("weak", "reuse-a", "reuse-b"), result.weakIds)
        // The P-01 regression: "__proto__" must count as a reused value.
        assertEquals(setOf("reuse-a", "reuse-b"), result.reusedIds.toSet())
        assertEquals(listOf("old"), result.oldIds)
        // 100 - 3*20 (weak) - 2*10 (reused) - 5 (old) = 15 (floor)
        assertEquals(15, result.score)
    }

    @Test
    fun auditOfEmptyVaultScores100() {
        val result = VaultLogic.auditVault(
            emptyList(),
            Instant.parse("2026-11-17T00:00:00Z"),
        )
        assertEquals(100, result.score)
    }

    @Test
    fun purgeDropsOnlyExpiredTrash() {
        val now = Instant.parse("2026-11-17T00:00:00Z")
        val entries = listOf(
            entry("expired", null, trash = true, deletedAt = "2026-10-01T00:00:00Z"),
            entry("recent", null, trash = true, deletedAt = "2026-11-10T00:00:00Z"),
            entry("no-date", null, trash = true, deletedAt = null),
            entry("active", "whatever"),
        )
        val kept = VaultLogic.purgeExpiredTrash(entries, now).map { it.id }
        assertEquals(listOf("recent", "no-date", "active"), kept)
    }

    @Test
    fun generatorHonorsLengthAndMandatorySets() {
        val random = FixedRandom(1234)
        val generated = PasswordGenerator.generate(
            random,
            PasswordGenerator.Options(length = 24),
        )
        assertNotNull(generated)
        assertEquals(24, generated.length)
        assertTrue(generated.any { it in 'a'..'z' })
        assertTrue(generated.any { it in 'A'..'Z' })
        assertTrue(generated.any { it in '0'..'9' })
        assertTrue(generated.any { it in "!@#$%^&*()_+-=[]{}|;:,.<>?" })
    }

    @Test
    fun generatorExcludeSimilarAndEmptyPool() {
        val random = FixedRandom(99)
        val generated = PasswordGenerator.generate(
            random,
            PasswordGenerator.Options(length = 40, excludeSimilar = true),
        )
        assertNotNull(generated)
        assertFalse(generated.any { it in "loIO01|.," })
        val none = PasswordGenerator.generate(
            random,
            PasswordGenerator.Options(
                includeLower = false,
                includeUpper = false,
                includeNumbers = false,
                includeSymbols = false,
            ),
        )
        assertNull(none)
    }

    @Test
    fun localesLoadWithRtlFlagsAndFallback() {
        assertEquals(11, SUPPORTED_LOCALES.size)
        assertTrue(stringsFor("fa").isRTL)
        assertTrue(stringsFor("ar").isRTL)
        assertFalse(stringsFor("en").isRTL)
        assertEquals("iSecure", stringsFor("en").appName)
        assertEquals("missing-key", stringsFor("fa")["missing-key"])
        assertEquals(
            stringsFor("fa")["masterPassword"],
            stringsFor("fa").masterPassword,
        )
    }
}
