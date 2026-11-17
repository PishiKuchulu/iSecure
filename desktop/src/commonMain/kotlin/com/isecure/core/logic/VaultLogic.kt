package com.isecure.core.logic

import com.isecure.core.model.VaultEntry
import com.isecure.core.platform.RandomSource
import kotlin.math.ln
import kotlin.math.roundToInt
import kotlin.time.Duration.Companion.days
import kotlinx.datetime.Instant

/**
 * Pure vault logic ported 1:1 from src/utils.ts — same algorithms, same
 * constants, same edge cases (including the P-01 Map-based reuse count).
 * Time-dependent functions take `now` so they are unit-testable.
 */
object VaultLogic {

    /** Uniform integer in [0, max) via rejection sampling over 32-bit
     *  draws — identical scheme to getSecureRandomInt in the web app. */
    fun secureRandomInt(random: RandomSource, max: Int): Int {
        require(max > 0) { "max must be a positive integer" }
        val range = 4_294_967_296L // 2^32
        val limit = (range / max) * max
        while (true) {
            val bytes = random.nextBytes(4)
            val value = ((bytes[0].toLong() and 0xFF) shl 24) or
                ((bytes[1].toLong() and 0xFF) shl 16) or
                ((bytes[2].toLong() and 0xFF) shl 8) or
                (bytes[3].toLong() and 0xFF)
            if (value < limit) {
                return (value % max).toInt()
            }
        }
    }

    /** "prefix-<uuid-v4>" — mirrors generateSecureId (randomUUID form). */
    fun generateSecureId(random: RandomSource, prefix: String = "item"): String {
        val bytes = random.nextBytes(16)
        bytes[6] = ((bytes[6].toInt() and 0x0F) or 0x40).toByte() // version 4
        bytes[8] = ((bytes[8].toInt() and 0x3F) or 0x80).toByte() // variant
        val hex = bytes.joinToString("") { (it.toInt() and 0xFF).toString(16).padStart(2, '0') }
        val uuid = buildString {
            append(hex.substring(0, 8)); append('-')
            append(hex.substring(8, 12)); append('-')
            append(hex.substring(12, 16)); append('-')
            append(hex.substring(16, 20)); append('-')
            append(hex.substring(20, 32))
        }
        return "$prefix-$uuid"
    }

    /** Unicode code points of a string (surrogate pairs counted once),
     *  matching JS Array.from semantics used by the web app. */
    fun codePoints(s: String): List<Int> {
        val result = ArrayList<Int>(s.length)
        var i = 0
        while (i < s.length) {
            val c = s[i]
            if (c.isHighSurrogate() && i + 1 < s.length && s[i + 1].isLowSurrogate()) {
                result.add(0x10000 + ((c.code - 0xD800) shl 10) + (s[i + 1].code - 0xDC00))
                i += 2
            } else {
                result.add(c.code)
                i++
            }
        }
        return result
    }

    /** Repetition-aware entropy in bits — port of calculateEntropy. */
    fun calculateEntropy(secret: String): Int {
        if (secret.isEmpty()) return 0
        val chars = codePoints(secret)
        val length = chars.size
        if (length == 0) return 0

        var poolSize = 0
        if (secret.any { it in 'a'..'z' }) poolSize += 26
        if (secret.any { it in 'A'..'Z' }) poolSize += 26
        if (secret.any { it in '0'..'9' }) poolSize += 10
        if (secret.any { it !in 'a'..'z' && it !in 'A'..'Z' && it !in '0'..'9' }) poolSize += 33
        if (poolSize == 0) return 0

        val uniqueRatio = chars.toSet().size.toDouble() / length
        val effectiveLength = length * (0.25 + 0.75 * uniqueRatio)
        val entropy = effectiveLength * (ln(poolSize.toDouble()) / ln(2.0))
        return entropy.roundToInt()
    }

    enum class PasswordStrength { WEAK, FAIR, GOOD, EXCELLENT }

    fun passwordStrength(secret: String): PasswordStrength {
        val length = codePoints(secret).size
        val entropy = calculateEntropy(secret)
        return when {
            entropy < 40 || length < 8 -> PasswordStrength.WEAK
            entropy < 60 || length < 12 -> PasswordStrength.FAIR
            entropy < 80 || length < 16 -> PasswordStrength.GOOD
            else -> PasswordStrength.EXCELLENT
        }
    }

    data class AuditResult(
        val weakIds: List<String>,
        val reusedIds: List<String>,
        val oldIds: List<String>,
        val score: Int,
    )

    /** Port of auditVault: notes and passwordless entries are exempt
     *  from weak/reused; score deducts 20/10/5 clamped to [15, 100]. */
    fun auditVault(entries: List<VaultEntry>, now: Instant): AuditResult {
        val active = entries.filter { !it.isTrash }

        val weakIds = ArrayList<String>()
        for (entry in active) {
            val pwd = entry.password ?: ""
            if (pwd.isEmpty() || entry.entryType == "note") continue
            if (passwordStrength(pwd) == PasswordStrength.WEAK) {
                weakIds.add(entry.id)
            }
        }

        // Map (not a hash-of-object tricks) — the P-01 lesson: passwords
        // like "__proto__" are ordinary values.
        val counts = LinkedHashMap<String, MutableList<String>>()
        for (entry in active) {
            val pwd = entry.password ?: ""
            if (pwd.isNotEmpty() && entry.entryType != "note") {
                counts.getOrPut(pwd) { ArrayList() }.add(entry.id)
            }
        }
        val reusedIds = ArrayList<String>()
        for ((_, ids) in counts) {
            if (ids.size > 1) reusedIds.addAll(ids)
        }

        val ninetyDaysAgo = now - 90.days
        val oldIds = ArrayList<String>()
        for (entry in active) {
            val modInstant = try {
                Instant.parse(entry.modifiedDate)
            } catch (e: Exception) {
                null
            }
            if (modInstant != null && modInstant < ninetyDaysAgo) {
                oldIds.add(entry.id)
            }
        }

        if (active.isEmpty()) {
            return AuditResult(weakIds, emptyList(), oldIds, 100)
        }
        val uniqueReused = reusedIds.distinct()
        var score = 100
        score -= weakIds.size * 20
        score -= uniqueReused.size * 10
        score -= oldIds.size * 5
        return AuditResult(weakIds, uniqueReused, oldIds, score.coerceIn(15, 100))
    }

    data class MasterPasswordCheck(
        val hasMinLength: Boolean,
        val hasUpper: Boolean,
        val hasLower: Boolean,
        val hasNumber: Boolean,
        val hasSymbol: Boolean,
        val entropy: Int,
    )

    fun validateMasterPassword(secret: String): MasterPasswordCheck {
        val length = codePoints(secret).size
        return MasterPasswordCheck(
            hasMinLength = length >= 12,
            hasUpper = secret.any { it in 'A'..'Z' },
            hasLower = secret.any { it in 'a'..'z' },
            hasNumber = secret.any { it in '0'..'9' },
            hasSymbol = secret.any {
                it !in 'a'..'z' && it !in 'A'..'Z' && it !in '0'..'9'
            },
            entropy = calculateEntropy(secret),
        )
    }

    /** Only http/https links may be opened externally. */
    fun safeExternalUrl(rawUrl: String?): String? {
        val trimmed = rawUrl?.trim().orEmpty()
        if (trimmed.isEmpty()) return null
        val lower = trimmed.lowercase()
        return if (lower.startsWith("http://") || lower.startsWith("https://")) {
            trimmed
        } else {
            null
        }
    }

    /** Drop trashed entries deleted more than [retentionDays] ago. */
    fun purgeExpiredTrash(
        entries: List<VaultEntry>,
        now: Instant,
        retentionDays: Int = 30,
    ): List<VaultEntry> {
        val cutoffMs = now.toEpochMilliseconds() - retentionDays * 24 * 60 * 60 * 1_000L
        return entries.filter { entry ->
            if (!entry.isTrash) return@filter true
            val deletedAt = entry.deletedAt ?: return@filter true
            val deletedMs = try {
                Instant.parse(deletedAt).toEpochMilliseconds()
            } catch (e: Exception) {
                return@filter true
            }
            deletedMs > cutoffMs
        }
    }
}
