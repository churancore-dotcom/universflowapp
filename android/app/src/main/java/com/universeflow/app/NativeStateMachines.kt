package com.universeflow.app

/**
 * Pure, framework-free state machines for native playback. Kept free of
 * Android types so they run as plain JVM unit tests.
 */

/** What the JS layer is told about the player. "starting" = play requested, no audio yet. */
object PlaybackPhase {
    // Mirrors androidx.media3.common.Player.STATE_* without depending on it.
    const val IDLE = 1; const val BUFFERING = 2; const val READY = 3; const val ENDED = 4

    fun classify(state: Int, isPlaying: Boolean, playWhenReady: Boolean, startingUp: Boolean): String = when {
        state == ENDED -> "ended"
        state == IDLE -> if (startingUp && playWhenReady) "starting" else "stopped"
        isPlaying -> "playing"
        playWhenReady && (state == BUFFERING || state == READY) -> if (startingUp) "starting" else "buffering"
        else -> "paused"
    }

    /** Transient swap states must not reach JS while a requested start is pending. */
    fun suppressDuringStartup(name: String, startingUp: Boolean): Boolean =
        startingUp && (name == "stopped" || name == "paused" || name == "ended")
}

/** Explicit phases of the Android crossfade/overlap before the swap. */
enum class OverlapPhase { IDLE, PREPARING, PRIMING, FADING }

enum class OverlapAction { WAIT, PRIME, REALIGN, BEGIN_FADE, ABORT }

object OverlapTimeline {
    /**
     * Decide the next step while the outgoing copy is prepared but not fading.
     * [leftMs] is remaining *wall-clock* time of the outgoing song (already
     * divided by playback speed), so fades start on time at 1.5x/2x.
     */
    fun next(
        phase: OverlapPhase,
        tailReady: Boolean,
        tailPlaying: Boolean,
        driftMs: Long,
        leftMs: Long,
        windowMs: Long,
        primeLeadMs: Long,
        toleranceMs: Long,
        abortBelowMs: Long = 350L,
    ): OverlapAction {
        if (phase == OverlapPhase.IDLE || phase == OverlapPhase.FADING) return OverlapAction.WAIT
        if (windowMs <= 0) return OverlapAction.ABORT
        if (!tailReady) return if (leftMs < abortBelowMs) OverlapAction.ABORT else OverlapAction.WAIT
        if (leftMs > windowMs + primeLeadMs) return OverlapAction.WAIT
        if (phase == OverlapPhase.PREPARING) return OverlapAction.PRIME
        val synced = tailPlaying && kotlin.math.abs(driftMs) <= toleranceMs
        if (leftMs > windowMs) return if (tailPlaying && !synced) OverlapAction.REALIGN else OverlapAction.WAIT
        return when {
            synced -> OverlapAction.BEGIN_FADE
            leftMs < abortBelowMs -> OverlapAction.ABORT
            else -> OverlapAction.WAIT
        }
    }

    /** Remaining media time converted to wall-clock time at the given speed. */
    fun wallClockLeft(durationMs: Long, positionMs: Long, speed: Float): Long {
        val s = if (speed.isFinite() && speed > 0f) speed else 1f
        return ((durationMs - positionMs) / s).toLong()
    }
}

/** Per-caller deadlines when several callers share one in-flight lookup. */
object ResolverDeadline {
    const val MIN_RETRY_MS = 1_000L

    /** How long a joining caller may wait: its own budget, never the owner's. */
    fun waitBudget(callerStart: Long, now: Long, callerTimeoutMs: Long): Long =
        (callerStart + callerTimeoutMs - now).coerceAtLeast(0L)

    /** Shared lookup gave nothing: retry alone only if enough of *this* caller's budget remains. */
    fun retryBudget(callerStart: Long, now: Long, callerTimeoutMs: Long): Long? {
        val left = waitBudget(callerStart, now, callerTimeoutMs)
        return if (left >= MIN_RETRY_MS) left else null
    }
}

/**
 * Two full-scale, separately limited players summed by the Android mixer clip
 * at a constant-power midpoint (0.707 + 0.707 = 1.41 => +3 dB over). Scale the
 * pair so the summed gain never exceeds unity; the curve shape is kept.
 */
object OverlapMix {
    fun safe(gains: Pair<Float, Float>): Pair<Float, Float> {
        val sum = gains.first + gains.second
        if (sum <= 1f) return gains
        return Pair(gains.first / sum, gains.second / sum)
    }
}

/** Briefly restarting audio is not proof that a failing stream recovered. */
class PlaybackRetryBudget(private val maxRetries: Int = 2, private val stableMs: Long = 30_000L) {
    private var attempts = 0
    private var playingSince: Long? = null

    fun reset() { attempts = 0; playingSince = null }

    fun onPlayingChanged(playing: Boolean, now: Long) {
        if (playing) {
            if (playingSince == null) playingSince = now
        } else {
            replenishIfStable(now)
            playingSince = null
        }
    }

    private fun replenishIfStable(now: Long) {
        val since = playingSince ?: return
        if (now - since >= stableMs) attempts = 0
    }

    /** Returns backoff, or null when this item has exhausted recovery. */
    fun nextDelay(now: Long): Long? {
        replenishIfStable(now)
        playingSince = null
        if (attempts >= maxRetries) return null
        attempts++
        return 1_000L * attempts
    }
}
