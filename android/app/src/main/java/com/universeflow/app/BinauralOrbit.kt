package com.universeflow.app

import kotlin.math.PI
import kotlin.math.acos
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * "9D" headphone renderer built on a physical head model, not volume panning.
 *
 * What the brain actually uses to place a sound outside the head, and what
 * each part of this class reproduces:
 *  - Interaural time difference: Woodworth / Brown-Duda spherical-head delay,
 *    up to ~0.65 ms, applied per ear with smooth fractional delays.
 *  - Interaural level + tone difference: Brown-Duda head-shadow filter per
 *    ear (near ear up to +6 dB treble, shadowed ear rolls the treble off).
 *  - Front/back: a presence shelf that brightens in front and darkens behind.
 *  - Elevation: the moving pinna notch (~6 kHz low, ~11 kHz high) while the
 *    orbit rises and dips; above the head both ears converge as in reality.
 *  - Externalisation: a few static early reflections that do not move with
 *    the source, plus a slow change of distance.
 *
 * The song's left and right channels stay two separate virtual sources either
 * side of the orbit point, so the stereo mix survives the rotation. Bass under
 * ~150 Hz is not directional for humans and stays centred and untouched.
 * Pure Kotlin with no Android types and no allocation in [process], so it is
 * safe on the audio thread and fully testable on the JVM.
 */
class BinauralOrbit {
    companion object {
        private const val HEAD_RADIUS = 0.0875
        private const val SPEED_OF_SOUND = 343.0
        private const val ALPHA_MIN = 0.1
        private const val THETA_MIN = 150.0 * PI / 180.0
        const val ORBIT_HZ = 0.085
        private const val ELEVATION_HZ = 0.031
        private const val DISTANCE_HZ = 0.019
        private const val SOURCE_SPREAD = 0.55
        private const val BROADBAND_ILD = 0.43
        private const val MIN_ELEVATION = -0.26
        private const val MAX_ELEVATION = 0.61
        private const val BASS_HZ = 150.0
        private const val BLOCK = 32
        private const val BASE_DELAY = 2f
        /** Two virtual sources reach each ear; this keeps centred vocals at song level. */
        private const val SOURCE_GAIN = 0.62f
        /** Keeps a full orbit at the same loudness as the dry song. */
        private const val WET_NORM = 1.0f
        private val REFLECT_MS = doubleArrayOf(6.1, 8.7, 12.3, 15.9, 21.4, 26.2)
        // Equal total per ear so reflections never pull the image sideways.
        private val REFLECT_GAIN = floatArrayOf(0.24f, 0.22f, 0.16f, 0.17f, 0.11f, 0.10f)
        private val REFLECT_TO_LEFT = booleanArrayOf(true, false, true, false, false, true)
    }

    private var fs = 48000.0
    private var ringL = FloatArray(2048)
    private var ringR = FloatArray(2048)
    private var mask = 2047
    private var cursor = 0
    private val reflectDelay = IntArray(REFLECT_MS.size)

    private var bassCoeff = 0.02f
    private var bassL = 0f
    private var bassR = 0f
    private var reflectCoeff = 0.5f
    private var reflectLpL = 0f
    private var reflectLpR = 0f

    // Index = source * 2 + ear (source 0 = song left, ear 0 = left ear).
    private val delayNow = FloatArray(4)
    private val delayStep = FloatArray(4)
    private val shB0 = FloatArray(4)
    private val shB0Step = FloatArray(4)
    private val shB1 = FloatArray(4)
    private val shB1Step = FloatArray(4)
    private var shA1 = 0f
    private val shX1 = FloatArray(4)
    private val shY1 = FloatArray(4)
    private var shBeta = 0.0
    private var shK = 0.0

    // Per-ear presence shelf (front/back) and pinna notch (elevation).
    private val shelf = Array(2) { Biquad() }
    private val notch = Array(2) { Biquad() }

    private var orbitPhase = 0.0
    private var elevationPhase = 0.0
    private var distancePhase = PI / 2
    private var fixedAzimuth = Double.NaN
    private var fixedElevation = 0.0
    private var reflectLevel = 0.3f
    private var distanceGain = 1f
    private var blockLeft = 0
    private var primed = false

    /** Current orbit azimuth in radians (0 front, +PI/2 right). */
    val azimuth: Double get() = if (fixedAzimuth.isNaN()) orbitPhase else fixedAzimuth

    fun configure(sampleRate: Int) {
        fs = sampleRate.toDouble()
        var size = 1
        val need = (fs * 0.030).toInt() + 64
        while (size < need) size = size shl 1
        ringL = FloatArray(size)
        ringR = FloatArray(size)
        mask = size - 1
        for (i in REFLECT_MS.indices) reflectDelay[i] = (REFLECT_MS[i] * fs / 1000.0).toInt()
        bassCoeff = (1.0 - exp(-2.0 * PI * BASS_HZ / fs)).toFloat()
        reflectCoeff = (1.0 - exp(-2.0 * PI * 5000.0 / fs)).toFloat()
        shBeta = 2.0 * SPEED_OF_SOUND / HEAD_RADIUS
        shK = 2.0 * fs
        shA1 = ((shBeta - shK) / (shBeta + shK)).toFloat()
        reset()
    }

    /** Clears audio history only; the orbit keeps its position. */
    fun reset() {
        ringL.fill(0f); ringR.fill(0f); cursor = 0
        bassL = 0f; bassR = 0f; reflectLpL = 0f; reflectLpR = 0f
        shX1.fill(0f); shY1.fill(0f)
        for (b in shelf) b.clear()
        for (b in notch) b.clear()
        primed = false
        blockLeft = 0
    }

    /** Test hook: freeze the source at one direction (radians). */
    fun fixPosition(azimuth: Double, elevation: Double) {
        fixedAzimuth = azimuth
        fixedElevation = elevation
        primed = false
        blockLeft = 0
    }

    /**
     * Renders one stereo frame. [depth] 0 returns the input untouched, 1 is
     * the full binaural orbit. [out] receives left then right.
     */
    fun process(inL: Float, inR: Float, depth: Float, out: FloatArray) {
        if (blockLeft <= 0) updateBlock()
        blockLeft--

        bassL += bassCoeff * (inL - bassL)
        bassR += bassCoeff * (inR - bassR)
        val hiL = inL - bassL
        val hiR = inR - bassR
        ringL[cursor] = hiL
        ringR[cursor] = hiR

        var earL = 0f
        var earR = 0f
        for (idx in 0 until 4) {
            val d = delayNow[idx]
            delayNow[idx] = d + delayStep[idx]
            val x = tap(if (idx < 2) ringL else ringR, d)
            val b0 = shB0[idx]
            val b1 = shB1[idx]
            shB0[idx] = b0 + shB0Step[idx]
            shB1[idx] = b1 + shB1Step[idx]
            val y = b0 * x + b1 * shX1[idx] - shA1 * shY1[idx]
            shX1[idx] = x
            shY1[idx] = y
            if (idx and 1 == 0) earL += y else earR += y
        }
        earL = notch[0].process(shelf[0].process(earL))
        earR = notch[1].process(shelf[1].process(earR))

        var reflL = 0f
        var reflR = 0f
        for (i in reflectDelay.indices) {
            val p = (cursor - reflectDelay[i]) and mask
            val v = (ringL[p] + ringR[p]) * REFLECT_GAIN[i]
            if (REFLECT_TO_LEFT[i]) reflL += v else reflR += v
        }
        reflectLpL += reflectCoeff * (reflL * 0.5f - reflectLpL)
        reflectLpR += reflectCoeff * (reflR * 0.5f - reflectLpR)

        cursor = (cursor + 1) and mask

        val wetL = (earL * distanceGain + reflectLpL * reflectLevel) * WET_NORM
        val wetR = (earR * distanceGain + reflectLpR * reflectLevel) * WET_NORM
        val keep = 1f - depth
        out[0] = bassL + hiL * keep + wetL * depth
        out[1] = bassR + hiR * keep + wetR * depth
    }

    private fun updateBlock() {
        blockLeft = BLOCK
        val az: Double
        val el: Double
        if (fixedAzimuth.isNaN()) {
            orbitPhase = (orbitPhase + 2.0 * PI * ORBIT_HZ * BLOCK / fs) % (2.0 * PI)
            elevationPhase = (elevationPhase + 2.0 * PI * ELEVATION_HZ * BLOCK / fs) % (2.0 * PI)
            distancePhase = (distancePhase + 2.0 * PI * DISTANCE_HZ * BLOCK / fs) % (2.0 * PI)
            az = orbitPhase
            el = MIN_ELEVATION + (MAX_ELEVATION - MIN_ELEVATION) * (0.5 + 0.5 * sin(elevationPhase))
        } else {
            az = fixedAzimuth
            el = fixedElevation
        }
        // 1.0 .. 1.35 head-radii-relative distance: gently nearer and farther.
        val distance = 1.0 + 0.35 * (0.5 + 0.5 * sin(distancePhase))
        // About 1 dB nearer/farther plus more room when farther; bigger swings pump.
        distanceGain = (SOURCE_GAIN * 1.06 / (1.0 + 0.35 * (distance - 1.0))).toFloat()
        reflectLevel = (0.30 + 0.25 * (distance - 1.0) / 0.35).toFloat()

        val cosEl = cos(el)
        for (s in 0 until 2) {
            val srcAz = az + if (s == 0) -SOURCE_SPREAD else SOURCE_SPREAD
            val right = cosEl * sin(srcAz)
            val incL = acos((-right).coerceIn(-1.0, 1.0))
            val incR = acos(right.coerceIn(-1.0, 1.0))
            val alphaL = shadowAlpha(incL)
            val alphaR = shadowAlpha(incR)
            // Power-normalise the treble across both ears: the ear difference
            // (the direction cue) is kept, but the total brightness no longer
            // swells every time the source passes an ear.
            val alphaNorm = 1.0 / sqrt((alphaL * alphaL + alphaR * alphaR) / 2.0)
            for (e in 0 until 2) {
                val idx = s * 2 + e
                val incidence = if (e == 0) incL else incR
                val alpha = (if (e == 0) alphaL else alphaR) * alphaNorm
                val delaySec = if (incidence < PI / 2) {
                    HEAD_RADIUS / SPEED_OF_SOUND * (1.0 - cos(incidence))
                } else {
                    HEAD_RADIUS / SPEED_OF_SOUND * (1.0 + incidence - PI / 2)
                }
                val targetDelay = BASE_DELAY + (delaySec * fs).toFloat()
                // Broadband level difference measured on real heads (~4 dB at
                // the side in the 300 Hz-1 kHz range), power-preserving across ears.
                val level = sqrt(1.0 + BROADBAND_ILD * cos(incidence))
                val b0 = (level * (shBeta + alpha * shK) / (shBeta + shK)).toFloat()
                val b1 = (level * (shBeta - alpha * shK) / (shBeta + shK)).toFloat()
                if (!primed) {
                    delayNow[idx] = targetDelay; shB0[idx] = b0; shB1[idx] = b1
                }
                delayStep[idx] = (targetDelay - delayNow[idx]) / BLOCK
                shB0Step[idx] = (b0 - shB0[idx]) / BLOCK
                shB1Step[idx] = (b1 - shB1[idx]) / BLOCK
            }
        }

        val front = cosEl * cos(az)
        val shelfDb = if (front >= 0) 1.5 * front else 6.0 * front
        val notchHz = (7600.0 + 6000.0 * el).coerceIn(5500.0, fs * 0.42)
        for (e in 0 until 2) {
            shelf[e].highShelf(fs, 3000.0, shelfDb)
            notch[e].peaking(fs, notchHz, -9.0, 2.5)
        }
        primed = true
    }

    /** Brown-Duda head-shadow treble gain for an angle between source and ear. */
    private fun shadowAlpha(incidence: Double): Double =
        (1.0 + ALPHA_MIN / 2) + (1.0 - ALPHA_MIN / 2) * cos(incidence / THETA_MIN * PI)

    /** Catmull-Rom fractional delay: clean treble while the delay glides. */
    private fun tap(buf: FloatArray, d: Float): Float {
        val di = d.toInt()
        val mu = 1f - (d - di)
        val base = cursor - di - 1
        val xm1 = buf[(base - 1) and mask]
        val x0 = buf[base and mask]
        val x1 = buf[(base + 1) and mask]
        val x2 = buf[(base + 2) and mask]
        val c1 = 0.5f * (x1 - xm1)
        val c2 = xm1 - 2.5f * x0 + 2f * x1 - 0.5f * x2
        val c3 = 0.5f * (x2 - xm1) + 1.5f * (x0 - x1)
        return ((c3 * mu + c2) * mu + c1) * mu + x0
    }

    private class Biquad {
        private var b0 = 1f; private var b1 = 0f; private var b2 = 0f
        private var a1 = 0f; private var a2 = 0f
        private var z1 = 0f; private var z2 = 0f

        fun clear() { z1 = 0f; z2 = 0f }

        fun process(x: Float): Float {
            val y = b0 * x + z1
            z1 = b1 * x - a1 * y + z2
            z2 = b2 * x - a2 * y
            return y
        }

        fun peaking(fs: Double, f0: Double, gainDb: Double, q: Double) {
            val a = 10.0.pow(gainDb / 40.0)
            val w = 2.0 * PI * f0 / fs
            val alpha = sin(w) / (2.0 * q)
            val cw = cos(w)
            val a0 = 1.0 + alpha / a
            set((1.0 + alpha * a) / a0, -2.0 * cw / a0, (1.0 - alpha * a) / a0, -2.0 * cw / a0, (1.0 - alpha / a) / a0)
        }

        fun highShelf(fs: Double, f0: Double, gainDb: Double) {
            val a = 10.0.pow(gainDb / 40.0)
            val w = 2.0 * PI * f0 / fs
            val cw = cos(w)
            val alpha = sin(w) / 2.0 * sqrt(2.0) // S = 1 slope
            val sa = 2.0 * sqrt(a) * alpha
            val a0 = (a + 1) - (a - 1) * cw + sa
            set(
                a * ((a + 1) + (a - 1) * cw + sa) / a0,
                -2 * a * ((a - 1) + (a + 1) * cw) / a0,
                a * ((a + 1) + (a - 1) * cw - sa) / a0,
                2 * ((a - 1) - (a + 1) * cw) / a0,
                ((a + 1) - (a - 1) * cw - sa) / a0,
            )
        }

        private fun set(nb0: Double, nb1: Double, nb2: Double, na1: Double, na2: Double) {
            b0 = nb0.toFloat(); b1 = nb1.toFloat(); b2 = nb2.toFloat()
            a1 = na1.toFloat(); a2 = na2.toFloat()
        }
    }
}
