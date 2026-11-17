package com.isecure.core.update

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull

/**
 * In-app update feed contract — the port of src/services/updateLogic.ts
 * in the web/Capacitor edition. The update check talks ONLY to the
 * Cloudflare feed (the WebView fetch of GitHub's release URLs hit a
 * redirect without CORS headers — the v1.0.3 root cause), and every
 * manifest field is validated before it is trusted: strict semver,
 * https feed-origin download URL, a 64-hex SHA-256 digest, and a sane
 * size window. The native layer additionally enforces a hard size cap
 * while streaming and the same-signer check before install.
 */
data class UpdateInfo(
    val version: String,
    val fileName: String,
    val downloadUrl: String,
    val sha256: String,
    val sizeBytes: Long,
    val publishedAt: String,
)

object UpdateFeed {
    const val FEED_ORIGIN = "https://isecure-update.farzad-sholeh.workers.dev"
    const val MANIFEST_URL = "$FEED_ORIGIN/update.json"
    const val DOWNLOAD_PREFIX = "$FEED_ORIGIN/dl/"
    const val MAX_SIZE_BYTES = 200L * 1024 * 1024

    private val json = Json { ignoreUnknownKeys = true }
    private val semver = Regex("""^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$""")
    private val sha256Hex = Regex("""^[0-9a-f]{64}$""")

    /** Numeric semver comparison: -1 / 0 / 1, or null when either side
     *  is not strict X.Y.Z. */
    fun compareVersions(a: String, b: String): Int? {
        val pa = parseSemver(a) ?: return null
        val pb = parseSemver(b) ?: return null
        for (i in 0..2) {
            if (pa[i] != pb[i]) return if (pa[i] < pb[i]) -1 else 1
        }
        return 0
    }

    private fun parseSemver(value: String): List<Int>? {
        val match = semver.matchEntire(value.trim()) ?: return null
        return match.groupValues.drop(1).map { it.toIntOrNull() ?: return null }
    }

    /** The feed manifest, validated; null when malformed in any field. */
    fun parseManifest(text: String): UpdateInfo? {
        val root: JsonObject = try {
            json.parseToJsonElement(text).jsonObject
        } catch (e: Exception) {
            return null
        }
        val version = root["version"]?.jsonPrimitive?.contentOrNull ?: return null
        if (parseSemver(version) == null) return null
        // The feed worker emits "apkName" (the web edition's parser reads
        // the same field); "fileName" is tolerated as an alias.
        val fileName = root["apkName"]?.jsonPrimitive?.contentOrNull
            ?: root["fileName"]?.jsonPrimitive?.contentOrNull ?: return null
        if (fileName.isEmpty() || "/" in fileName || "\\" in fileName) return null
        val downloadUrl =
            root["downloadUrl"]?.jsonPrimitive?.contentOrNull ?: return null
        if (!downloadUrl.startsWith(DOWNLOAD_PREFIX)) return null
        val sha256 = root["sha256"]?.jsonPrimitive?.contentOrNull ?: return null
        if (!sha256Hex.matches(sha256)) return null
        val size = root["sizeBytes"]?.jsonPrimitive?.longOrNull ?: return null
        if (size <= 0 || size > MAX_SIZE_BYTES) return null
        // The live feed has no publishedAt field; it is informational
        // only, so it stays optional.
        val publishedAt =
            root["publishedAt"]?.jsonPrimitive?.contentOrNull ?: ""
        return UpdateInfo(version, fileName, downloadUrl, sha256, size, publishedAt)
    }

    /** Manifest → the update to offer, or null when the installed build
     *  is already at (or ahead of) the feed version. */
    fun availableUpdate(manifestText: String, currentVersion: String): UpdateInfo? {
        val info = parseManifest(manifestText) ?: return null
        val comparison = compareVersions(info.version, currentVersion) ?: return null
        return if (comparison > 0) info else null
    }
}
