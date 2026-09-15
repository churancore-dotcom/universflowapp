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

    /** Best-effort: returns the most likely official videoId, or null. */
    fun searchVideoId(title: String, artist: String): String? {
        if (title.isBlank()) return null
        peek(title, artist)?.let { return it }
        return try {
            val body = JSONObject().apply {
                put("context", JSONObject().apply {
                    put("client", JSONObject().apply {
                        put("clientName", "ANDROID_MUSIC")
                        put("clientVersion", "7.27.52")
                        put("androidSdkVersion", 34)
                        put("osName", "Android")
                        put("osVersion", "14")
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
                .header("User-Agent", "com.google.android.apps.youtube.music/7.27.52 (Linux; U; Android 14) gzip")
                .header("X-YouTube-Client-Name", "21")
                .header("X-YouTube-Client-Version", "7.27.52")
                .header("Content-Type", "application/json")
                .build()

            http.newCall(req).execute().use { res ->
                if (!res.isSuccessful) {
                    Log.w(TAG, "search HTTP ${res.code}")
                    return null
                }
                val json = JSONObject(res.body?.string().orEmpty())
                val best = pickBest(collectCandidates(json), title, artist) ?: return null
                cache[key(title, artist)] = Hit(best, System.currentTimeMillis())
                Log.d(TAG, "matched '$title' / '$artist' -> $best")
                best
            }
        } catch (t: Throwable) {
            Log.w(TAG, "search failed: ${t.message}")
            null
        }
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
