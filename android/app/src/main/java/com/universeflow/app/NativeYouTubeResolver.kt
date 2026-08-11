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
 * Clean-room implementation of the InnerTube technique used by NewPipe /
 * EchoMusic / InnerTune. Only PUBLIC constants (client IDs, endpoint path,
 * header names) are borrowed — no GPL source is reproduced.
 *
 * Strategy (updated 2026):
 *  - Race ANDROID_VR (1.61.48 + 1.43.32), IOS (21.03.x), ANDROID_MUSIC,
 *    ANDROID_CREATOR on-device in parallel. All are PoToken-free.
 *  - WEB / WEB_REMIX are NOT in the race: YouTube now returns SABR-only
 *    responses for those clients, requires PoToken from a BotGuard WebView,
 *    and the effort/quality tradeoff isn't worth it for audio-only playback.
 *  - Each request carries X-YouTube-Client-Name / -Version / X-Goog-Visitor-Id
 *    headers so YouTube's edge routes it as a genuine mobile client.
 *  - visitorData is fetched once at warm-up and cached for process lifetime.
 *  - SABR responses (empty adaptiveFormats + serverAbrStreamingUrl) are
 *    detected and treated as failure so the race moves on immediately.
 */
object NativeYouTubeResolver {
    private const val TAG = "NativeYouTubeResolver"
    private const val ENDPOINT = "https://www.youtube.com/youtubei/v1/player?prettyPrint=false"
    private const val CACHE_TTL_MS = 5L * 60L * 60L * 1000L

    private data class CachedStream(val url: String, val itag: Int, val client: String, val ts: Long)
    private data class ClientCtx(
        val name: String,
        val clientId: String,          // numeric string for X-YouTube-Client-Name
        val clientVersion: String,     // for X-YouTube-Client-Version
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

    // ── visitorData: session identifier that makes InnerTube trust us. ─────
    // Persisted to SharedPreferences so cold starts skip the extra sw.js_data
    // fetch (~400-800ms) before the first play after app launch.
    private const val VISITOR_PREFS = "uf_innertube"
    private const val VISITOR_KEY = "visitor_data"
    private const val VISITOR_TS_KEY = "visitor_ts"
    private const val VISITOR_MAX_AGE_MS = 30L * 24L * 60L * 60L * 1000L // 30d

    @Volatile private var visitorData: String? = null
    @Volatile private var appContext: android.content.Context? = null

    /** Called from InnerTubePlugin.load() / ExoPlayerPlugin.load(). */
    fun attach(ctx: android.content.Context) {
        if (appContext == null) {
            appContext = ctx.applicationContext
            try {
                val prefs = ctx.applicationContext.getSharedPreferences(VISITOR_PREFS, android.content.Context.MODE_PRIVATE)
                val v = prefs.getString(VISITOR_KEY, null)
                val ts = prefs.getLong(VISITOR_TS_KEY, 0L)
                if (!v.isNullOrBlank() && System.currentTimeMillis() - ts < VISITOR_MAX_AGE_MS) {
                    visitorData = v
                    Log.d(TAG, "rehydrated visitorData from disk")
                }
            } catch (_: Throwable) { /* best effort */ }
        }
    }

    private fun persistVisitorData(v: String) {
        val ctx = appContext ?: return
        try {
            ctx.getSharedPreferences(VISITOR_PREFS, android.content.Context.MODE_PRIVATE)
                .edit()
                .putString(VISITOR_KEY, v)
                .putLong(VISITOR_TS_KEY, System.currentTimeMillis())
                .apply()
        } catch (_: Throwable) { /* best effort */ }
    }

    private fun setVisitorData(v: String) {
        visitorData = v
        persistVisitorData(v)
    }

    private fun fetchVisitorData(): String? {
        visitorData?.let { return it }
        return try {
            val req = Request.Builder()
                .url("https://www.youtube.com/sw.js_data")
                .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
                .header("Accept-Language", "en-US,en;q=0.9")
                .build()
            http.newCall(req).execute().use { resp ->
                val body = resp.body?.string() ?: return null
                val json = body.substringAfter(")]}'").trim()
                val m = Regex("\"([A-Za-z0-9_%\\-]{40,})\"").find(json)
                val v = m?.groupValues?.get(1)
                if (v != null) setVisitorData(v)
                v
            }
        } catch (_: Throwable) { null }
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
            // Only pay the network cost if no persisted value survived.
            if (visitorData == null) {
                try { fetchVisitorData() } catch (_: Throwable) {}
            }
            // Compile player.js now so the FIRST tap doesn't pay for it.
            try { PlayerJsManager.prewarm() } catch (_: Throwable) {}

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

    /** Drop a cached entry so the next resolve() re-hits InnerTube. */
    fun invalidate(videoId: String) {
        if (videoId.length == 11) streamCache.remove(videoId)
    }

    /** Stale cache for emergency fallback (within 30 min past TTL). */
    fun getStale(videoId: String): NativeResolvedStream? {
        val c = streamCache[videoId] ?: return null
        val age = System.currentTimeMillis() - c.ts
        if (age > CACHE_TTL_MS + 30L * 60L * 1000L) return null
        return NativeResolvedStream(c.url, c.itag, c.client)
    }

    // ── Client definitions ─────────────────────────────────────────────────
    // Constants below are public InnerTube protocol facts:
    //   • numeric clientId is YouTube's INNERTUBE_CONTEXT_CLIENT_NAME enum
    //   • clientVersion strings match current shipping mobile apps
    //   • userAgent strings follow Google's documented app UA format
    // No GPL source is reproduced; only public spec values.
    private fun buildClients(): List<ClientCtx> {
        val visitor = visitorData  // may be null on first call; that's fine

        fun ctxJson(client: JSONObject): JSONObject = JSONObject().apply {
            if (visitor != null) client.put("visitorData", visitor)
            put("client", client)
        }

        // ANDROID_VR 1.61.48 — primary PoToken-free client (Meta Quest UA).
        val vr161 = ctxJson(JSONObject().apply {
            put("clientName", "ANDROID_VR")
            put("clientVersion", "1.61.48")
            put("deviceMake", "Oculus")
            put("deviceModel", "Quest 3")
            put("androidSdkVersion", 32)
            put("osName", "Android")
            put("osVersion", "12L")
            put("hl", "en"); put("gl", "US")
        })

        // ANDROID_VR 1.43.32 — older but still accepted; useful when 1.61 is
        // rate-limited on a given edge node.
        val vr143 = ctxJson(JSONObject().apply {
            put("clientName", "ANDROID_VR")
            put("clientVersion", "1.43.32")
            put("deviceMake", "Oculus")
            put("deviceModel", "Quest 2")
            put("androidSdkVersion", 32)
            put("osName", "Android")
            put("osVersion", "12L")
            put("hl", "en"); put("gl", "US")
        })

        // IOS 21.03.2 — Apple attestation, no PoToken required.
        val ios = ctxJson(JSONObject().apply {
            put("clientName", "IOS")
            put("clientVersion", "21.03.2")
            put("deviceMake", "Apple")
            put("deviceModel", "iPhone16,2")
            put("osName", "iPhone")
            put("osVersion", "18.7.2.22H124")
            put("hl", "en"); put("gl", "US")
        })

        // ANDROID_MUSIC — good for music-specific responses.
        val androidMusic = ctxJson(JSONObject().apply {
            put("clientName", "ANDROID_MUSIC")
            put("clientVersion", "7.29.52")
            put("androidSdkVersion", 35)
            put("osName", "Android")
            put("osVersion", "15")
            put("hl", "en"); put("gl", "US")
        })

        // ANDROID_CREATOR — Creator Studio client; PoToken-free.
        val androidCreator = ctxJson(JSONObject().apply {
            put("clientName", "ANDROID_CREATOR")
            put("clientVersion", "24.45.100")
            put("androidSdkVersion", 34)
            put("osName", "Android")
            put("osVersion", "14")
            put("hl", "en"); put("gl", "US")
        })

        // clientId 28 = ANDROID_VR in YouTube's INNERTUBE_CONTEXT_CLIENT_NAME
        // enum. Sending the wrong numeric id makes the edge distrust the client
        // and reply with SABR-only / 403-prone URLs.
        return listOf(
            ClientCtx("ANDROID_VR_1_43", "28", "1.43.32", vr143,
                "com.google.android.apps.youtube.vr.oculus/1.43.32 (Linux; U; Android 12L; GB) gzip"),
            ClientCtx("ANDROID_VR", "28", "1.61.48", vr161,
                "com.google.android.apps.youtube.vr.oculus/1.61.48 (Linux; U; Android 12L; GB) gzip"),
            ClientCtx("IOS", "5", "21.03.2", ios,
                "com.google.ios.youtube/21.03.2 (iPhone16,2; U; CPU iOS 18_7_2 like Mac OS X)"),
            ClientCtx("ANDROID_MUSIC", "21", "7.29.52", androidMusic,
                "com.google.android.apps.youtube.music/7.29.52 (Linux; U; Android 15) gzip"),
            ClientCtx("ANDROID_CREATOR", "14", "24.45.100", androidCreator,
                "com.google.android.apps.youtube.creator/24.45.100 (Linux; U; Android 14) gzip"),
        )

    }

    private fun attempt(videoId: String, ctx: ClientCtx): Pair<String, Int>? {
        val sts: String? = if (ctx.needsSts) PlayerJsManager.getSts() else null
        if (ctx.needsSts && sts == null) return null

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

        val reqBuilder = Request.Builder()
            .url(ENDPOINT)
            .header("Content-Type", "application/json")
            .header("User-Agent", ctx.userAgent)
            .header("Origin", "https://www.youtube.com")
            // NOTE: `X-Goog-Api-Format-Version: 2` was removed intentionally.
            // Sending it caused YouTube's edge to return SABR-only responses
            // (empty adaptiveFormats + serverAbrStreamingUrl) for the mobile
            // clients we race, which killed playback because ExoPlayer can't
            // consume SABR manifests. Default (JSON, no version pin) yields
            // progressive/adaptive URLs consistently.
            .header("X-YouTube-Client-Name", ctx.clientId)
            .header("X-YouTube-Client-Version", ctx.clientVersion)
        visitorData?.let { reqBuilder.header("X-Goog-Visitor-Id", it) }
        val req = reqBuilder
            .post(body.toRequestBody("application/json".toMediaType()))
            .build()

        http.newCall(req).execute().use { resp ->
            // Opportunistically pick up visitorData if the server issued one.
            if (visitorData == null) {
                resp.header("X-Goog-Visitor-Id")?.let { setVisitorData(it) }
            }
            if (!resp.isSuccessful) return null
            val raw = resp.body?.string() ?: return null
            val json = JSONObject(raw)
            val status = json.optJSONObject("playabilityStatus")?.optString("status")
            if (status != null && status != "OK") return null
            val streamingData = json.optJSONObject("streamingData") ?: return null
            val adaptive = streamingData.optJSONArray("adaptiveFormats") ?: JSONArray()
            // Adaptive audio first. The HEAD probe is only worth its round-trip
            // for URLs we had to decipher — a wrong signature is silent and the
            // probe is the only way to catch it. Plain `url=` formats from the
            // mobile clients are served as-is, so probing them just added
            // ~150-400ms of dead air to every single play. Skip it there.
            pickBestAudio(adaptive, ctx.name)?.let {
                val needsProbe = it.first.contains("&sig=") || it.first.contains("&signature=")
                if (!needsProbe || validate(it.first, ctx.userAgent)) return it
                Log.d(TAG, "adaptive URL rejected by CDN for ${ctx.name}")
            }

            // Fallback: progressive `formats` list (combined AV muxed) — better
            // than silence when YouTube ships SABR-only adaptive for this edge.
            // ExoPlayer will demux the audio track from the muxed stream.
            val progressive = streamingData.optJSONArray("formats") ?: JSONArray()
            pickBestAudio(progressive, ctx.name)?.let { return it }
            for (i in 0 until progressive.length()) {
                val f = progressive.optJSONObject(i) ?: continue
                val url = resolveFormatUrl(f) ?: continue
                return url to f.optInt("itag", 0)
            }

            if (streamingData.has("serverAbrStreamingUrl")) {
                Log.d(TAG, "SABR-only response from ${ctx.name}; skipping")
            }
            return null
        }
    }

    private fun pickBestAudio(adaptive: JSONArray, clientName: String): Pair<String, Int>? {
        // Echo's heuristic: only audio formats, only the ORIGINAL language track
        // (dubbed/auto-translated tracks otherwise win on bitrate and the user
        // hears a voiceover), then maximise bitrate with a bonus for opus/webm.
        var best: Pair<String, Int>? = null
        var bestScore = -1

        for (i in 0 until adaptive.length()) {
            val f = adaptive.optJSONObject(i) ?: continue
            val mime = f.optString("mimeType", "")
            if (!mime.startsWith("audio/")) continue
            val track = f.optJSONObject("audioTrack")
            val isOriginal = track == null || track.optBoolean("audioIsDefault", true) ||
                track.optString("id", "").contains(".original")
            if (!isOriginal) continue
            val url = resolveFormatUrl(f) ?: continue
            val itag = f.optInt("itag", 0)
            val score = f.optInt("bitrate", 0) + if (mime.contains("webm")) 10240 else 0
            if (score > bestScore) {
                best = url to itag
                bestScore = score
            }
        }
        if (best == null) Log.d(TAG, "no audio formats from $clientName")
        return best
    }

    /**
     * Echo-style HEAD probe: a googlevideo URL can parse fine yet 403 on the
     * first byte range. Validating before handing it to ExoPlayer keeps the race
     * moving to the next client instead of failing playback.
     *
     * A 403 on a URL we had to decipher is also the ONLY signal that our
     * signature extraction has silently rotted (a wrong-but-non-throwing
     * signature never raises), so we report it back to PlayerJsManager which
     * re-downloads player.js under a cooldown (zemer-cipher self-heal model).
     */
    private fun validate(url: String, userAgent: String): Boolean {
        return try {
            val req = Request.Builder()
                .url(url)
                .head()
                .header("User-Agent", userAgent)
                .build()
            http.newCall(req).execute().use { r ->
                if (!r.isSuccessful && r.code == 403 && (url.contains("&sig=") || url.contains("&signature="))) {
                    PlayerJsManager.onStreamRejected()
                }
                r.isSuccessful
            }
        } catch (_: Throwable) {
            false
        }
    }



    /**
     * Resolves a streamingData format into a fully signed, n-decoded URL.
     *  - Plain `url=` formats (mobile clients): only need n-param rewrite.
     *  - `signatureCipher=...` (WEB, if we ever add it back): need both sig
     *    deciphering and n-param rewrite via PlayerJsManager.
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
        // Do NOT reject the whole format if YouTube ships a player.js pattern we
        // cannot decipher yet. An un-rewritten `n` URL can be slower, but it is
        // still often playable; returning null here made every client in the race
        // fail and left ExoPlayer silent. Prefer "starts now, maybe throttled" to
        // "never starts".
        val withN = rewriteNParam(baseUrl) ?: baseUrl
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
