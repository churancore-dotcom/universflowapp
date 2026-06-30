package com.universeflow.app

import android.util.Log

/**
 * Two-tier on-device stream resolver chain:
 *
 *  1. JioSaavn (title + artist search) — direct CDN URL, no cipher.
 *  2. YouTube InnerTube via [NativeYouTubeResolver] — racing 5 clients.
 *  3. Stale-cache emergency fallback (within 30 min past TTL).
 *
 * Resolved URLs are seeded into [NativeYouTubeResolver]'s cache keyed by the
 * YouTube videoId so that ExoPlayer's `yt://<videoId>` ResolvingDataSource
 * picks them up transparently.
 */
object MasterResolver {

    private const val TAG = "MasterResolver"

    data class Resolved(val url: String, val source: String, val expiresAt: Long)

    /**
     * Resolve a single track. If [title]+[artist] are present we try JioSaavn
     * first (Indian/Bollywood catalog is almost always faster and cipher-free),
     * then fall back to YouTube InnerTube on miss.
     */
    fun resolve(
        videoId: String?,
        title: String?,
        artist: String?,
        timeoutMs: Long = 5200L,
    ): Resolved? {
        // Cache check first via the YT resolver — covers both YT and seeded
        // JioSaavn entries since both use videoId as the key.
        if (!videoId.isNullOrBlank() && videoId.length == 11) {
            NativeYouTubeResolver.resolve(videoId, timeoutMs = 0L)?.let { hit ->
                // resolve() with timeout=0 just returns a cached value if any.
                return Resolved(hit.url, hit.client, System.currentTimeMillis() + 60_000L)
            }
        }

        // JioSaavn first.
        if (!title.isNullOrBlank()) {
            try {
                val saavn = JioSaavnClient.searchAndResolve(title, artist ?: "")
                if (saavn != null) {
                    if (!videoId.isNullOrBlank() && videoId.length == 11) {
                        NativeYouTubeResolver.putCached(videoId, saavn.url, "jiosaavn")
                    }
                    Log.d(TAG, "JioSaavn hit for $title / $artist -> ${saavn.bitrateKbps}kbps")
                    return Resolved(saavn.url, "jiosaavn", saavn.expiresAt)
                }
            } catch (t: Throwable) {
                Log.w(TAG, "JioSaavn lookup error: ${t.message}")
            }
        }

        // YouTube fallback.
        if (!videoId.isNullOrBlank() && videoId.length == 11) {
            NativeYouTubeResolver.resolve(videoId, timeoutMs = timeoutMs)?.let { yt ->
                return Resolved(yt.url, "youtube:${yt.client}", System.currentTimeMillis() + 4L * 3600L * 1000L)
            }
            // Last-resort: stale cache within grace window.
            NativeYouTubeResolver.getStale(videoId)?.let { stale ->
                Log.w(TAG, "using stale cache for $videoId")
                return Resolved(stale.url, "stale:${stale.client}", System.currentTimeMillis() + 60_000L)
            }
        }
        return null
    }

    /**
     * Pre-resolve up to [limit] tracks in parallel on a background pool.
     * Used by ExoPlayerPlugin.preloadQueue / playQueue warm-up.
     */
    fun prefetch(tracks: List<Triple<String?, String?, String?>>, limit: Int = 5) {
        tracks.take(limit).forEach { (vid, title, artist) ->
            Thread {
                try { resolve(vid, title, artist, timeoutMs = 5200L) }
                catch (_: Throwable) {}
            }.start()
        }
    }
}
