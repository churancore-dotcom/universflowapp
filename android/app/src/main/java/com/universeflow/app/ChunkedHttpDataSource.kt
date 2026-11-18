package com.universeflow.app

import android.net.Uri
import androidx.media3.common.C
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.HttpDataSource
import androidx.media3.datasource.TransferListener

/**
 * googlevideo throttles one open-ended request to roughly playback speed, so
 * the player buffer never fills ahead and any CPU/network squeeze (screen lock,
 * another app) underruns into audible glitches. Downloaded files never hit this.
 * Fetching the stream in bounded byte ranges keeps every request at full speed
 * so ExoPlayer can buffer far ahead. Other hosts pass straight through.
 */
class ChunkedHttpDataSource(
    private val inner: DataSource,
    private val chunkBytes: Long = DEFAULT_CHUNK_BYTES,
) : DataSource {
    companion object {
        const val DEFAULT_CHUNK_BYTES = 2L * 1024L * 1024L

        internal fun shouldChunk(uri: Uri): Boolean = isChunkedHost(uri.host)

        /** Only googlevideo throttles open-ended requests; keep others untouched. */
        fun isChunkedHost(host: String?): Boolean = host?.endsWith("googlevideo.com") == true

        /** Bytes to request next, never past the known end (exclusive; <=0 = unknown). */
        fun chunkLength(position: Long, end: Long, chunkBytes: Long): Long =
            if (end > 0) minOf(chunkBytes, end - position) else chunkBytes

        /** Total bytes of the file from the `clen` query parameter, if present. */
        internal fun contentLength(uri: Uri): Long? =
            uri.getQueryParameter("clen")?.toLongOrNull()?.takeIf { it > 0 }
    }

    private var base: DataSpec? = null
    private var chunking = false
    private var position = 0L
    private var end = C.LENGTH_UNSET.toLong() // exclusive, or unset
    private var chunkRemaining = 0L
    private var innerOpen = false

    override fun addTransferListener(transferListener: TransferListener) {
        inner.addTransferListener(transferListener)
    }

    override fun open(dataSpec: DataSpec): Long {
        base = dataSpec
        chunking = shouldChunk(dataSpec.uri)
        if (!chunking) {
            innerOpen = true
            return inner.open(dataSpec)
        }
        position = dataSpec.position
        end = when {
            dataSpec.length != C.LENGTH_UNSET.toLong() -> dataSpec.position + dataSpec.length
            else -> contentLength(dataSpec.uri) ?: C.LENGTH_UNSET.toLong()
        }
        if (!openChunk()) return 0
        return if (end > 0) end - dataSpec.position else C.LENGTH_UNSET.toLong()
    }

    /** Opens the next range; false when the file is exhausted. */
    private fun openChunk(): Boolean {
        val spec = base ?: return false
        if (end > 0 && position >= end) return false
        val len = chunkLength(position, end, chunkBytes)
        try {
            inner.open(spec.buildUpon().setPosition(position).setLength(len).build())
        } catch (e: HttpDataSource.InvalidResponseCodeException) {
            // Unknown length and we asked past the end: that is end of file.
            if (e.responseCode == 416 && end <= 0 && position > spec.position) return false
            throw e
        }
        innerOpen = true
        chunkRemaining = len
        return true
    }

    override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
        if (!chunking) return inner.read(buffer, offset, length)
        if (length == 0) return 0
        if (!innerOpen) return C.RESULT_END_OF_INPUT
        if (chunkRemaining <= 0) {
            closeInner()
            if (!openChunk()) return C.RESULT_END_OF_INPUT
        }
        val n = inner.read(buffer, offset, minOf(length.toLong(), chunkRemaining).toInt())
        if (n == C.RESULT_END_OF_INPUT) {
            // Short range means the server reached the real end of the file.
            closeInner()
            return C.RESULT_END_OF_INPUT
        }
        position += n
        chunkRemaining -= n
        return n
    }

    private fun closeInner() {
        if (innerOpen) {
            innerOpen = false
            inner.close()
        }
    }

    override fun getUri(): Uri? = inner.uri ?: base?.uri
    override fun getResponseHeaders(): Map<String, List<String>> = inner.responseHeaders

    override fun close() {
        try { closeInner() } finally { base = null; chunking = false }
    }
}
