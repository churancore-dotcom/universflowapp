package com.universeflow.app

import android.util.Log
import java.util.concurrent.Executors
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

    /** Sentinel pushed by a racer that finished without a usable stream. */
    private val MISS = Resolved("", "miss", 0L)

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

        val results = LinkedBlockingQueue<Resolved>()
        var racers = 0

        if (canSaavn) {
            racers++
            pool.execute {
                val out = try {
                    JioSaavnClient.searchAndResolve(title!!, artist!!)?.let { saavn ->
                        Log.d(TAG, "JioSaavn hit for $title / $artist -> ${saavn.bitrateKbps}kbps")
                        Resolved(saavn.url, "jiosaavn", saavn.expiresAt)
                    }
                } catch (t: Throwable) {
                    Log.w(TAG, "JioSaavn lookup error: ${t.message}")
                    null
                }
                results.offer(out ?: MISS)
            }
        }

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
                results.offer(out ?: MISS)
            }
        }

        // First genuine success wins; misses only shorten the wait.
        val deadline = System.currentTimeMillis() + timeoutMs + 800L
        var settled = 0
        while (settled < racers) {
            val remaining = deadline - System.currentTimeMillis()
            if (remaining <= 0) break
            val next = results.poll(remaining, TimeUnit.MILLISECONDS) ?: break
            settled++
            if (next === MISS || next.url.isBlank()) continue
            // Seed the videoId cache so ExoPlayer's yt:// resolver and any queued
            // prefetch reuse this URL instead of resolving the track again.
            if (hasVideo) {
                try { NativeYouTubeResolver.putCached(videoId!!, next.url, next.source) }
                catch (_: Throwable) {}
            }
            return next
        }

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
