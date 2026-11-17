package com.isecure.core.platform

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.net.HttpURLConnection
import java.net.URI

/** HttpURLConnection transport shared by the desktop and Android
 *  targets (both are JVM-family and include this source set). */
class JvmHttpTransport : HttpTransport {
    override suspend fun request(
        method: String,
        url: String,
        headers: Map<String, String>,
        body: ByteArray?,
    ): HttpResponse = withContext(Dispatchers.IO) {
        val connection =
            URI(url).toURL().openConnection() as HttpURLConnection
        try {
            connection.requestMethod = method
            connection.connectTimeout = 30_000
            connection.readTimeout = 30_000
            connection.instanceFollowRedirects = true
            for ((key, value) in headers) {
                connection.setRequestProperty(key, value)
            }
            if (body != null) {
                connection.doOutput = true
                connection.outputStream.use { it.write(body) }
            }
            val status = connection.responseCode
            val stream = if (status in 200..299) {
                connection.inputStream
            } else {
                connection.errorStream
            }
            val text = stream?.readBytes()?.decodeToString() ?: ""
            HttpResponse(status, text)
        } finally {
            connection.disconnect()
        }
    }
}
