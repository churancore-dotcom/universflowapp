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
import java.net.URLDecoder
import java.net.URLEncoder
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
 * Echo / NewPipe-style architecture:
 *  - InnerTube /player POST from the user's phone IP
 *  - Race ANDROID_VR / IOS / TVHTML5 / ANDROID_MUSIC / WEB clients in parallel
 *  - For WEB streams (which are wrapped in signatureCipher + an n-param), use
 *    PlayerJsManager to decipher both on-device via Rhino — no backend hop.
 *  - 5h in-memory cache; results fed directly into ExoPlayer.
 */
object NativeYouTubeResolver {
    private const val TAG = "NativeYouTubeResolver"
    private const val ENDPOINT = "https://www.youtube.com/youtubei/v1/player?prettyPrint=false"
    private const val CACHE_TTL_MS = 5L * 60L * 60L * 1000L

    private data class CachedStream(val url: String, val itag: Int, val client: String, val ts: Long)
    private data class ClientCtx(
        val name: String,
        val jsonContext: JSONObject,
        val userAgent: String,
        val needsSts: Boolean = false,
    )

    private val streamCache = java.util.concurrent.ConcurrentHashMap<String, CachedStream>()
    private val raceExecutor = Executors.newFixedThreadPool(6)

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
            // Prime player.js so the first WEB-client resolve doesn't pay for it.
            try { PlayerJsManager.getSts() } catch (_: Throwable) {}
        }.start()
    }

    /** Returns a cached entry if present and within TTL — no network. */
    fun peek(videoId: String): NativeResolvedStream? {
        if (videoId.length != 11) return null
        val c = getCached(videoId) ?: return null
        return NativeResolvedStream(c.url, c.itag, c.client)
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

    /**
     * Allow an external resolver (e.g. JioSaavn) to seed a directly-playable
     * URL keyed by the YouTube videoId. ExoPlayer's ResolvingDataSource asks
     * for `yt://<videoId>` and will now get this URL back with zero network
     * calls — same fast path as a YT cache hit.
     */
    fun putCached(videoId: String, url: String, source: String) {
        if (videoId.length != 11 || url.isBlank()) return
        streamCache[videoId] = CachedStream(url, /* itag */ 0, source, System.currentTimeMillis())
    }

    /** Stale cache for emergency fallback (within 30 min past TTL). */
    fun getStale(videoId: String): NativeResolvedStream? {
        val c = streamCache[videoId] ?: return null
        val age = System.currentTimeMillis() - c.ts
        if (age > CACHE_TTL_MS + 30L * 60L * 1000L) return null
        return NativeResolvedStream(c.url, c.itag, c.client)
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

        val webCtx = JSONObject().apply {
            put("client", JSONObject().apply {
                put("clientName", "WEB")
                put("clientVersion", "2.20241008.00.00")
                put("hl", "en")
                put("gl", "US")
                put("userAgent", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36")
            })
        }

        return listOf(
            ClientCtx("ANDROID_VR", androidVrCtx, "com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12L; GB) gzip"),
            ClientCtx("IOS", iosCtx, "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X)"),
            ClientCtx("TVHTML5_SIMPLY_EMBEDDED_PLAYER", tvCtx, "Mozilla/5.0 (PlayStation 4 5.55) AppleWebKit/601.2 (KHTML, like Gecko)"),
            ClientCtx("ANDROID_MUSIC", androidMusicCtx, "com.google.android.apps.youtube.music/7.29.52 (Linux; U; Android 15) gzip"),
            // WEB requires sts + sig/n deciphering — only race it if PlayerJsManager is ready.
            ClientCtx("WEB", webCtx, "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36", needsSts = true),
        )
    }

    private fun attempt(videoId: String, ctx: ClientCtx): Pair<String, Int>? {
        val sts: String? = if (ctx.needsSts) PlayerJsManager.getSts() else null
        if (ctx.needsSts && sts == null) return null  // WEB without sts is hopeless.

        val body = JSONObject().apply {
            put("context", ctx.jsonContext)
            put("videoId", videoId)
            put("contentCheckOk", true)
            put("racyCheckOk", true)
            put("playbackContext", JSONObject().apply {
                put("contentPlaybackContext", JSONObject().apply {
                    put("html5Preference", "HTML5_PREF_WANTS")
                    if (sts != null) put("signatureTimestamp", sts.toInt())
                })
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
            return pickBestAudio(adaptive, ctx.name)
        }
    }

    private fun pickBestAudio(adaptive: JSONArray, clientName: String): Pair<String, Int>? {
        var best251: Pair<String, Int>? = null
        var best140: Pair<String, Int>? = null
        var bestOther: Pair<String, Int>? = null
        var bestOtherBitrate = -1

        for (i in 0 until adaptive.length()) {
            val f = adaptive.optJSONObject(i) ?: continue
            val mime = f.optString("mimeType", "")
            if (!mime.startsWith("audio/")) continue
            val itag = f.optInt("itag", 0)
            val bitrate = f.optInt("bitrate", 0)
            val url = resolveFormatUrl(f) ?: continue
            when (itag) {
                251 -> best251 = url to itag
                140 -> best140 = url to itag
                else -> if (bitrate > bestOtherBitrate) {
                    bestOther = url to itag
                    bestOtherBitrate = bitrate
                }
            }
        }
        val picked = best251 ?: best140 ?: bestOther
        if (picked == null) Log.d(TAG, "no audio formats from $clientName")
        return picked
    }

    /**
     * Resolves a streamingData format into a fully signed, n-decoded URL.
     *  - Plain `url=` formats (mobile/TV clients): only need n-param rewrite.
     *  - `signatureCipher=...&s=...&sp=sig&url=...` (WEB client): need both
     *    sig deciphering and n-param rewrite via PlayerJsManager.
     * Returns null if any required step fails — caller falls back to next client.
     */
    private fun resolveFormatUrl(f: JSONObject): String? {
        val direct = f.optString("url", "")
        val cipher = f.optString("signatureCipher", "").ifEmpty { f.optString("cipher", "") }
        val baseUrl: String
        val maybeSig: String?
        val sigParamName: String

        if (direct.isNotEmpty()) {
            baseUrl = direct
            maybeSig = null
            sigParamName = "sig"
        } else if (cipher.isNotEmpty()) {
            val parts = parseQuery(cipher)
            val u = parts["url"] ?: return null
            val s = parts["s"] ?: return null
            val sp = parts["sp"] ?: "signature"
            val decoded = PlayerJsManager.decipherSignature(s) ?: return null
            baseUrl = u
            maybeSig = decoded
            sigParamName = sp
        } else {
            return null
        }

        // n-param rewrite (throttling). Applies to both plain and ciphered URLs.
        val withN = rewriteNParam(baseUrl) ?: return null
        return if (maybeSig != null) appendQueryParam(withN, sigParamName, maybeSig) else withN
    }

    private fun rewriteNParam(url: String): String? {
        val nIdx = url.indexOf("&n=").takeIf { it >= 0 } ?: url.indexOf("?n=").takeIf { it >= 0 }
            ?: return url  // no n-param — nothing to do
        val start = nIdx + 3
        val end = url.indexOf('&', start).let { if (it < 0) url.length else it }
        val original = url.substring(start, end)
        val decoded = try { URLDecoder.decode(original, "UTF-8") } catch (_: Throwable) { original }
        val rewritten = PlayerJsManager.decipherNParam(decoded) ?: return null
        val encoded = try { URLEncoder.encode(rewritten, "UTF-8") } catch (_: Throwable) { rewritten }
        return url.substring(0, start) + encoded + url.substring(end)
    }

    private fun appendQueryParam(url: String, key: String, value: String): String {
        val sep = if (url.contains('?')) '&' else '?'
        val encoded = try { URLEncoder.encode(value, "UTF-8") } catch (_: Throwable) { value }
        return "$url$sep$key=$encoded"
    }

    private fun parseQuery(qs: String): Map<String, String> {
        val out = HashMap<String, String>()
        for (pair in qs.split('&')) {
            val eq = pair.indexOf('=')
            if (eq <= 0) continue
            val k = pair.substring(0, eq)
            val v = pair.substring(eq + 1)
            out[k] = try { URLDecoder.decode(v, "UTF-8") } catch (_: Throwable) { v }
        }
        return out
    }
}
