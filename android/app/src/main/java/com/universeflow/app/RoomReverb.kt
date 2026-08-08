package com.universeflow.app

import kotlin.math.max

/**
 * Schroeder/Freeverb-style room reverb for the ExoPlayer PCM path.
 *
 * The previous native "reverb" was a single 89 ms cross-fed delay, so every
 * Studio Space (Hall, Cathedral, Stadium, Bedroom...) collapsed into the same
 * washy echo that mostly just ducked the dry signal — spaces sounded weak and
 * indistinguishable. This is a real reverb: pre-delay, 8 damped comb filters
 * (4 per channel, stereo-spread) feeding 4 series allpass diffusers, with
 * per-space room size, damping, width and wet level.
 */
class RoomReverb {

    private class Comb(maxSize: Int) {
        private val buffer = FloatArray(max(4, maxSize))
        private var index = 0
        private var store = 0f
        var size = buffer.size
            set(value) { field = value.coerceIn(4, buffer.size) }
        var feedback = 0.84f
        var damp = 0.2f

        fun clear() {
            java.util.Arrays.fill(buffer, 0f)
            store = 0f
            index = 0
        }

        fun process(input: Float): Float {
            if (index >= size) index = 0
            val output = buffer[index]
            store = output * (1f - damp) + store * damp
            buffer[index] = input + store * feedback
            index++
            return output
        }
    }

    private class Allpass(maxSize: Int) {
        private val buffer = FloatArray(max(4, maxSize))
        private var index = 0
        var size = buffer.size
            set(value) { field = value.coerceIn(4, buffer.size) }

        fun clear() {
            java.util.Arrays.fill(buffer, 0f)
            index = 0
        }

        fun process(input: Float): Float {
            if (index >= size) index = 0
            val buffered = buffer[index]
            val output = -input + buffered
            buffer[index] = input + buffered * 0.5f
            index++
            return output
        }
    }

    // Freeverb tunings at 44.1 kHz; scaled to the real sample rate and room size.
    private val combTunings = intArrayOf(1116, 1188, 1277, 1356)
    private val allpassTunings = intArrayOf(556, 441)
    private val stereoSpread = 23

    private var combsL = emptyArray<Comb>()
    private var combsR = emptyArray<Comb>()
    private var allpassL = emptyArray<Allpass>()
    private var allpassR = emptyArray<Allpass>()

    private var predelayBuf = FloatArray(1)
    private var predelayCursor = 0
    private var predelayLen = 1

    private var sampleRate = 44100
    private var srScale = 1f

    // Target params (written from the UI thread, read per-sample).
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
        // Allow up to 2.4x room scaling (cathedral / stadium) without realloc.
        val head = 2.4f * srScale
        combsL = Array(combTunings.size) { Comb((combTunings[it] * head).toInt() + 8) }
        combsR = Array(combTunings.size) { Comb(((combTunings[it] + stereoSpread) * head).toInt() + 8) }
        allpassL = Array(allpassTunings.size) { Allpass((allpassTunings[it] * head).toInt() + 8) }
        allpassR = Array(allpassTunings.size) { Allpass(((allpassTunings[it] + stereoSpread) * head).toInt() + 8) }
        predelayBuf = FloatArray((sampleRate * 0.25f).toInt().coerceAtLeast(64))
        predelayCursor = 0
        // ~35 ms wet/width glide: space switches crossfade instead of clicking.
        smoothing = 1f - kotlin.math.exp((-1f / (sampleRate * 0.035f)).toDouble()).toFloat()
        dirty = true
        retune()
    }

    /**
     * @param roomPercent   0..100 tail length / feedback
     * @param dampPercent   0..100 high-frequency absorption (0 = bright stone, 100 = soft)
     * @param wetPercent    0..100 reverb level
     * @param widthPercent  0..100 stereo spread of the tail
     * @param preDelayMs    0..250 initial gap — the main "how big is this room" cue
     * @param sizePercent   50..240 physical room scaling of the comb network
     */
    fun setSpace(
        roomPercent: Int,
        dampPercent: Int,
        wetPercent: Int,
        widthPercent: Int,
        preDelayMs: Int,
        sizePercent: Int,
    ) {
        roomFeedback = 0.7f + roomPercent.coerceIn(0, 100) / 100f * 0.28f
        roomDamp = dampPercent.coerceIn(0, 100) / 100f * 0.7f
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
        predelayCursor = 0
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
        predelayLen = ((predelayMs / 1000f) * sampleRate).toInt().coerceIn(1, predelayBuf.size - 1)
        dirty = false
    }

    /** Call once per audio block (before the per-sample loop). */
    fun tickBlock() {
        if (dirty) retune()
    }

    /**
     * Adds the wet tail to a stereo sample pair, in place.
     * Dry level is only trimmed slightly, so a space enlarges the track
     * instead of fading it out.
     */
    fun process(inL: Float, inR: Float, out: FloatArray) {
        currentWet += smoothing * (targetWet - currentWet)
        currentWidth += smoothing * (targetWidth - currentWidth)
        if (currentWet <= 0.0005f) {
            out[0] = inL
            out[1] = inR
            return
        }
        val mono = (inL + inR) * 0.5f
        val delayed = predelayBuf[predelayCursor]
        predelayBuf[predelayCursor] = mono
        predelayCursor++
        if (predelayCursor >= predelayLen) predelayCursor = 0

        val fed = delayed * 0.045f
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
        val w1 = currentWidth * 0.5f + 0.5f
        val w2 = (1f - currentWidth) * 0.5f
        val gain = currentWet * 3.2f
        val dry = 1f - currentWet * 0.22f
        out[0] = inL * dry + (wetL * w1 + wetR * w2) * gain
        out[1] = inR * dry + (wetR * w1 + wetL * w2) * gain
    }
}
