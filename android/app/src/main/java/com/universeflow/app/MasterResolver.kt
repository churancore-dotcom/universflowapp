package com.universeflow.app

import android.util.Log
import java.util.concurrent.Executors
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit

/**
 * On-device stream resolver — DEEP MODE.
 *
 * Two independent sources race for every track:
 *  1. JioSaavn (title + artist) — direct CDN URL, no cipher. Its confidence
 *     check (see [JioSaavnClient.searchAndResolve]) rejects covers, live takes
 *     and remixes.
 *  2. On-device YouTube via [NativeYouTubeResolver] — multi-client InnerTube
 *     race with on-device cipher/n-param solving and BotGuard PoTokens. When a
 *     track has no videoId, [YouTubeSearch] finds one from title + artist first.
 *
 * YouTube gets a short head start (it usually has the wider catalogue), but
 * JioSaavn wins the moment YouTube's patience window elapses, so a YouTube
 * outage or block never stalls playback.
 */
object MasterResolver {

    private const val TAG = "MasterResolver"

    data class Resolved(val url: String, val source: String, val expiresAt: Long)

    /** Shared pool: racing spawns two short-lived tasks per resolve. */
    private val pool = Executors.newCachedThreadPool { r ->
        Thread(r, "uf-resolve").apply { isDaemon = true }
    }

    /**
     * Coalesce every request for the same track. Before this guard, a tap could
     * start one race from playQueue(), another from ResolvingDataSource, and
     * more from rail/queue prefetch. Those duplicate InnerTube + JioSaavn calls
     * competed for the same sockets and made the foreground play slower.
     */
    private val inFlight = java.util.concurrent.ConcurrentHashMap<String, CompletableFuture<Resolved?>>()

    /** Recent resolution outcomes — proof of which source really served audio. */
    data class LogEntry(
        val videoId: String?,
        val label: String,
        val winner: String,
        val latencyMs: Long,
        val ytFailure: String?,
        val at: Long,
    )

    private val log = java.util.concurrent.ConcurrentLinkedDeque<LogEntry>()

    fun recentLog(limit: Int = 25): List<LogEntry> = log.take(limit)

    private fun record(
        videoId: String?, label: String, winner: String, latencyMs: Long, ytFailure: String?,
    ) {
        log.addFirst(LogEntry(videoId, label, winner, latencyMs, ytFailure, System.currentTimeMillis()))
        while (log.size > 50) log.pollLast()
        Log.i(TAG, "resolved '$label' via $winner in ${latencyMs}ms" +
            (ytFailure?.let { " (yt failure: $it)" } ?: ""))
    }

    fun resolve(
        videoId: String?,
        title: String?,
        artist: String?,
        timeoutMs: Long = 5200L,
    ): Resolved? {
        val canSaavn = !title.isNullOrBlank() && !artist.isNullOrBlank()
        if (!canSaavn) return null

        val key = videoId?.takeIf { it.length == 11 }
            ?: "${title.orEmpty().trim().lowercase()}|${artist.orEmpty().trim().lowercase()}"
        val mine = CompletableFuture<Resolved?>()
        val existing = inFlight.putIfAbsent(key, mine)
        if (existing != null) {
            return try {
                existing.get(timeoutMs + 1000L, TimeUnit.MILLISECONDS)
            } catch (_: Throwable) {
                null
            }
        }

        return try {
            val result = resolveFresh(videoId, title, artist)
            mine.complete(result)
            result
        } catch (t: Throwable) {
            mine.completeExceptionally(t)
            throw t
        } finally {
            inFlight.remove(key, mine)
        }
    }

    private fun resolveFresh(
        videoId: String?,
        title: String?,
        artist: String?,
    ): Resolved? {
        val label = listOfNotNull(title, artist).joinToString(" — ").ifBlank { videoId ?: "?" }
        val startedAt = System.currentTimeMillis()
        val resolved = try {
            JioSaavnClient.searchAndResolve(title!!, artist!!)?.let { saavn ->
                Log.d(TAG, "JioSaavn hit for $title / $artist -> ${saavn.bitrateKbps}kbps")
                Resolved(saavn.url, "jiosaavn", saavn.expiresAt)
            }
        } catch (t: Throwable) {
            Log.w(TAG, "JioSaavn lookup error: ${t.message}")
            null
        }
        record(videoId, label, resolved?.source ?: "miss", System.currentTimeMillis() - startedAt, null)
        return resolved
    }

    /**
     * Pre-resolve up to [limit] tracks in parallel on the shared pool.
     * Used by ExoPlayerPlugin.preloadQueue / playQueue warm-up.
     */
    fun prefetch(tracks: List<Triple<String?, String?, String?>>, limit: Int = 5) {
        val selected = tracks.take(limit)
        selected.forEach { (vid, title, artist) ->
            pool.execute {
                try { resolve(vid, title, artist, timeoutMs = 5200L) }
                catch (_: Throwable) {}
            }
        }
    }
}
