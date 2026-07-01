package com.universeflow.app

import android.util.Log
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.net.URLEncoder
import java.util.Locale
import java.util.concurrent.TimeUnit
import javax.crypto.Cipher
import javax.crypto.spec.SecretKeySpec
import android.util.Base64

/**
 * Lightweight JioSaavn search + media-URL decoder.
 *
 * - Search: `https://www.jiosaavn.com/api.php?__call=search.getResults`
 * - Decrypts `encrypted_media_url` (DES/ECB/PKCS5Padding, key "38346591").
 * - Rewrites the resulting `.mp4` template to `_320.mp4` (or `_160`/`_96`)
 *   so we get a direct CDN URL we can hand straight to ExoPlayer.
 *
 * This is preferred over YouTube resolution for matched tracks because the
 * URL has no signature cipher, no expiry games and is typically faster.
 */
object JioSaavnClient {

    private const val TAG = "JioSaavnClient"
    private const val DES_KEY = "38346591"
    // 30 minutes is conservative; JioSaavn CDN URLs are usually valid for hours.
    private const val EXPIRY_MS = 30L * 60L * 1000L

    private val http: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(2500, TimeUnit.MILLISECONDS)
            .readTimeout(4500, TimeUnit.MILLISECONDS)
            .callTimeout(5500, TimeUnit.MILLISECONDS)
            .retryOnConnectionFailure(true)
            .build()
    }

    data class SaavnHit(
        val url: String,
        val bitrateKbps: Int,
        val expiresAt: Long,
        val saavnId: String,
        val title: String,
        val artist: String,
    )

    fun searchAndResolve(title: String, artist: String): SaavnHit? {
        if (title.isBlank()) return null
        // Require an artist signal — without it we cannot safely disambiguate
        // covers, live versions, lyric uploads, remixes, etc.
        if (artist.isBlank()) return null
        // Reject titles that clearly signal a specific version so we don't silently
        // swap a live/acoustic/slowed/remix upload for the studio master.
        val versionMarker = Regex(
            "\\b(live|acoustic|unplugged|remix|slowed|reverb|sped\\s*up|nightcore|karaoke|instrumental|cover|lofi|lo-?fi|8d|mashup|lyric[s]?\\s*video|extended|edit|mix|version|reprise)\\b",
            RegexOption.IGNORE_CASE,
        )
        if (versionMarker.containsMatchIn(title)) return null
        return try {
            val q = "$title $artist".trim()
            val url = "https://www.jiosaavn.com/api.php" +
                "?p=1&q=" + URLEncoder.encode(q, "UTF-8") +
                "&_format=json&_marker=0&api_version=4&ctx=web6dot0&n=8&__call=search.getResults"
            val req = Request.Builder()
                .url(url)
                .header("User-Agent", "Mozilla/5.0 (Linux; Android 14; UniverseFlow)")
                .header("Accept", "application/json")
                .build()
            val body = http.newCall(req).execute().use { resp ->
                if (!resp.isSuccessful) return null
                resp.body?.string() ?: return null
            }
            val json = try { JSONObject(body) } catch (_: Throwable) { return null }
            val results = json.optJSONArray("results") ?: return null
            val targetTitle = norm(title)
            val targetArtistTokens = tokens(artist)
            if (targetArtistTokens.isEmpty()) return null


            for (i in 0 until results.length()) {
                val item = results.optJSONObject(i) ?: continue
                val cTitle = item.optString("title", "")
                val more = item.optJSONObject("more_info") ?: continue
                val encrypted = more.optString("encrypted_media_url", "")
                if (encrypted.isBlank()) continue
                val cArtist = more.optJSONObject("artistMap")
                    ?.optJSONArray("primary_artists")
                    ?.let { arr ->
                        val sb = StringBuilder()
                        for (j in 0 until arr.length()) {
                            sb.append(arr.optJSONObject(j)?.optString("name", "") ?: "")
                            sb.append(' ')
                        }
                        sb.toString()
                    } ?: more.optString("singers", "")

                // Strict match: normalized titles equal AND artist token Jaccard >= 0.70.
                // When the caller has no artist string, require exact title equality only
                // (still safer than the old "any overlap" rule because title must equal).
                if (norm(cTitle) != targetTitle) continue
                val cArtistTokens = tokens(cArtist)
                if (targetArtistTokens.isNotEmpty()) {
                    val inter = cArtistTokens.intersect(targetArtistTokens).size.toDouble()
                    val union = (cArtistTokens + targetArtistTokens).size.toDouble()
                    val jaccard = if (union == 0.0) 0.0 else inter / union
                    if (jaccard < 0.70) {
                        Log.d(TAG, "skip JioSaavn hit (jaccard=$jaccard) cArtist='$cArtist' target='$artist'")
                        continue
                    }
                }

                val bitrate = more.optInt("320kbps", 0).let { if (it == 1) 320 else 160 }
                val resolved = buildStreamUrl(encrypted, bitrate) ?: continue
                return SaavnHit(
                    url = resolved,
                    bitrateKbps = bitrate,
                    expiresAt = System.currentTimeMillis() + EXPIRY_MS,
                    saavnId = item.optString("id", ""),
                    title = cTitle,
                    artist = cArtist.trim(),
                )
            }
            null
        } catch (t: Throwable) {
            Log.w(TAG, "searchAndResolve failed: ${t.message}")
            null
        }
    }

    private fun buildStreamUrl(encrypted: String, bitrateKbps: Int): String? {
        val decoded = try { decrypt(encrypted) } catch (t: Throwable) {
            Log.w(TAG, "decrypt failed: ${t.message}"); return null
        } ?: return null
        val template = decoded.replace("http://", "https://").trim()
        // Replace the bitrate suffix in the auth URL template.
        val suffix = when {
            bitrateKbps >= 320 -> "_320.mp4"
            bitrateKbps >= 160 -> "_160.mp4"
            else -> "_96.mp4"
        }
        return template.replace("_96.mp4", suffix).replace("_h.mp4", suffix)
    }

    private fun decrypt(b64: String): String? {
        val key = SecretKeySpec(DES_KEY.toByteArray(Charsets.UTF_8), "DES")
        val cipher = Cipher.getInstance("DES/ECB/PKCS5Padding")
        cipher.init(Cipher.DECRYPT_MODE, key)
        val raw = Base64.decode(b64, Base64.DEFAULT)
        val out = cipher.doFinal(raw) ?: return null
        return String(out, Charsets.UTF_8).trim()
    }

    private fun norm(s: String): String =
        s.lowercase(Locale.US)
            .replace(Regex("\\(.*?\\)"), " ")
            .replace(Regex("\\[.*?]"), " ")
            .replace(Regex("[^a-z0-9 ]"), " ")
            .replace(Regex("\\s+"), " ")
            .trim()

    private fun tokens(s: String): Set<String> =
        norm(s).split(' ').filter { it.length >= 3 }.toSet()
}
