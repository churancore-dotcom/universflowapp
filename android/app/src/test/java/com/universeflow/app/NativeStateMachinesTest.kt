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

    @Test fun eqLeavesOnlyThreeDbForTheLimiter() {
        assertEquals(1f, EqHeadroom.preGain(2.0), 0.0001f)
        // +12 dB peak -> pulled down 9 dB
        assertEquals(Math.pow(10.0, -9.0 / 20).toFloat(), EqHeadroom.preGain(12.0), 0.0001f)
    }
}
