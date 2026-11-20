package com.universeflow.app

import org.junit.Assert.*
import org.junit.Test

class NativeStateMachinesTest {
    private val P = PlaybackPhase

    @Test fun startingIsNotPlaying() {
        assertEquals("starting", P.classify(P.BUFFERING, false, true, startingUp = true))
        assertEquals("starting", P.classify(P.READY, false, true, startingUp = true))
        assertEquals("starting", P.classify(P.IDLE, false, true, startingUp = true))
        assertEquals("playing", P.classify(P.READY, true, true, startingUp = true))
    }

    @Test fun midSongStallIsBufferingNotStarting() {
        assertEquals("buffering", P.classify(P.BUFFERING, false, true, startingUp = false))
        assertEquals("paused", P.classify(P.READY, false, false, startingUp = false))
        assertEquals("stopped", P.classify(P.IDLE, false, false, startingUp = false))
    }

    @Test fun swapNoiseSuppressedOnlyWhileStarting() {
        assertTrue(P.suppressDuringStartup("paused", true))
        assertFalse(P.suppressDuringStartup("paused", false))
        assertFalse(P.suppressDuringStartup("starting", true))
    }

    private fun next(phase: OverlapPhase, ready: Boolean = true, playing: Boolean = true, drift: Long = 0, left: Long) =
        OverlapTimeline.next(phase, ready, playing, drift, left, windowMs = 6000, primeLeadMs = 2500, toleranceMs = 60)

    @Test fun overlapPhasesInOrder() {
        assertEquals(OverlapAction.WAIT, next(OverlapPhase.PREPARING, left = 9000))
        assertEquals(OverlapAction.PRIME, next(OverlapPhase.PREPARING, left = 8000))
        assertEquals(OverlapAction.WAIT, next(OverlapPhase.PRIMING, left = 7000))
        assertEquals(OverlapAction.REALIGN, next(OverlapPhase.PRIMING, drift = 300, left = 7000))
        assertEquals(OverlapAction.BEGIN_FADE, next(OverlapPhase.PRIMING, left = 6000))
        assertEquals(OverlapAction.WAIT, next(OverlapPhase.FADING, left = 3000))
    }

    @Test fun lateOrUnsyncedCopyFallsBackToGapless() {
        assertEquals(OverlapAction.WAIT, next(OverlapPhase.PRIMING, drift = 300, left = 2000))
        assertEquals(OverlapAction.ABORT, next(OverlapPhase.PRIMING, drift = 300, left = 200))
        assertEquals(OverlapAction.ABORT, next(OverlapPhase.PREPARING, ready = false, left = 200))
        assertEquals(OverlapAction.ABORT, OverlapTimeline.next(OverlapPhase.PRIMING, true, true, 0, 5000, 0, 2500, 60))
    }

    @Test fun fadeTimingFollowsPlaybackSpeed() {
        assertEquals(6000L, OverlapTimeline.wallClockLeft(200_000, 188_000, 2f))
        assertEquals(12000L, OverlapTimeline.wallClockLeft(200_000, 188_000, 0f))
    }

    @Test fun joiningCallerKeepsItsOwnDeadline() {
        assertEquals(1500L, ResolverDeadline.waitBudget(0, 1000, 2500))
        assertEquals(0L, ResolverDeadline.waitBudget(0, 9000, 2500))
        assertEquals(4000L, ResolverDeadline.retryBudget(0, 1000, 5000))
        assertNull(ResolverDeadline.retryBudget(0, 4500, 5000))
    }

    @Test fun crossfadeSumNeverClips() {
        for (i in 0..20) {
            val g = OverlapMix.safe(TransitionEnvelope.gains("equal-power", i / 20.0))
            assertTrue(g.first + g.second <= 1.0001f)
        }
        val end = OverlapMix.safe(TransitionEnvelope.gains("equal-power", 1.0))
        assertEquals(1f, end.second, 0.001f)
    }

    @Test fun eqLeavesAtMostSixDbForTheLimiter() {
        assertEquals(1f, EqHeadroom.preGain(2.0), 0.0001f)
        // +12 dB peak -> pulled down 6 dB
        assertEquals(Math.pow(10.0, -6.0 / 20).toFloat(), EqHeadroom.preGain(12.0), 0.0001f)
    }

    @Test fun briefPlaybackCannotRearmEndlessNetworkRetries() {
        val budget = PlaybackRetryBudget()
        assertEquals(1000L, budget.nextDelay(0))
        budget.onPlayingChanged(true, 1000)
        budget.onPlayingChanged(false, 1500)
        assertEquals(2000L, budget.nextDelay(1500))
        budget.onPlayingChanged(true, 3500)
        budget.onPlayingChanged(false, 4000)
        assertNull(budget.nextDelay(4000))
        assertNull(budget.nextDelay(10_000))
    }

    @Test fun onlyStablePlaybackOrANewItemReplenishesRecovery() {
        val budget = PlaybackRetryBudget()
        assertEquals(1000L, budget.nextDelay(0))
        budget.onPlayingChanged(true, 1000)
        budget.onPlayingChanged(false, 31_000)
        assertEquals(1000L, budget.nextDelay(31_000))
        assertEquals(2000L, budget.nextDelay(32_000))
        assertNull(budget.nextDelay(33_000))
        budget.reset()
        assertEquals(1000L, budget.nextDelay(34_000))
    }

    @Test fun RepeatedPlayingCallbacksDoNotMoveStablePlaybackStart() {
        val budget = PlaybackRetryBudget()
        budget.nextDelay(0)
        budget.nextDelay(1)
        budget.onPlayingChanged(true, 1000)
        budget.onPlayingChanged(true, 20_000)
        assertEquals(1000L, budget.nextDelay(31_000))
    }

    @Test fun streamedSongIsHeldWhollyAhead() {
        // A typical 5-minute song must be loaded in full, not ~20 s at a time.
        assertTrue(StreamBuffer.MIN_MS >= 180_000)
        assertTrue(StreamBuffer.START_MS <= StreamBuffer.REBUFFER_MS)
        assertTrue(StreamBuffer.REBUFFER_MS <= StreamBuffer.MIN_MS)
        assertTrue(StreamBuffer.MIN_MS <= StreamBuffer.MAX_MS)
        // Even 320 kbps JioSaavn audio fits a 10-minute window in the byte target.
        assertTrue(StreamBuffer.secondsHeld(320) >= StreamBuffer.MAX_MS / 1000)
    }

    @Test fun hiddenAppGetsRareProgressTicks() {
        assertEquals(500L, StreamBuffer.progressIntervalMs(false))
        assertEquals(5_000L, StreamBuffer.progressIntervalMs(true))
    }

    @Test fun healthReportsAreRateLimited() {
        val limiter = HealthReportLimiter(minGapMs = 15_000, maxPerSession = 3)
        assertTrue(limiter.allow("rebuffer", 0))
        assertFalse(limiter.allow("rebuffer", 10_000))
        assertTrue(limiter.allow("underrun", 10_000))
        assertTrue(limiter.allow("rebuffer", 16_000))
        assertFalse(limiter.allow("load_error", 40_000))
    }
}
