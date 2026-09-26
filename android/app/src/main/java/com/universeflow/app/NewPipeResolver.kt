package com.universeflow.app

import android.util.Log
import okhttp3.OkHttpClient
import okhttp3.RequestBody.Companion.toRequestBody
import org.schabi.newpipe.extractor.NewPipe
import org.schabi.newpipe.extractor.ServiceList
import org.schabi.newpipe.extractor.downloader.Downloader
import org.schabi.newpipe.extractor.downloader.Request
import org.schabi.newpipe.extractor.downloader.Response
import org.schabi.newpipe.extractor.exceptions.ReCaptchaException
import org.schabi.newpipe.extractor.stream.StreamInfo
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

/**
 * YouTube audio via NewPipe Extractor — the maintained engine used by
 * Echo Music / InnerTune. First leg of the native YouTube race; our own
 * NativeYouTubeResolver stays as the backup.
 */
object NewPipeResolver {
    private const val TAG = "NewPipeResolver"
    data class Hit(val url: String, val expiresAt: Long)

    private val cache = ConcurrentHashMap<String, Hit>()
    @Volatile private var ready = false
    @Volatile private var lastError: String? = null

    private val http = OkHttpClient.Builder()
        .connectTimeout(4, TimeUnit.SECONDS)
        .readTimeout(6, TimeUnit.SECONDS)
        .build()

    private object OkDownloader : Downloader() {
        override fun execute(request: Request): Response {
            val body = request.dataToSend()?.toRequestBody()
            val builder = okhttp3.Request.Builder()
                .url(request.url())
                .method(request.httpMethod(), body)
                .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; rv:128.0) Gecko/20100101 Firefox/128.0")
            request.headers().forEach { (name, values) ->
                builder.removeHeader(name)
                values.forEach { builder.addHeader(name, it) }
            }
            http.newCall(builder.build()).execute().use { res ->
                if (res.code == 429) throw ReCaptchaException("rate limited", request.url())
                return Response(
                    res.code, res.message, res.headers.toMultimap(),
                    res.body?.string(), res.request.url.toString(),
                )
            }
        }
    }

    @Synchronized
    private fun ensureInit() {
        if (ready) return
        NewPipe.init(OkDownloader)
        ready = true
    }

    fun peek(videoId: String): Hit? =
        cache[videoId]?.takeIf { it.expiresAt > System.currentTimeMillis() }

    fun lastFailure(): String? = lastError

    /** Blocking; call from a worker thread. */
    fun resolve(videoId: String): Hit? {
        peek(videoId)?.let { return it }
        return try {
            ensureInit()
            val info = StreamInfo.getInfo(ServiceList.YouTube, "https://www.youtube.com/watch?v=$videoId")
            val best = info.audioStreams
                .filter { !it.content.isNullOrBlank() && it.isUrl }
                .maxByOrNull { s ->
                    val fmt = s.format?.suffix.orEmpty()
                    s.averageBitrate + (if (fmt == "m4a" || fmt == "webm") 1 else 0)
                } ?: run { lastError = "NEWPIPE_NO_AUDIO"; return null }
            val url = best.content
            val expireSec = Regex("[?&]expire=(\\d+)").find(url)?.groupValues?.get(1)?.toLongOrNull()
            val expiresAt = (expireSec?.times(1000L) ?: (System.currentTimeMillis() + 3 * 3600_000L)) - 5 * 60_000L
            Hit(url, expiresAt).also { cache[videoId] = it; lastError = null }
        } catch (t: Throwable) {
            lastError = "NEWPIPE_${t.javaClass.simpleName}: ${t.message?.take(120)}"
            Log.w(TAG, "resolve $videoId failed: $lastError")
            null
        }
    }
}
