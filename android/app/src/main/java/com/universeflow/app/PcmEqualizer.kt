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
        private const val FILTER_COUNT = BAND_COUNT + 1
    }

    @Volatile private var enabled = false
    private val targetDb = FloatArray(FILTER_COUNT)
    private val currentDb = FloatArray(FILTER_COUNT)
    @Volatile private var bassDb = 0f
    private var preGain = 1f
    private val responseCos = DoubleArray(192)
    private val responseCos2 = DoubleArray(192)

    fun setBassStrength(strength: Int) { bassDb = strength.coerceIn(0, 1000) * 0.006f }

    // Double precision: float biquads at 31-125 Hz accumulate rounding noise
    // and audible grit (low w0 makes the poles sit right next to the unit circle).
    private val b0 = DoubleArray(FILTER_COUNT) { 1.0 }
    private val b1 = DoubleArray(FILTER_COUNT)
    private val b2 = DoubleArray(FILTER_COUNT)
    private val a1 = DoubleArray(FILTER_COUNT)
    private val a2 = DoubleArray(FILTER_COUNT)

    private val x1 = Array(CHANNELS) { DoubleArray(FILTER_COUNT) }
    private val x2 = Array(CHANNELS) { DoubleArray(FILTER_COUNT) }
    private val y1 = Array(CHANNELS) { DoubleArray(FILTER_COUNT) }
    private val y2 = Array(CHANNELS) { DoubleArray(FILTER_COUNT) }

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
        for (i in responseCos.indices) {
            val frequency = 10.0 * (sampleRate * 0.499 / 10.0).pow(i.toDouble() / (responseCos.size - 1))
            val w = 2.0 * Math.PI * frequency / sampleRate
            responseCos[i] = cos(w)
            responseCos2[i] = cos(2 * w)
        }
        for (i in 0 until FILTER_COUNT) {
            currentDb[i] = if (i == BAND_COUNT) bassDb else if (enabled) targetDb[i] else 0f
            recompute(i)
        }
        updateHeadroom()
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
        for (i in 0 until FILTER_COUNT) {
            val goal = if (i == BAND_COUNT) bassDb else if (enabled) targetDb[i] else 0f
            val delta = goal - currentDb[i]
            if (kotlin.math.abs(delta) > 0.001f) {
                currentDb[i] += delta.coerceIn(-MAX_DB_STEP, MAX_DB_STEP)
                recompute(i)
                moving = true
            }
            if (kotlin.math.abs(currentDb[i]) > 0.01f) nonFlat = true
        }
        active = nonFlat || moving
        if (moving) updateHeadroom()
        if (!active) reset()
        return active
    }

    fun process(channel: Int, input: Float): Float {
        if (!active || channel >= CHANNELS) return input
        var sample = input.toDouble()
        for (i in 0 until FILTER_COUNT) {
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
        val freq = if (index == BAND_COUNT) 120.0 else CENTER_FREQS_HZ[index].toDouble()
        if (freq >= sampleRate * 0.45) {
            b0[index] = 1.0; b1[index] = 0.0; b2[index] = 0.0; a1[index] = 0.0; a2[index] = 0.0
            return
        }
        val a = 10.0.pow(currentDb[index] / 40.0)
        val w0 = 2.0 * Math.PI * freq / sampleRate
        val cosW0 = cos(w0)
        val alpha = sin(w0) / (2.0 * Q)
        if (index == BAND_COUNT) {
            // RBJ low shelf, before the limiter and shared by both players.
            val shelfAlpha = sin(w0) / sqrt(2.0)
            val beta = 2.0 * sqrt(a) * shelfAlpha
            val denominator = (a + 1) + (a - 1) * cosW0 + beta
            b0[index] = a * ((a + 1) - (a - 1) * cosW0 + beta) / denominator
            b1[index] = 2 * a * ((a - 1) - (a + 1) * cosW0) / denominator
            b2[index] = a * ((a + 1) - (a - 1) * cosW0 - beta) / denominator
            a1[index] = -2 * ((a - 1) + (a + 1) * cosW0) / denominator
            a2[index] = ((a + 1) + (a - 1) * cosW0 - beta) / denominator
            return
        }
        val a0 = 1.0 + alpha / a
        b0[index] = (1.0 + alpha * a) / a0
        b1[index] = (-2.0 * cosW0) / a0
        b2[index] = (1.0 - alpha * a) / a0
        a1[index] = (-2.0 * cosW0) / a0
        a2[index] = (1.0 - alpha / a) / a0
    }

    /** Cache the combined implemented response, not the largest single band. */
    private fun updateHeadroom() {
        var peakSquared = 1.0
        for (j in responseCos.indices) {
            var magnitudeSquared = 1.0
            for (i in 0 until FILTER_COUNT) {
                val numerator = b0[i]*b0[i] + b1[i]*b1[i] + b2[i]*b2[i] +
                    2*(b0[i]*b1[i] + b1[i]*b2[i])*responseCos[j] + 2*b0[i]*b2[i]*responseCos2[j]
                val denominator = 1 + a1[i]*a1[i] + a2[i]*a2[i] +
                    2*(a1[i] + a1[i]*a2[i])*responseCos[j] + 2*a2[i]*responseCos2[j]
                magnitudeSquared *= numerator.coerceAtLeast(0.0) / denominator.coerceAtLeast(1e-20)
            }
            peakSquared = maxOf(peakSquared, magnitudeSquared)
        }
        preGain = if (peakSquared > 1.0001) (0.944 / sqrt(peakSquared)).toFloat() else 1f
    }

    fun headroomGain(): Float = if (active) preGain else 1f
}
