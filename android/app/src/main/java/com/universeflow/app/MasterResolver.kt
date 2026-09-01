package com.universeflow.app

import android.util.Log
import java.util.concurrent.Executors
import java.util.concurrent.CompletableFuture
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

/**
 * On-device stream resolver — a single parallel race, not a chain of stages.
 *
 * Both source families start at the same instant and the first genuine match
 * wins:
 *
 *  • JioSaavn (title + artist search) — direct CDN URL, no cipher. Its own
 *    confidence check (see [JioSaavnClient.searchAndResolve]) rejects covers,
 *    live takes and remixes, so a "fast" answer can never be the wrong track.
 *  • YouTube InnerTube via [NativeYouTubeResolver] — itself racing 6 clients.
 *
 * If both come back empty we fall back to the stale cache (within the 30 min
 * grace window) before declaring failure.
 *
 * Why parallel: JioSaavn used to run as a blocking pre-stage, so every track
 * that is not in its catalogue paid the full JioSaavn timeout (~5s) *before*
 * YouTube resolution even started. Racing removes that dead time entirely —
 * the slowest source no longer sets the floor for playback start.
 *
 * Resolved URLs are seeded into [NativeYouTubeResolver]'s cache keyed by the
 * YouTube videoId so that ExoPlayer's `yt://<videoId>` ResolvingDataSource
 * picks them up transparently.
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

    /** Sentinel pushed by a racer that finished without a usable stream. */
    private val MISS = Resolved("", "miss", 0L)

    /**
     * How long JioSaavn is held back so the on-device YouTube path (residential
     * IP, so it actually succeeds on APK unlike the server) gets first shot.
     */
    private const val YT_HEAD_START_MS = 300L

    /**
     * Hard cap on how long a *ready* JioSaavn URL is parked waiting for YouTube.
     * Past this point playback start matters more than the source, so we ship
     * the fallback immediately instead of sitting on the full YouTube timeout.
     */
    private const val YT_PATIENCE_MS = 1500L

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
        val hasVideo = !videoId.isNullOrBlank() && videoId.length == 11

        // Cache check first — covers both YT and seeded JioSaavn entries.
        if (hasVideo) {
            NativeYouTubeResolver.peek(videoId!!)?.let { hit ->
                return Resolved(hit.url, hit.client, StreamUrlPolicy.expiresAt(hit.url))
            }
        }

        val canSaavn = !title.isNullOrBlank() && !artist.isNullOrBlank()
        if (!canSaavn && !hasVideo) return null

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
            val result = resolveFresh(videoId, title, artist, timeoutMs, hasVideo, canSaavn)
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
        timeoutMs: Long,
        hasVideo: Boolean,
        canSaavn: Boolean,
    ): Resolved? {

        val label = listOfNotNull(title, artist).joinToString(" — ").ifBlank { videoId ?: "?" }
        val startedAt = System.currentTimeMillis()

        // Tagged results so we can tell the two families apart while draining.
        val results = LinkedBlockingQueue<Pair<String, Resolved>>()
        var racers = 0

        if (hasVideo) {
            racers++
            pool.execute {
                val out = try {
                    NativeYouTubeResolver.resolve(videoId!!, timeoutMs = timeoutMs)?.let { yt ->
                        Resolved(yt.url, "youtube:${yt.client}", StreamUrlPolicy.expiresAt(yt.url))
                    }
                } catch (t: Throwable) {
                    Log.w(TAG, "InnerTube error: ${t.message}")
                    null
                }
                results.offer("yt" to (out ?: MISS))
            }
        }

        if (canSaavn) {
            racers++
            pool.execute {
                // Head start: only delay when YouTube is actually in the race.
                if (hasVideo) {
                    try { Thread.sleep(YT_HEAD_START_MS) } catch (_: InterruptedException) {}
                    // YouTube may have already landed and cached during the wait.
                    if (NativeYouTubeResolver.peek(videoId!!) != null) {
                        results.offer("saavn" to MISS)
                        return@execute
                    }
                }
                val out = try {
                    JioSaavnClient.searchAndResolve(title!!, artist!!)?.let { saavn ->
                        Log.d(TAG, "JioSaavn hit for $title / $artist -> ${saavn.bitrateKbps}kbps")
                        Resolved(saavn.url, "jiosaavn", saavn.expiresAt)
                    }
                } catch (t: Throwable) {
                    Log.w(TAG, "JioSaavn lookup error: ${t.message}")
                    null
                }
                results.offer("saavn" to (out ?: MISS))
            }
        }

        fun win(r: Resolved, ytFailure: String?): Resolved {
            if (hasVideo) {
                try { NativeYouTubeResolver.putCached(videoId!!, r.url, r.source) }
                catch (_: Throwable) {}
            }
            record(videoId, label, r.source, System.currentTimeMillis() - startedAt, ytFailure)
            return r
        }

        // YouTube wins outright. A JioSaavn success is parked until YouTube has
        // genuinely settled (hard failure) or the deadline passes — so we never
        // downgrade the source just because JioSaavn answered faster.
        val deadline = startedAt + timeoutMs + 800L
        var settled = 0
        var parkedSaavn: Resolved? = null
        var ytFailure: String? = null

        while (settled < racers) {
            // A ready fallback only waits YT_PATIENCE_MS for YouTube to settle.
            val limit = if (parkedSaavn != null) minOf(deadline, startedAt + YT_PATIENCE_MS) else deadline
            val remaining = limit - System.currentTimeMillis()
            if (remaining <= 0) break
            val next = results.poll(remaining, TimeUnit.MILLISECONDS) ?: break
            settled++
            val (who, res) = next
            val ok = res !== MISS && res.url.isNotBlank()

            if (who == "yt") {
                if (ok) return win(res, null)
                ytFailure = try { NativeYouTubeResolver.lastFailure(videoId!!) } catch (_: Throwable) { "UNKNOWN" }
                // YouTube hard-failed: take JioSaavn now if it is already in hand.
                parkedSaavn?.let { return win(it, ytFailure) }
            } else if (ok) {
                parkedSaavn = res
            }
        }

        // Deadline reached (or YouTube never answered) — use the parked fallback.
        parkedSaavn?.let { return win(it, ytFailure ?: "TIMEOUT") }


        // Last-resort: stale cache within grace window.
        if (hasVideo) {
            NativeYouTubeResolver.getStale(videoId!!)?.let { stale ->
                Log.w(TAG, "using stale cache for $videoId")
                return Resolved(stale.url, "stale:${stale.client}", System.currentTimeMillis() + 60_000L)
            }
        }
        return null
    }

    /**
     * Pre-resolve up to [limit] tracks in parallel on the shared pool.
     * Used by ExoPlayerPlugin.preloadQueue / playQueue warm-up.
     */
    fun prefetch(tracks: List<Triple<String?, String?, String?>>, limit: Int = 5) {
        tracks.take(limit).forEach { (vid, title, artist) ->
            pool.execute {
                try { resolve(vid, title, artist, timeoutMs = 5200L) }
                catch (_: Throwable) {}
            }
        }
    }
}
