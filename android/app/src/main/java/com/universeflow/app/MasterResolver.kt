package com.universeflow.app

import android.util.Log
import java.util.concurrent.Executors
import java.util.concurrent.CompletableFuture
import java.util.concurrent.atomic.AtomicReference

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
 * Both sources share a single bounded deadline. The first successful stream
 * wins, so a failure or block in either source cannot extend playback startup.
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
        val canYouTube = videoId?.length == 11 || !title.isNullOrBlank()
        if (!canSaavn && !canYouTube) return null

        val key = videoId?.takeIf { it.length == 11 }
            ?: "${title.orEmpty().trim().lowercase()}|${artist.orEmpty().trim().lowercase()}"
        val mine = CompletableFuture<Resolved?>()
        val existing = inFlight.putIfAbsent(key, mine)
        if (existing != null) {
            return try {
                existing.get(timeoutMs + 1000L, java.util.concurrent.TimeUnit.MILLISECONDS)
            } catch (_: Throwable) {
                null
            }
        }

        return try {
            val result = resolveFresh(videoId, title, artist, timeoutMs)
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
    ): Resolved? {
        val label = listOfNotNull(title, artist).joinToString(" — ").ifBlank { videoId ?: "?" }
        val startedAt = System.currentTimeMillis()
        val ytFailure = AtomicReference<String?>(null)

        // ── YouTube (deep): already-cached stream first, then a full resolve.
        val direct = videoId?.takeIf { it.length == 11 }
        val cachedYt = direct?.let { runCatching { NativeYouTubeResolver.peek(it) }.getOrNull() }
        if (cachedYt != null) {
            record(direct, label, "youtube:${cachedYt.client}", System.currentTimeMillis() - startedAt, null)
            return Resolved(cachedYt.url, "youtube", 0L)
        }
        direct?.let { NewPipeResolver.peek(it) }?.let { np ->
            record(direct, label, "youtube:newpipe", System.currentTimeMillis() - startedAt, null)
            return Resolved(np.url, "youtube", np.expiresAt)
        }

        val ytDeadline = startedAt + timeoutMs.coerceIn(1_000L, 6_500L)
        val ytFuture: CompletableFuture<Resolved?>? = if (direct != null || !title.isNullOrBlank()) {
            CompletableFuture.supplyAsync({
                try {
                    // Candidate list, not a single guess: when the best match is
                    // age-gated, region-blocked or SABR-only, the next accepted
                    // match still gets a turn inside the same deadline instead
                    // of the whole YouTube path counting as a miss.
                    val ids = when {
                        direct != null -> listOf(direct)
                        else -> YouTubeSearch.searchVideoIds(title.orEmpty(), artist.orEmpty(), limit = 3)
                    }
                    if (ids.isEmpty()) {
                        ytFailure.set("NO_VIDEO_ID_MATCH")
                        return@supplyAsync null
                    }
                    for (id in ids) {
                        val budget = ytDeadline - System.currentTimeMillis()
                        if (budget < 700L) break
                        // NewPipe Extractor and our own resolver race; first playable wins.
                        val np = CompletableFuture.supplyAsync({ NewPipeResolver.resolve(id) }, pool)
                        val own = CompletableFuture.supplyAsync({
                            NativeYouTubeResolver.resolve(id, timeoutMs = budget.coerceAtMost(4200L))
                        }, pool)
                        val stop = System.currentTimeMillis() + budget.coerceAtMost(4500L)
                        while (System.currentTimeMillis() < stop && !(np.isDone && own.isDone)) {
                            np.takeIf { it.isDone }?.getNow(null)?.let { h ->
                                own.cancel(true)
                                return@supplyAsync Resolved(h.url, "youtube:newpipe", h.expiresAt)
                            }
                            own.takeIf { it.isDone }?.getNow(null)?.let { h ->
                                np.cancel(true)
                                return@supplyAsync Resolved(h.url, "youtube:${h.client}", 0L)
                            }
                            Thread.sleep(20L)
                        }
                        np.getNow(null)?.let { return@supplyAsync Resolved(it.url, "youtube:newpipe", it.expiresAt) }
                        own.getNow(null)?.let { return@supplyAsync Resolved(it.url, "youtube:${it.client}", 0L) }
                        np.cancel(true); own.cancel(true)
                        ytFailure.set(listOfNotNull(
                            NewPipeResolver.lastFailure(),
                            runCatching { NativeYouTubeResolver.lastFailure(id) }.getOrNull(),
                        ).joinToString(" | ").ifBlank { "NO_PLAYABLE_STREAM" })
                    }
                    null
                } catch (t: Throwable) {
                    ytFailure.set(t.message ?: "YT_ERROR")
                    null
                }
            }, pool)
        } else null

        // ── JioSaavn: runs in parallel so a YouTube block never stalls a tap.
        val saavnFuture: CompletableFuture<Resolved?>? =
            if (!title.isNullOrBlank() && !artist.isNullOrBlank()) {
                CompletableFuture.supplyAsync({
                    try {
                        JioSaavnClient.searchAndResolve(title, artist)?.let { saavn ->
                            Log.d(TAG, "JioSaavn hit for $title / $artist -> ${saavn.bitrateKbps}kbps")
                            Resolved(saavn.url, "jiosaavn", saavn.expiresAt)
                        }
                    } catch (t: Throwable) {
                        Log.w(TAG, "JioSaavn lookup error: ${t.message}")
                        null
                    }
                }, pool)
            } else null

        fun peekDone(f: CompletableFuture<Resolved?>?): Resolved? =
            if (f != null && f.isDone) runCatching { f.getNow(null) }.getOrNull() else null

        // Enforce one real deadline. The former sequential waits could exceed
        // ExoPlayer's seven-second source deadline and turn a successful late
        // resolution into silence. Poll both independent sources and accept the
        // first success without allowing one fast null to cancel the other.
        var winner: Resolved? = null
        val deadline = startedAt + timeoutMs.coerceIn(1_000L, 6_500L)
        while (winner == null && System.currentTimeMillis() < deadline) {
            winner = peekDone(ytFuture) ?: peekDone(saavnFuture)
            if (winner == null) {
                try { Thread.sleep(20L) } catch (_: InterruptedException) {
                    Thread.currentThread().interrupt()
                    break
                }
            }
        }
        if (winner == null) {
            ytFuture?.cancel(true)
            saavnFuture?.cancel(true)
        }

        record(
            videoId, label, winner?.source ?: "miss",
            System.currentTimeMillis() - startedAt, ytFailure.get(),
        )
        return winner?.let { Resolved(it.url, if (it.source.startsWith("youtube")) "youtube" else it.source, it.expiresAt) }
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
