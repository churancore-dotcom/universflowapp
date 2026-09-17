package com.universeflow.app

import android.util.Log
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * Metadata → videoId lookup for deep mode.
 *
 * [MasterResolver] can only hand [NativeYouTubeResolver] a videoId. Tracks that
 * come from JioSaavn/Audius/library rows have no videoId, so deep mode needs a
 * search step first. This uses the public InnerTube *search* endpoint with the
 * ANDROID_MUSIC client, which needs no PoToken and no signed-in session.
 *
 * Results are filtered to song-like items and scored on title/artist overlap so
 * covers, live takes, reactions and "slowed + reverb" edits do not win.
 */
object YouTubeSearch {

    private const val TAG = "YouTubeSearch"
    private const val ENDPOINT = "https://music.youtube.com/youtubei/v1/search?prettyPrint=false"
    /** Filter param for "Songs" results only (public, stable InnerTube constant). */
    private const val SONGS_FILTER = "EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D"
    private const val CACHE_TTL_MS = 6L * 60L * 60L * 1000L

    private data class Hit(val videoId: String, val at: Long)

    private val cache = java.util.concurrent.ConcurrentHashMap<String, Hit>()

    private val http: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(2500, TimeUnit.MILLISECONDS)
            .readTimeout(3500, TimeUnit.MILLISECONDS)
            .callTimeout(4000, TimeUnit.MILLISECONDS)
            .retryOnConnectionFailure(true)
            .build()
    }

    private fun norm(s: String) = s.lowercase()
        .replace(Regex("\\(.*?\\)|\\[.*?]"), " ")
        .replace(Regex("[^a-z0-9]+"), " ")
        .trim()

    private fun key(title: String, artist: String) = "${norm(title)}|${norm(artist)}"

    fun peek(title: String, artist: String): String? {
        val hit = cache[key(title, artist)] ?: return null
        if (System.currentTimeMillis() - hit.at > CACHE_TTL_MS) {
            cache.remove(key(title, artist))
            return null
        }
        return hit.videoId
    }

    /**
     * Search identities. ANDROID_MUSIC needs no PoToken and no session; the
     * WEB_REMIX (music.youtube.com web) identity is tried only when the mobile
     * one is refused or returns nothing usable, so a single stale/blocked
     * client can no longer cost the track its videoId.
     */
    private data class SearchClient(
        val name: String,
        val version: String,
        val clientId: String,
        val userAgent: String,
        val android: Boolean,
    )

    private val CLIENTS = listOf(
        SearchClient(
            "ANDROID_MUSIC", "8.16.53", "21",
            "com.google.android.apps.youtube.music/8.16.53 (Linux; U; Android 14) gzip",
            android = true,
        ),
        SearchClient(
            "WEB_REMIX", "1.20260707.12.00", "67",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
                "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            android = false,
        ),
    )

    /** Best-effort: returns the most likely official videoId, or null. */
    fun searchVideoId(title: String, artist: String): String? =
        searchVideoIds(title, artist, limit = 1).firstOrNull()

    /**
     * Ranked videoId candidates, best first. [MasterResolver] walks this list:
     * if the top match returns no playable stream (age gate, region block,
     * SABR-only edge), the next acceptable match still gets a chance instead of
     * the whole YouTube path counting as a miss.
     */
    fun searchVideoIds(title: String, artist: String, limit: Int = 3): List<String> {
        if (title.isBlank()) return emptyList()
        val out = LinkedHashSet<String>()
        peek(title, artist)?.let { out.add(it) }
        for (client in CLIENTS) {
            if (out.size >= limit) break
            rank(fetchCandidates(title, artist, client), title, artist).forEach {
                if (out.size < limit) out.add(it)
            }
        }
        out.firstOrNull()?.let { cache[key(title, artist)] = Hit(it, System.currentTimeMillis()) }
        if (out.isNotEmpty()) Log.d(TAG, "matched '$title' / '$artist' -> $out")
        return out.toList()
    }

    private fun fetchCandidates(
        title: String,
        artist: String,
        client: SearchClient,
    ): List<Candidate> = try {
        val body = JSONObject().apply {
            put("context", JSONObject().apply {
                put("client", JSONObject().apply {
                    put("clientName", client.name)
                    put("clientVersion", client.version)
                    if (client.android) {
                        put("androidSdkVersion", 34)
                        put("osName", "Android")
                        put("osVersion", "14")
                    }
                    put("hl", "en")
                    put("gl", "IN")
                })
            })
            put("query", listOf(title, artist).filter { it.isNotBlank() }.joinToString(" "))
            put("params", java.net.URLDecoder.decode(SONGS_FILTER, "UTF-8"))
        }.toString()

        val req = Request.Builder()
            .url(ENDPOINT)
            .post(body.toRequestBody("application/json".toMediaType()))
            .header("User-Agent", client.userAgent)
            .header("X-YouTube-Client-Name", client.clientId)
            .header("X-YouTube-Client-Version", client.version)
            .header("Content-Type", "application/json")
            .build()

        http.newCall(req).execute().use { res ->
            if (!res.isSuccessful) {
                Log.w(TAG, "search HTTP ${res.code} via ${client.name}")
                emptyList()
            } else {
                collectCandidates(JSONObject(res.body?.string().orEmpty()))
            }
        }
    } catch (t: Throwable) {
        Log.w(TAG, "search failed via ${client.name}: ${t.message}")
        emptyList()
    }

    private data class Candidate(val videoId: String, val title: String, val subtitle: String)

    /** Walk the response for musicResponsiveListItemRenderer entries. */
    private fun collectCandidates(root: JSONObject): List<Candidate> {
        val out = ArrayList<Candidate>()
        fun runsText(node: JSONObject?): String {
            val runs = node?.optJSONArray("runs") ?: return ""
            return (0 until runs.length()).joinToString("") { runs.optJSONObject(it)?.optString("text").orEmpty() }
        }
        fun walk(node: Any?) {
            when (node) {
                is JSONObject -> {
                    node.optJSONObject("musicResponsiveListItemRenderer")?.let { item ->
                        val flex = item.optJSONArray("flexColumns")
                        val titleNode = flex?.optJSONObject(0)
                            ?.optJSONObject("musicResponsiveListItemFlexColumnRenderer")?.optJSONObject("text")
                        val subNode = flex?.optJSONObject(1)
                            ?.optJSONObject("musicResponsiveListItemFlexColumnRenderer")?.optJSONObject("text")
                        val vid = item.optJSONObject("playlistItemData")?.optString("videoId")
                            ?.takeIf { it.length == 11 }
                            ?: titleNode?.optJSONArray("runs")?.optJSONObject(0)
                                ?.optJSONObject("navigationEndpoint")?.optJSONObject("watchEndpoint")
                                ?.optString("videoId")?.takeIf { it.length == 11 }
                        if (vid != null) out.add(Candidate(vid, runsText(titleNode), runsText(subNode)))
                    }
                    node.keys().forEach { walk(node.opt(it)) }
                }
                is JSONArray -> (0 until node.length()).forEach { walk(node.opt(it)) }
            }
        }
        walk(root)
        return out.distinctBy { it.videoId }.take(12)
    }

    private fun pickBest(candidates: List<Candidate>, title: String, artist: String): String? {
        if (candidates.isEmpty()) return null
        val wantTitle = norm(title)
        val wantArtist = norm(artist)
        val titleTokens = wantTitle.split(' ').filter { it.length > 1 }
        var best: Candidate? = null
        var bestScore = Int.MIN_VALUE
        for (c in candidates) {
            val ct = norm(c.title)
            val cs = norm(c.subtitle)
            var score = 0
            if (ct == wantTitle) score += 1000
            if (ct.startsWith(wantTitle) || ct.contains(wantTitle)) score += 400
            score += titleTokens.count { ct.contains(it) } * 90
            if (wantArtist.isNotBlank() && cs.contains(wantArtist)) score += 350
            if (Regex("\\b(cover|karaoke|live|remix|slowed|reverb|sped|instrumental|8d|lofi|mashup|reaction)\\b")
                    .containsMatchIn("$ct $cs")
                && !Regex("\\b(cover|remix|live|instrumental|lofi)\\b").containsMatchIn("$wantTitle $wantArtist")
            ) score -= 700
            if (score > bestScore) { bestScore = score; best = c }
        }
        // Require a real overlap; a confident wrong song is worse than a miss.
        return if (bestScore >= 300) best?.videoId else null
    }
}
