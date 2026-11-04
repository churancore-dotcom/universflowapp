package com.universeflow.app

import kotlin.math.max

/**
 * Natural room reverb for the ExoPlayer PCM path.
 *
 * Signal flow (per channel):
 *   input -> 160 Hz high-pass (no muddy bass boom)
 *         -> pre-delay
 *         -> early reflections (6 decorrelated wall taps: the cue that tells
 *            your ear "how big is this room")
 *         -> full Freeverb late tail (8 damped combs + 4 allpass diffusers)
 *         -> 7 kHz tail low-pass (air absorption, removes metallic ring)
 *
 * The previous 4-comb/2-allpass network with a fat wet gain sounded like a
 * metallic, washy echo laid over the track, which is why no space felt real.
 *
 * Clean-but-audible rules (rooms used to sound noisy and smear the song):
 *  - The send is band-limited (220 Hz .. 6.5 kHz) so no bass mud, hiss or
 *    sibilant spray ever enters the tail.
 *  - The tail is DUCKED by the dry signal's envelope: while the song is loud
 *    the room steps back so vocals stay clear; in gaps and phrase endings the
 *    room blooms. This is how mix engineers make reverb obvious yet clean.
 *  - Comb feedback is capped below the metallic-ringing zone.
 *  - Dry is trimmed slightly as wet rises so the sum never clips the limiter.
 */
class RoomReverb {

    private class Comb(maxSize: Int) {
        private val buffer = FloatArray(max(4, maxSize))
        private var index = 0
        private var store = 0f
        var size = buffer.size
            set(value) { field = value.coerceIn(4, buffer.size); if (index >= field) index = 0 }
        var feedback = 0.84f
        var damp = 0.2f

        fun clear() { java.util.Arrays.fill(buffer, 0f); store = 0f; index = 0 }

        fun process(input: Float): Float {
            val output = buffer[index]
            store = output * (1f - damp) + store * damp
            buffer[index] = input + store * feedback
            if (++index >= size) index = 0
            return output
        }
    }

    private class Allpass(maxSize: Int) {
        private val buffer = FloatArray(max(4, maxSize))
        private var index = 0
        var size = buffer.size
            set(value) { field = value.coerceIn(4, buffer.size); if (index >= field) index = 0 }

        fun clear() { java.util.Arrays.fill(buffer, 0f); index = 0 }

        fun process(input: Float): Float {
            val buffered = buffer[index]
            val output = -input + buffered
            buffer[index] = input + buffered * 0.5f
            if (++index >= size) index = 0
            return output
        }
    }

    // Original Freeverb tunings at 44.1 kHz.
    private val combTunings = intArrayOf(1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617)
    private val allpassTunings = intArrayOf(556, 441, 341, 225)
    private val stereoSpread = 23
    // Early reflection taps (ms at size 100%) and gains, L and R differ.
    private val erTapsL = floatArrayOf(4.3f, 9.7f, 15.1f, 21.9f, 29.3f, 37.1f)
    private val erTapsR = floatArrayOf(5.1f, 11.3f, 17.6f, 24.2f, 31.8f, 40.6f)
    private val erGains = floatArrayOf(0.70f, 0.56f, 0.46f, 0.38f, 0.30f, 0.24f)

    private var combsL = emptyArray<Comb>()
    private var combsR = emptyArray<Comb>()
    private var allpassL = emptyArray<Allpass>()
    private var allpassR = emptyArray<Allpass>()

    private var predelayBuf = FloatArray(1)
    private var predelayBufR = FloatArray(1)
    private var predelayCursor = 0
    private var predelayLen = 1
    private var erBufL = FloatArray(1)
    private var erBufR = FloatArray(1)
    private var erCursor = 0
    private val erOffL = IntArray(6)
    private val erOffR = IntArray(6)

    private var hpStateL = 0f; private var hpPrevL = 0f
    private var hpStateR = 0f; private var hpPrevR = 0f
    private var hpCoeff = 0.98f
    private var lpL = 0f; private var lpR = 0f
    private var lpCoeff = 0.6f
    // Second low-pass on the send (12 dB/oct total) keeps hiss out of the tail.
    private var sendLpL = 0f; private var sendLpR = 0f
    private var sendLpCoeff = 0.6f
    // Ducking envelope follower (fast attack, slow release).
    private var env = 0f
    private var envAttack = 0.01f
    private var envRelease = 0.0005f

    private var sampleRate = 44100
    private var srScale = 1f

    @Volatile private var targetWet = 0f
    @Volatile private var targetWidth = 1f
    @Volatile private var roomFeedback = 0.84f
    @Volatile private var roomDamp = 0.25f
    @Volatile private var sizeScale = 1f
    @Volatile private var predelayMs = 12f
    @Volatile private var dirty = true

    private var currentWet = 0f
    private var currentWidth = 1f
    private var smoothing = 0.0008f

    val isActive: Boolean
        get() = targetWet > 0.0005f || currentWet > 0.0005f

    fun configure(rate: Int) {
        sampleRate = if (rate > 0) rate else 44100
        srScale = sampleRate / 44100f
        val head = 2.4f * srScale
        combsL = Array(combTunings.size) { Comb((combTunings[it] * head).toInt() + 8) }
        combsR = Array(combTunings.size) { Comb(((combTunings[it] + stereoSpread) * head).toInt() + 8) }
        allpassL = Array(allpassTunings.size) { Allpass((allpassTunings[it] * head).toInt() + 8) }
        allpassR = Array(allpassTunings.size) { Allpass(((allpassTunings[it] + stereoSpread) * head).toInt() + 8) }
        predelayBuf = FloatArray((sampleRate * 0.25f).toInt().coerceAtLeast(64))
        predelayBufR = FloatArray(predelayBuf.size)
        erBufL = FloatArray((sampleRate * 0.1f).toInt().coerceAtLeast(64))
        erBufR = FloatArray(erBufL.size)
        predelayCursor = 0
        erCursor = 0
        val dt = 1f / sampleRate
        val rcHp = 1f / (2f * Math.PI.toFloat() * 130f)
        hpCoeff = rcHp / (rcHp + dt)
        val rcLp = 1f / (2f * Math.PI.toFloat() * 8500f)
        lpCoeff = dt / (rcLp + dt)
        val rcSend = 1f / (2f * Math.PI.toFloat() * 10000f)
        sendLpCoeff = dt / (rcSend + dt)
        // Slow-ish duck so the tail level glides instead of fluttering
        // (fast ducking modulated the tail and made it sound grainy).
        envAttack = 1f - kotlin.math.exp((-1f / (sampleRate * 0.03f)).toDouble()).toFloat()
        envRelease = 1f - kotlin.math.exp((-1f / (sampleRate * 0.35f)).toDouble()).toFloat()
        smoothing = 1f - kotlin.math.exp((-1f / (sampleRate * 0.035f)).toDouble()).toFloat()
        dirty = true
        retune()
    }

    /**
     * @param roomPercent   0..100 tail length / feedback
     * @param dampPercent   0..100 high-frequency absorption
     * @param wetPercent    0..100 reverb level
     * @param widthPercent  0..100 stereo spread of the tail
     * @param preDelayMs    0..240 initial gap
     * @param sizePercent   50..240 physical room scaling
     */
    fun setSpace(roomPercent: Int, dampPercent: Int, wetPercent: Int, widthPercent: Int, preDelayMs: Int, sizePercent: Int) {
        roomFeedback = 0.74f + roomPercent.coerceIn(0, 100) / 100f * 0.23f
        roomDamp = 0.08f + dampPercent.coerceIn(0, 100) / 100f * 0.5f
        targetWet = wetPercent.coerceIn(0, 100) / 100f
        targetWidth = widthPercent.coerceIn(0, 100) / 100f
        predelayMs = preDelayMs.coerceIn(0, 240).toFloat()
        sizeScale = sizePercent.coerceIn(50, 240) / 100f
        dirty = true
    }

    fun reset() {
        combsL.forEach { it.clear() }
        combsR.forEach { it.clear() }
        allpassL.forEach { it.clear() }
        allpassR.forEach { it.clear() }
        java.util.Arrays.fill(predelayBuf, 0f)
        java.util.Arrays.fill(predelayBufR, 0f)
        java.util.Arrays.fill(erBufL, 0f)
        java.util.Arrays.fill(erBufR, 0f)
        predelayCursor = 0
        erCursor = 0
        hpStateL = 0f; hpPrevL = 0f; hpStateR = 0f; hpPrevR = 0f
        lpL = 0f; lpR = 0f
        sendLpL = 0f; sendLpR = 0f
        env = 0f
        currentWet = 0f
        currentWidth = targetWidth
    }

    private fun retune() {
        if (combsL.isEmpty()) return
        // Big rooms get their size from a longer decay and a longer pre-delay,
        // NOT from stretching the delay lines. Stretching combs/diffusers 2x
        // spaced the repeats ~80 ms apart, which the ear hears as a fluttery
        // "cheap echo" rather than a smooth hall. Keep the network dense.
        val combScale = sizeScale.coerceIn(0.6f, 1.35f)
        val diffuserScale = sizeScale.coerceIn(0.7f, 1.1f)
        val erScale = sizeScale.coerceIn(0.6f, 1.6f)
        val scale = srScale * combScale
        for (i in combTunings.indices) {
            combsL[i].size = (combTunings[i] * scale).toInt()
            combsL[i].feedback = roomFeedback
            combsL[i].damp = roomDamp
            combsR[i].size = ((combTunings[i] + stereoSpread) * scale).toInt()
            combsR[i].feedback = roomFeedback
            combsR[i].damp = roomDamp
        }
        for (i in allpassTunings.indices) {
            allpassL[i].size = (allpassTunings[i] * srScale * diffuserScale).toInt()
            allpassR[i].size = ((allpassTunings[i] + stereoSpread) * srScale * diffuserScale).toInt()
        }
        val erMax = erBufL.size - 1
        for (i in 0 until 6) {
            erOffL[i] = (erTapsL[i] * erScale * sampleRate / 1000f).toInt().coerceIn(1, erMax)
            erOffR[i] = (erTapsR[i] * erScale * sampleRate / 1000f).toInt().coerceIn(1, erMax)
        }
        predelayLen = ((predelayMs / 1000f) * sampleRate).toInt().coerceIn(1, predelayBuf.size - 1)
        dirty = false
    }

    fun tickBlock() {
        if (dirty) retune()
    }

    /** Adds the room to a stereo sample pair. Dry signal stays at full level. */
    fun process(inL: Float, inR: Float, out: FloatArray) {
        currentWet += smoothing * (targetWet - currentWet)
        currentWidth += smoothing * (targetWidth - currentWidth)
        if (currentWet <= 0.0005f) {
            out[0] = inL
            out[1] = inR
            return
        }
        // Band-limit the send: no bass boom, no hiss/sibilance in the tail.
        // The high-pass keeps its OWN state. The old code overwrote it with the
        // low-passed send every sample, which broke the filter so the bass cut
        // never really happened and the room filled with low-end mud.
        hpStateL = hpCoeff * (hpStateL + inL - hpPrevL); hpPrevL = inL
        hpStateR = hpCoeff * (hpStateR + inR - hpPrevR); hpPrevR = inR
        if (kotlin.math.abs(hpStateL) < 1e-12f) hpStateL = 0f
        if (kotlin.math.abs(hpStateR) < 1e-12f) hpStateR = 0f
        sendLpL += sendLpCoeff * (hpStateL - sendLpL)
        sendLpR += sendLpCoeff * (hpStateR - sendLpR)
        val sendL = sendLpL
        val sendR = sendLpR

        // Dry envelope for ducking. Samples arrive in 16-bit scale
        // (+-32768), so normalise to 0..1 first. The old code compared the
        // raw sample value against 1.0, which pinned the duck permanently on:
        // the room never bloomed in gaps and just sat as a flat wash.
        val level = max(kotlin.math.abs(inL), kotlin.math.abs(inR)) * INV_FULL_SCALE
        env += (if (level > env) envAttack else envRelease) * (level - env)

        // Stereo pre-delay: the gap before the room answers is the main cue
        // for room size, so walls and tail both start after it.
        val delayedL = predelayBuf[predelayCursor]
        val delayedR = predelayBufR[predelayCursor]
        predelayBuf[predelayCursor] = sendL
        predelayBufR[predelayCursor] = sendR
        if (++predelayCursor >= predelayLen) predelayCursor = 0
        val delayed = (delayedL + delayedR) * 0.5f

        // Early reflections keep stereo image (each ear hears its own walls),
        // with a little of the opposite wall bleeding in like a real room.
        // They follow the pre-delay too: in a real hall the first wall bounce
        // arrives after the gap, it doesn't double the voice instantly.
        erBufL[erCursor] = delayedL
        erBufR[erCursor] = delayedR
        val n = erBufL.size
        var erL = 0f
        var erR = 0f
        for (i in 0 until 6) {
            val gl = erBufL[(erCursor - erOffL[i] + n) % n]
            val gr = erBufR[(erCursor - erOffR[i] + n) % n]
            erL += (gl * 0.8f + gr * 0.2f) * erGains[i]
            erR += (gr * 0.8f + gl * 0.2f) * erGains[i]
        }
        if (++erCursor >= n) erCursor = 0

        // Walls feed the tail (as in a real room the late sound is built from
        // the reflections), which makes the decay dense and smooth instead of
        // a separate echo laid behind the song.
        val fed = (delayed + (erL + erR) * 0.12f) * 0.015f
        var wetL = 0f
        var wetR = 0f
        for (i in combsL.indices) {
            wetL += combsL[i].process(fed)
            wetR += combsR[i].process(fed)
        }
        for (i in allpassL.indices) {
            wetL = allpassL[i].process(wetL)
            wetR = allpassR[i].process(wetR)
        }
        lpL += lpCoeff * (wetL - lpL)
        lpR += lpCoeff * (wetR - lpR)

        val w1 = currentWidth * 0.5f + 0.5f
        val w2 = (1f - currentWidth) * 0.5f
        // Smooth duck: up to -6 dB while the song is loud (around -10 dBFS
        // and above), full room in breaks and phrase endings. That is what
        // makes the space clearly audible without fogging the vocal.
        val x = (env * 3f).coerceIn(0f, 1f)
        val duck = 1f - 0.3f * (x * x * (3f - 2f * x))
        val tailGain = currentWet * 4.2f * duck
        val erGain = currentWet * 1.3f * (0.7f + 0.3f * duck)
        // Trim the dry a touch as the room grows so dry + room keeps the same
        // loudness and never pushes the limiter (no pumping, no distortion).
        val dryTrim = 1f - currentWet * 0.4f
        out[0] = inL * dryTrim + erL * erGain + (lpL * w1 + lpR * w2) * tailGain
        out[1] = inR * dryTrim + erR * erGain + (lpR * w1 + lpL * w2) * tailGain
    }

    private companion object {
        const val INV_FULL_SCALE = 1f / 32768f
    }
}
