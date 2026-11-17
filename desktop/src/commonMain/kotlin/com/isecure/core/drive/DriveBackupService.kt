package com.isecure.core.drive

import com.isecure.core.platform.DriveUserProfile
import com.isecure.core.platform.HttpTransport
import kotlinx.datetime.Clock
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

/** The access token was rejected (401): the caller drops the session. */
class DriveAuthExpiredException : Exception("DRIVE_AUTH_EXPIRED")

class DriveRequestException(message: String) : Exception(message)

data class DriveBackupFile(
    val id: String,
    val name: String,
    val size: String? = null,
    val modifiedTime: String? = null,
)

/**
 * Google Drive backup REST layer — the port of
 * src/services/googleDriveBackup.ts (native path). Zero-knowledge: only
 * the encrypted envelope ever leaves the device, and the access token
 * lives strictly in the caller's memory. File naming and the multipart
 * upload shape match the web edition byte-for-byte so both editions see
 * the same backups in Drive.
 */
class DriveBackupService(private val transport: HttpTransport) {

    private val json = Json { ignoreUnknownKeys = true }

    companion object {
        const val BACKUP_FILE_PREFIX = "pishisecure-backup-"
        const val BACKUP_FILE_EXT = ".pishivault.json"
        private const val LIST_QUERY =
            "trashed = false and name contains 'pishisecure-backup'"

        /** `pishisecure-backup-YYYY-MM-DDTHH-MM-SS.pishivault.json` —
         *  the TS edition derives the same name from Date.toISOString()
         *  with ':' and '.' replaced by '-' and cut at 19 chars. */
        fun backupFileName(nowIso: String): String {
            val stamp = nowIso.replace(":", "-").replace(".", "-")
                .take(19)
            return "$BACKUP_FILE_PREFIX$stamp$BACKUP_FILE_EXT"
        }
    }

    private fun encode(value: String): String {
        val sb = StringBuilder()
        for (byte in value.encodeToByteArray()) {
            val c = byte.toInt().toChar()
            val unreserved = c in 'A'..'Z' || c in 'a'..'z' || c in '0'..'9' ||
                c == '-' || c == '.' || c == '_' || c == '~'
            if (unreserved) {
                sb.append(c)
            } else {
                sb.append('%')
                sb.append((byte.toInt() and 0xFF).toString(16).uppercase().padStart(2, '0'))
            }
        }
        return sb.toString()
    }

    private fun bearer(token: String) = mapOf("Authorization" to "Bearer $token")

    private fun ensureOk(status: Int, body: String) {
        if (status == 401) throw DriveAuthExpiredException()
        if (status !in 200..299) {
            val detail = try {
                json.parseToJsonElement(body).jsonObject["error"]
                    ?.jsonObject?.get("message")?.jsonPrimitive?.contentOrNull
            } catch (e: Exception) {
                null
            }
            throw DriveRequestException(
                detail ?: "Google Drive request failed ($status)",
            )
        }
    }

    /** Best-effort profile lookup (cosmetic): any failure yields an
     *  empty profile, exactly like the TS edition's 10-second-capped
     *  fetch. */
    suspend fun fetchProfile(token: String): DriveUserProfile {
        return try {
            val res = transport.request(
                "GET",
                "https://www.googleapis.com/oauth2/v3/userinfo",
                bearer(token),
            )
            if (res.status !in 200..299) return DriveUserProfile(null, null)
            val root = json.parseToJsonElement(res.body).jsonObject
            DriveUserProfile(
                email = root["email"]?.jsonPrimitive?.contentOrNull,
                displayName = root["name"]?.jsonPrimitive?.contentOrNull,
            )
        } catch (e: Exception) {
            DriveUserProfile(null, null)
        }
    }

    /** Best-effort token revocation on sign-out. */
    suspend fun revoke(token: String) {
        try {
            transport.request(
                "POST",
                "https://oauth2.googleapis.com/revoke",
                mapOf("Content-Type" to "application/x-www-form-urlencoded"),
                "token=${encode(token)}".encodeToByteArray(),
            )
        } catch (e: Exception) {
            // The in-memory token is already dropped by the caller.
        }
    }

    suspend fun listBackups(token: String): List<DriveBackupFile> {
        val fields = encode("files(id,name,size,modifiedTime)")
        val url = "https://www.googleapis.com/drive/v3/files" +
            "?q=${encode(LIST_QUERY)}&orderBy=modifiedTime%20desc" +
            "&fields=$fields&spaces=drive"
        val res = transport.request("GET", url, bearer(token))
        ensureOk(res.status, res.body)
        val files = try {
            json.parseToJsonElement(res.body).jsonObject["files"]?.jsonArray
        } catch (e: Exception) {
            null
        } ?: return emptyList()
        return files.mapNotNull { element ->
            val obj = element as? JsonObject ?: return@mapNotNull null
            val id = obj["id"]?.jsonPrimitive?.contentOrNull ?: return@mapNotNull null
            val name = obj["name"]?.jsonPrimitive?.contentOrNull ?: return@mapNotNull null
            DriveBackupFile(
                id = id,
                name = name,
                size = obj["size"]?.jsonPrimitive?.contentOrNull,
                modifiedTime = obj["modifiedTime"]?.jsonPrimitive?.contentOrNull,
            )
        }
    }

    suspend fun uploadBackup(
        token: String,
        envelopeJson: String,
        existingFileId: String? = null,
        existingFileName: String? = null,
    ): DriveBackupFile {
        val fileName = existingFileName
            ?: backupFileName(Clock.System.now().toString())
        val metadata = buildJsonObject {
            put("name", fileName)
            put("mimeType", "application/json")
            put(
                "description",
                "iSecure AES-256-GCM Zero-Knowledge Encrypted Vault Backup",
            )
        }
        val boundary = "pishisecure_boundary_" +
            Clock.System.now().toEpochMilliseconds().toString(36)
        val body = "--$boundary\r\n" +
            "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
            "$metadata\r\n" +
            "--$boundary\r\n" +
            "Content-Type: application/json\r\n\r\n" +
            "$envelopeJson\r\n" +
            "--$boundary--"
        val isUpdate = existingFileId != null
        val endpoint = if (isUpdate) {
            "https://www.googleapis.com/upload/drive/v3/files/" +
                "${encode(existingFileId)}?uploadType=multipart" +
                "&fields=id,name,size,modifiedTime"
        } else {
            "https://www.googleapis.com/upload/drive/v3/files" +
                "?uploadType=multipart&fields=id,name,size,modifiedTime"
        }
        val res = transport.request(
            if (isUpdate) "PATCH" else "POST",
            endpoint,
            bearer(token) + mapOf(
                "Content-Type" to "multipart/related; boundary=$boundary",
            ),
            body.encodeToByteArray(),
        )
        ensureOk(res.status, res.body)
        val root = json.parseToJsonElement(res.body).jsonObject
        return DriveBackupFile(
            id = root["id"]?.jsonPrimitive?.contentOrNull ?: "",
            name = root["name"]?.jsonPrimitive?.contentOrNull ?: fileName,
            size = root["size"]?.jsonPrimitive?.contentOrNull,
            modifiedTime = root["modifiedTime"]?.jsonPrimitive?.contentOrNull,
        )
    }

    /** The raw envelope JSON of a backup; the caller validates and
     *  decrypts it through the cipher (the P-03-safe path). */
    suspend fun downloadBackup(token: String, fileId: String): String {
        val url = "https://www.googleapis.com/drive/v3/files/" +
            "${encode(fileId)}?alt=media"
        val res = transport.request("GET", url, bearer(token))
        ensureOk(res.status, res.body)
        return res.body
    }

    suspend fun deleteBackup(token: String, fileId: String) {
        val url = "https://www.googleapis.com/drive/v3/files/${encode(fileId)}"
        val res = transport.request("DELETE", url, bearer(token))
        ensureOk(res.status, res.body)
    }
}
