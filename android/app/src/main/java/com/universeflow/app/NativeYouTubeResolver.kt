package com.universeflow.app

import android.util.Log
import okhttp3.ConnectionPool
import okhttp3.Dispatcher
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference

data class NativeResolvedStream(val url: String, val itag: Int, val client: String)

/**
 * Shared on-device YouTube resolver used by BOTH the Capacitor InnerTube plugin
 * and ExoPlayerPlugin's native playlist preloader.
 *
 * This mirrors the Echo/NewPipe architecture: requests are made from the user's
 * phone IP with mobile/TV InnerTube clients, cached in memory for 5h, and fed
 * directly into ExoPlayer. No Supabase/datacenter hop is needed for APK playback.
 */
object NativeYouTubeResolver {
    private const val TAG = "NativeYouTubeResolver"
    private const val ENDPOINT = "https://www.youtube.com/youtubei/v1/player?prettyPrint=false"
    private const val CACHE_TTL_MS = 5L * 60L * 60L * 1000L

    private data class CachedStream(val url: String, val itag: Int, val client: String, val ts: Long)
    private data class ClientCtx(val name: String, val jsonContext: JSONObject, val userAgent: String)

    private val streamCache = java.util.concurrent.ConcurrentHashMap<String, CachedStream>()
    private val raceExecutor = Executors.newFixedThreadPool(4)

    private val http: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(2500, TimeUnit.MILLISECONDS)
            .readTimeout(4500, TimeUnit.MILLISECONDS)
            .callTimeout(5000, TimeUnit.MILLISECONDS)
            .retryOnConnectionFailure(true)
            .connectionPool(ConnectionPool(10, 5, TimeUnit.MINUTES))
            .protocols(listOf(Protocol.HTTP_2, Protocol.HTTP_1_1))
            .dispatcher(Dispatcher(Executors.newFixedThreadPool(8)).apply {
                maxRequests = 16
                maxRequestsPerHost = 8
            })
            .build()
    }

    @Volatile private var warmed = false

    fun warm() {
        if (warmed) return
        warmed = true
        Thread {
            try {
                http.newCall(
                    Request.Builder()
                        .url("https://www.youtube.com/generate_204")
                        .header("User-Agent", "Mozilla/5.0")
                        .build(),
                ).execute().use { /* drain */ }
            } catch (_: Throwable) { /* best effort */ }
        }.start()
    }

    fun resolve(videoId: String, timeoutMs: Long = 5200L): NativeResolvedStream? {
        if (videoId.length != 11) return null
        getCached(videoId)?.let { return NativeResolvedStream(it.url, it.itag, it.client) }

        val clients = buildClients()
        val latch = CountDownLatch(1)
        val winner = AtomicReference<NativeResolvedStream?>()
        val errors = java.util.concurrent.ConcurrentLinkedQueue<String>()
        val remaining = AtomicInteger(clients.size)

        for (ctx in clients) {
            raceExecutor.execute {
                try {
                    val result = attempt(videoId, ctx)
                    if (result != null && winner.compareAndSet(null, NativeResolvedStream(result.first, result.second, ctx.name))) {
                        latch.countDown()
                        return@execute
                    }
                } catch (t: Throwable) {
                    errors.add("${ctx.name}: ${t.message ?: "err"}")
                }
                if (remaining.decrementAndGet() == 0) latch.countDown()
            }
        }

        try { latch.await(timeoutMs, TimeUnit.MILLISECONDS) } catch (_: Throwable) {}
        val w = winner.get()
        if (w != null) {
            streamCache[videoId] = CachedStream(w.url, w.itag, w.client, System.currentTimeMillis())
            Log.d(TAG, "resolved $videoId via ${w.client} itag=${w.itag}")
            return w
        }
        Log.w(TAG, "resolve failed $videoId: ${errors.joinToString("; ").ifEmpty { "no playable stream" }}")
        return null
    }

    private fun getCached(videoId: String): CachedStream? {
        val c = streamCache[videoId] ?: return null
        if (System.currentTimeMillis() - c.ts > CACHE_TTL_MS) {
            streamCache.remove(videoId)
            return null
        }
        return c
    }

    private fun buildClients(): List<ClientCtx> {
        val androidVrCtx = JSONObject().apply {
            put("client", JSONObject().apply {
                put("clientName", "ANDROID_VR")
                put("clientVersion", "1.60.19")
                put("deviceMake", "Oculus")
                put("deviceModel", "Quest 3")
                put("androidSdkVersion", 32)
                put("osName", "Android")
                put("osVersion", "12L")
                put("hl", "en")
                put("gl", "US")
                put("userAgent", "com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12L; GB) gzip")
            })
        }

        val iosCtx = JSONObject().apply {
            put("client", JSONObject().apply {
                put("clientName", "IOS")
                put("clientVersion", "20.10.4")
                put("deviceMake", "Apple")
                put("deviceModel", "iPhone16,2")
                put("osName", "iPhone")
                put("osVersion", "18.3.2.22D82")
                put("hl", "en")
                put("gl", "US")
                put("userAgent", "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X)")
            })
        }

        val tvCtx = JSONObject().apply {
            put("client", JSONObject().apply {
                put("clientName", "TVHTML5_SIMPLY_EMBEDDED_PLAYER")
                put("clientVersion", "2.0")
                put("hl", "en")
                put("gl", "US")
                put("userAgent", "Mozilla/5.0 (PlayStation 4 5.55) AppleWebKit/601.2 (KHTML, like Gecko)")
            })
        }

        val androidMusicCtx = JSONObject().apply {
            put("client", JSONObject().apply {
                put("clientName", "ANDROID_MUSIC")
                put("clientVersion", "7.29.52")
                put("androidSdkVersion", 35)
                put("osName", "Android")
                put("osVersion", "15")
                put("hl", "en")
                put("gl", "US")
                put("userAgent", "com.google.android.apps.youtube.music/7.29.52 (Linux; U; Android 15) gzip")
            })
        }

        return listOf(
            ClientCtx("ANDROID_VR", androidVrCtx, "com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12L; GB) gzip"),
            ClientCtx("IOS", iosCtx, "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X)"),
            ClientCtx("TVHTML5_SIMPLY_EMBEDDED_PLAYER", tvCtx, "Mozilla/5.0 (PlayStation 4 5.55) AppleWebKit/601.2 (KHTML, like Gecko)"),
            ClientCtx("ANDROID_MUSIC", androidMusicCtx, "com.google.android.apps.youtube.music/7.29.52 (Linux; U; Android 15) gzip"),
        )
    }

    private fun attempt(videoId: String, ctx: ClientCtx): Pair<String, Int>? {
        val body = JSONObject().apply {
            put("context", ctx.jsonContext)
            put("videoId", videoId)
            put("contentCheckOk", true)
            put("racyCheckOk", true)
            put("playbackContext", JSONObject().apply {
                put("contentPlaybackContext", JSONObject().apply { put("html5Preference", "HTML5_PREF_WANTS") })
            })
        }.toString()

        val req = Request.Builder()
            .url(ENDPOINT)
            .header("Content-Type", "application/json")
            .header("User-Agent", ctx.userAgent)
            .header("Origin", "https://www.youtube.com")
            .header("X-Goog-Api-Format-Version", "2")
            .post(body.toRequestBody("application/json".toMediaType()))
            .build()

        http.newCall(req).execute().use { resp ->
            if (!resp.isSuccessful) return null
            val raw = resp.body?.string() ?: return null
            val json = JSONObject(raw)
            val status = json.optJSONObject("playabilityStatus")?.optString("status")
            if (status != null && status != "OK") return null
            val adaptive = json.optJSONObject("streamingData")?.optJSONArray("adaptiveFormats") ?: JSONArray()
            return pickBestAudio(adaptive)
        }
    }

    private fun pickBestAudio(adaptive: JSONArray): Pair<String, Int>? {
        var best251: Pair<String, Int>? = null
        var best140: Pair<String, Int>? = null
        var bestOther: Pair<String, Int>? = null
        var bestOtherBitrate = -1

        for (i in 0 until adaptive.length()) {
            val f = adaptive.optJSONObject(i) ?: continue
            val mime = f.optString("mimeType", "")
            if (!mime.startsWith("audio/")) continue
            val url = f.optString("url", "")
            if (url.isEmpty()) continue
            val itag = f.optInt("itag", 0)
            val bitrate = f.optInt("bitrate", 0)
            when (itag) {
                251 -> best251 = url to itag
                140 -> best140 = url to itag
                else -> if (bitrate > bestOtherBitrate) {
                    bestOther = url to itag
                    bestOtherBitrate = bitrate
                }
            }
        }
        return best251 ?: best140 ?: bestOther
    }
}