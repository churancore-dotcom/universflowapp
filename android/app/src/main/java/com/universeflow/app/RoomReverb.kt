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
    private val erGains = floatArrayOf(0.62f, 0.48f, 0.38f, 0.30f, 0.22f, 0.16f)

    private var combsL = emptyArray<Comb>()
    private var combsR = emptyArray<Comb>()
    private var allpassL = emptyArray<Allpass>()
    private var allpassR = emptyArray<Allpass>()

    private var predelayBuf = FloatArray(1)
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
        erBufL = FloatArray((sampleRate * 0.1f).toInt().coerceAtLeast(64))
        erBufR = FloatArray(erBufL.size)
        predelayCursor = 0
        erCursor = 0
        val dt = 1f / sampleRate
        val rcHp = 1f / (2f * Math.PI.toFloat() * 160f)
        hpCoeff = rcHp / (rcHp + dt)
        val rcLp = 1f / (2f * Math.PI.toFloat() * 7000f)
        lpCoeff = dt / (rcLp + dt)
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
        roomFeedback = 0.7f + roomPercent.coerceIn(0, 100) / 100f * 0.26f
        roomDamp = 0.1f + dampPercent.coerceIn(0, 100) / 100f * 0.6f
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
        java.util.Arrays.fill(erBufL, 0f)
        java.util.Arrays.fill(erBufR, 0f)
        predelayCursor = 0
        erCursor = 0
        hpStateL = 0f; hpPrevL = 0f; hpStateR = 0f; hpPrevR = 0f
        lpL = 0f; lpR = 0f
        currentWet = 0f
        currentWidth = targetWidth
    }

    private fun retune() {
        if (combsL.isEmpty()) return
        val scale = srScale * sizeScale
        for (i in combTunings.indices) {
            combsL[i].size = (combTunings[i] * scale).toInt()
            combsL[i].feedback = roomFeedback
            combsL[i].damp = roomDamp
            combsR[i].size = ((combTunings[i] + stereoSpread) * scale).toInt()
            combsR[i].feedback = roomFeedback
            combsR[i].damp = roomDamp
        }
        for (i in allpassTunings.indices) {
            allpassL[i].size = (allpassTunings[i] * scale).toInt()
            allpassR[i].size = ((allpassTunings[i] + stereoSpread) * scale).toInt()
        }
        val erMax = erBufL.size - 1
        for (i in 0 until 6) {
            erOffL[i] = (erTapsL[i] * sizeScale * sampleRate / 1000f).toInt().coerceIn(1, erMax)
            erOffR[i] = (erTapsR[i] * sizeScale * sampleRate / 1000f).toInt().coerceIn(1, erMax)
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
        // High-pass the send so the room never turns bass into boom.
        hpStateL = hpCoeff * (hpStateL + inL - hpPrevL); hpPrevL = inL
        hpStateR = hpCoeff * (hpStateR + inR - hpPrevR); hpPrevR = inR

        // Pre-delay (stereo-summed send for the late tail).
        val mono = (hpStateL + hpStateR) * 0.5f
        val delayed = predelayBuf[predelayCursor]
        predelayBuf[predelayCursor] = mono
        if (++predelayCursor >= predelayLen) predelayCursor = 0

        // Early reflections keep stereo image (each ear hears its own walls).
        erBufL[erCursor] = hpStateL
        erBufR[erCursor] = hpStateR
        val n = erBufL.size
        var erL = 0f
        var erR = 0f
        for (i in 0 until 6) {
            erL += erBufL[(erCursor - erOffL[i] + n) % n] * erGains[i]
            erR += erBufR[(erCursor - erOffR[i] + n) % n] * erGains[i]
        }
        if (++erCursor >= n) erCursor = 0

        val fed = delayed * 0.015f
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
        val tailGain = currentWet * 1.6f
        val erGain = currentWet * 0.35f
        out[0] = inL + erL * erGain + (lpL * w1 + lpR * w2) * tailGain
        out[1] = inR + erR * erGain + (lpR * w1 + lpL * w2) * tailGain
    }
}
