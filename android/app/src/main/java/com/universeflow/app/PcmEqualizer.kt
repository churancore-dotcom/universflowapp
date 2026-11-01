package com.universeflow.app

import kotlin.math.cos
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * Device-independent 10-band parametric equalizer running inside the Media3 PCM
 * pipeline.
 *
 * The Android `android.media.audiofx.Equalizer` is a vendor effect: band count,
 * centre frequencies and even availability differ per device, and several
 * Qualcomm/MTK builds silently ignore band writes or reset to flat on every new
 * audio session. That is why "bands kaam nhi kr rhe" on real phones. This class
 * replaces it with our own biquad chain, so every band behaves identically on
 * every device and survives session rebinds (the processor lives with the
 * renderer, not with the session id).
 *
 * Gains are smoothed per block, so a slider drag is a sweep instead of a
 * coefficient jump (the audible "zipper" click / audio-track stall).
 */
class PcmEqualizer {
    companion object {
        /** Fixed, ISO-ish 10-band layout reported to the UI. */
        val CENTER_FREQS_HZ = intArrayOf(31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000)
        const val BAND_COUNT = 10
        const val MIN_LEVEL_MB = -1500
        const val MAX_LEVEL_MB = 1500
        private const val Q = 1.0
        /** Max dB moved per smoothing block; keeps sweeps click-free. */
        private const val MAX_DB_STEP = 0.08f
        private const val CHANNELS = 2
    }

    @Volatile private var enabled = false
    private val targetDb = FloatArray(BAND_COUNT)
    private val currentDb = FloatArray(BAND_COUNT)

    // Double precision: float biquads at 31-125 Hz accumulate rounding noise
    // and audible grit (low w0 makes the poles sit right next to the unit circle).
    private val b0 = DoubleArray(BAND_COUNT) { 1.0 }
    private val b1 = DoubleArray(BAND_COUNT)
    private val b2 = DoubleArray(BAND_COUNT)
    private val a1 = DoubleArray(BAND_COUNT)
    private val a2 = DoubleArray(BAND_COUNT)

    private val x1 = Array(CHANNELS) { DoubleArray(BAND_COUNT) }
    private val x2 = Array(CHANNELS) { DoubleArray(BAND_COUNT) }
    private val y1 = Array(CHANNELS) { DoubleArray(BAND_COUNT) }
    private val y2 = Array(CHANNELS) { DoubleArray(BAND_COUNT) }

    private var sampleRate = 44100
    /** True while any band is non-flat or still ramping back to flat. */
    private var active = false

    fun setEnabled(value: Boolean) {
        enabled = value
    }

    fun isEnabled(): Boolean = enabled

    fun setBandMillibels(index: Int, millibels: Int) {
        if (index < 0 || index >= BAND_COUNT) return
        targetDb[index] = millibels.coerceIn(MIN_LEVEL_MB, MAX_LEVEL_MB) / 100f
    }

    fun getBandMillibels(index: Int): Int {
        if (index < 0 || index >= BAND_COUNT) return 0
        return (targetDb[index] * 100f).toInt()
    }

    fun configure(rate: Int) {
        sampleRate = if (rate > 0) rate else 44100
        for (i in 0 until BAND_COUNT) {
            currentDb[i] = targetDb[i]
            recompute(i)
        }
        reset()
    }

    fun reset() {
        for (c in 0 until CHANNELS) {
            java.util.Arrays.fill(x1[c], 0.0)
            java.util.Arrays.fill(x2[c], 0.0)
            java.util.Arrays.fill(y1[c], 0.0)
            java.util.Arrays.fill(y2[c], 0.0)
        }
    }

    /**
     * Advance gain smoothing one block. Returns true when the chain has to be
     * run for this block (non-flat, or still fading out to flat).
     */
    fun tickBlock(): Boolean {
        var moving = false
        var nonFlat = false
        for (i in 0 until BAND_COUNT) {
            val goal = if (enabled) targetDb[i] else 0f
            val delta = goal - currentDb[i]
            if (kotlin.math.abs(delta) > 0.001f) {
                currentDb[i] += delta.coerceIn(-MAX_DB_STEP, MAX_DB_STEP)
                recompute(i)
                moving = true
            }
            if (kotlin.math.abs(currentDb[i]) > 0.01f) nonFlat = true
        }
        active = nonFlat || moving
        if (!active) reset()
        return active
    }

    fun process(channel: Int, input: Float): Float {
        if (!active || channel >= CHANNELS) return input
        var sample = input.toDouble()
        for (i in 0 until BAND_COUNT) {
            if (kotlin.math.abs(currentDb[i]) < 0.005f) continue
            val x0 = sample
            val out = b0[i] * x0 + b1[i] * x1[channel][i] + b2[i] * x2[channel][i] -
                a1[i] * y1[channel][i] - a2[i] * y2[channel][i]
            x2[channel][i] = x1[channel][i]
            x1[channel][i] = x0
            y2[channel][i] = y1[channel][i]
            y1[channel][i] = out
            sample = out
        }
        return sample.toFloat()
    }

    /** RBJ peaking-EQ coefficients for one band at its current gain. */
    private fun recompute(index: Int) {
        val freq = CENTER_FREQS_HZ[index].toDouble()
        if (freq >= sampleRate * 0.45) {
            b0[index] = 1.0; b1[index] = 0.0; b2[index] = 0.0; a1[index] = 0.0; a2[index] = 0.0
            return
        }
        val a = 10.0.pow(currentDb[index] / 40.0)
        val w0 = 2.0 * Math.PI * freq / sampleRate
        val cosW0 = cos(w0)
        val alpha = sin(w0) / (2.0 * Q)
        val a0 = 1.0 + alpha / a
        b0[index] = (1.0 + alpha * a) / a0
        b1[index] = (-2.0 * cosW0) / a0
        b2[index] = (1.0 - alpha * a) / a0
        a1[index] = (-2.0 * cosW0) / a0
        a2[index] = (1.0 - alpha / a) / a0
    }

    /**
     * Pre-gain equal to the largest boost, so a boosted band lands at the
     * original level instead of slamming the limiter (the old half-dB-for-dB
     * trim made every boost distort on loud masters).
     */
    fun headroomGain(): Float {
        if (!active) return 1f
        var maxDb = 0f
        for (i in 0 until BAND_COUNT) if (currentDb[i] > maxDb) maxDb = currentDb[i]
        if (maxDb <= 0f) return 1f
        return 1f / 10f.pow(maxDb / 20f)
    }
}
