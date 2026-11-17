package com.isecure

import com.isecure.core.drive.DriveAuthExpiredException
import com.isecure.core.drive.DriveBackupService
import com.isecure.core.platform.HttpResponse
import com.isecure.core.platform.HttpTransport
import com.isecure.core.update.UpdateFeed
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Tests for the Android-port common layer: the update-feed contract
 * (mirroring the web edition's updateLogic tests) and the Drive REST
 * layer over a fake transport (mirroring googleDriveBackup.ts).
 */
class UpdateFeedTest {

    private val manifest = """
        {"version":"1.0.6","tag":"v1.0.6","apkName":"iSecure-1.0.6-release.apk",
         "downloadUrl":"https://isecure-update.farzad-sholeh.workers.dev/dl/iSecure-1.0.6-release.apk",
         "sha256":"${"a".repeat(64)}","sizeBytes":7343347}
    """.trimIndent()

    @Test
    fun theLiveFeedManifestShapeParses() {
        // Byte-for-byte the shape the Cloudflare worker serves today
        // (captured from /update.json for v1.0.5): apkName, no
        // publishedAt. A parser drift here silently kills updates.
        val live = """
            {"version":"1.0.5","tag":"v1.0.5","apkName":"iSecure-1.0.5-release.apk","sizeBytes":7343347,"sha256":"1245b22cb760dd9346e24ddee83abd8d42153ac6293f20a621d174e7d708fdd7","downloadUrl":"https://isecure-update.farzad-sholeh.workers.dev/dl/iSecure-1.0.5-release.apk"}
        """.trimIndent()
        val info = UpdateFeed.parseManifest(live)
        assertNotNull(info)
        assertEquals("iSecure-1.0.5-release.apk", info.fileName)
        assertEquals(
            "1245b22cb760dd9346e24ddee83abd8d42153ac6293f20a621d174e7d708fdd7",
            info.sha256,
        )
    }

    @Test
    fun newerFeedVersionIsOffered() {
        val info = UpdateFeed.availableUpdate(manifest, "1.0.5")
        assertNotNull(info)
        assertEquals("1.0.6", info.version)
        assertEquals(7343347L, info.sizeBytes)
    }

    @Test
    fun sameOrOlderFeedVersionIsNotOffered() {
        assertNull(UpdateFeed.availableUpdate(manifest, "1.0.6"))
        assertNull(UpdateFeed.availableUpdate(manifest, "1.1.0"))
        assertNull(UpdateFeed.availableUpdate(manifest, "not-a-version"))
    }

    @Test
    fun malformedManifestsAreRejected() {
        // Non-feed download origin.
        assertNull(
            UpdateFeed.parseManifest(
                manifest.replace("isecure-update.farzad-sholeh.workers.dev", "evil.example"),
            ),
        )
        // Uppercase / short digest.
        assertNull(UpdateFeed.parseManifest(manifest.replace("a".repeat(64), "A".repeat(64))))
        assertNull(UpdateFeed.parseManifest(manifest.replace("a".repeat(64), "abc")))
        // Bad version, path traversal in the file name, absurd size.
        assertNull(UpdateFeed.parseManifest(manifest.replace("1.0.6", "1.0")))
        assertNull(UpdateFeed.parseManifest(manifest.replace("iSecure-1.0.6-release.apk", "../x.apk")))
        assertNull(UpdateFeed.parseManifest(manifest.replace("7343347", "999999999999")))
        assertNull(UpdateFeed.parseManifest("not json"))
    }

    @Test
    fun versionComparisonIsNumeric() {
        assertEquals(1, UpdateFeed.compareVersions("1.0.10", "1.0.9"))
        assertEquals(-1, UpdateFeed.compareVersions("1.0.9", "1.0.10"))
        assertEquals(0, UpdateFeed.compareVersions("2.0.0", "2.0.0"))
        assertNull(UpdateFeed.compareVersions("1.0", "1.0.0"))
    }
}

private class FakeTransport(
    var responder: (method: String, url: String, body: ByteArray?) -> HttpResponse,
) : HttpTransport {
    data class Call(val method: String, val url: String, val bodyText: String?)

    val calls = mutableListOf<Call>()

    override suspend fun request(
        method: String,
        url: String,
        headers: Map<String, String>,
        body: ByteArray?,
    ): HttpResponse {
        calls.add(Call(method, url, body?.decodeToString()))
        return responder(method, url, body)
    }
}

class DriveBackupServiceTest {

    @Test
    fun backupFileNameMatchesTheWebEditionShape() {
        assertEquals(
            "pishisecure-backup-2026-11-17T19-30-00.pishivault.json",
            DriveBackupService.backupFileName("2026-11-17T19:30:00.123456789Z"),
        )
    }

    @Test
    fun listBackupsParsesTheFilesArray() = runTest {
        val transport = FakeTransport { _, _, _ ->
            HttpResponse(
                200,
                """{"files":[{"id":"f1","name":"pishisecure-backup-a.pishivault.json","size":"123","modifiedTime":"2026-11-17T00:00:00Z"}]}""",
            )
        }
        val files = DriveBackupService(transport).listBackups("token")
        assertEquals(1, files.size)
        assertEquals("f1", files[0].id)
        assertTrue(transport.calls[0].url.contains("name%20contains"))
    }

    @Test
    fun unauthorizedMapsToAuthExpired() = runTest {
        val transport = FakeTransport { _, _, _ -> HttpResponse(401, "{}") }
        assertFailsWith<DriveAuthExpiredException> {
            DriveBackupService(transport).listBackups("token")
        }
    }

    @Test
    fun uploadBuildsTheMultipartBodyLikeTheWebEdition() = runTest {
        val transport = FakeTransport { _, _, _ ->
            HttpResponse(200, """{"id":"new1","name":"n","size":"10"}""")
        }
        val created = DriveBackupService(transport).uploadBackup(
            "token",
            "{\"version\":2}",
            existingFileName = "pishisecure-backup-x.pishivault.json",
        )
        assertEquals("new1", created.id)
        val call = transport.calls.single()
        assertEquals("POST", call.method)
        val body = call.bodyText ?: ""
        assertTrue(body.contains("\"name\":\"pishisecure-backup-x.pishivault.json\""))
        assertTrue(body.contains("{\"version\":2}"))
        assertTrue(body.contains("multipart") || body.contains("pishisecure_boundary_"))
    }

    @Test
    fun downloadReturnsTheRawEnvelopeText() = runTest {
        val transport = FakeTransport { _, _, _ ->
            HttpResponse(200, "{\"version\":2,\"kdf\":\"PBKDF2-SHA256\"}")
        }
        val text = DriveBackupService(transport).downloadBackup("token", "f9")
        assertTrue(text.contains("PBKDF2-SHA256"))
        assertTrue(transport.calls[0].url.endsWith("f9?alt=media"))
    }
}
