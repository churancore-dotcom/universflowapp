package com.universeflow.app

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * Studio Space room engine for the ExoPlayer PCM path.
 *
 * Why the old version made every space sound the same: it was one Freeverb
 * network whose only real difference between rooms was the decay length. A
 * stadium, a hall and a cathedral all had the same reflection pattern, the
 * same tone, no echoes and no movement, so the ear heard "the same reverb,
 * longer or shorter".
 *
 * What makes a real place recognisable (and what each [Character] now owns):
 *  - Early reflections: the exact pattern of the first wall/ceiling bounces.
 *    A booth answers in 1-6 ms, a hall from the side walls at 10-70 ms, a
 *    cathedral with sparse stone hits up to 140 ms.
 *  - Discrete echoes: stadium stands and canyon walls send back distinct
 *    slapbacks (260 ms, 420 ms...). No reverb network can fake this.
 *  - Frequency-dependent decay: wooden halls keep their bass longer (warm),
 *    stone keeps treble (bright), open air and crowds swallow highs (dark).
 *  - Diffusion + slow modulation of the tail so it blooms like air instead
 *    of ringing metallically.
 *  - Distance: in big venues you hear less direct sound and more room.
 *
 * Signal flow:
 *   in -> band-limited send -> pre-delay -> early reflections
 *                                        -> echo line (ping-pong for canyon)
 *                                        -> 4 diffusers -> 8-line FDN tail
 *   out = dry*distance + (ER + echoes + ducked tail)
 *
 * Clean-but-audible rules stay: the dry track is never EQ'd, the send is
 * band-limited, the tail is ducked by the dry envelope (normalised from the
 * 16-bit sample scale), and the downstream look-ahead limiter catches peaks.
 * Delay networks only change while faded out, so switching spaces never
 * clicks and effect updates never resize a playing room.
 */
class RoomReverb {

    /** The acoustic fingerprint of one Studio Space. */
    class Character(
        val id: String,
        /** Mid-band decay time in seconds. */
        val rt60: Float,
        /** Low-band decay multiplier (> 1 = warm, bass hangs longer). */
        val bassRatio: Float,
        /** High-band decay multiplier (< 1 = absorption, dark). */
        val trebleRatio: Float,
        val crossoverHz: Float,
        val predelayMs: Float,
        /** Early reflection taps after the pre-delay: time, gain, pan -1..1. */
        val erMs: FloatArray,
        val erGain: FloatArray,
        val erPan: FloatArray,
        val erLpHz: Float,
        val sendHpHz: Float,
        val sendLpHz: Float,
        /** Input diffuser coefficient 0.5..0.75 (higher = smoother onset). */
        val diffusion: Float,
        val modDepthMs: Float,
        val modRateHz: Float,
        /** Tail delay-line scaling (density); bounded so halls never flutter. */
        val fdnScale: Float,
        val width: Float,
        /** Direct sound left at full wet (distance cue). */
        val direct: Float,
        val erLevel: Float,
        val tailLevel: Float,
        val echoMs: Float = 0f,
        val echoSpreadMs: Float = 0f,
        val echoGain: Float = 0f,
        val echoFeedback: Float = 0f,
        val echoLpHz: Float = 4000f,
        val echoPingPong: Boolean = false,
    )

    // ---------------------------------------------------------------- state
    private var sampleRate = 44100

    private var preL = FloatArray(1)
    private var preR = FloatArray(1)
    private var preCursor = 0
    private var preLen = 1

    private var erBufL = FloatArray(1)
    private var erBufR = FloatArray(1)
    private var erCursor = 0
    private val erOff = IntArray(MAX_ER)
    private val erGl = FloatArray(MAX_ER)
    private val erGr = FloatArray(MAX_ER)
    private var erCount = 0
    private var erLpCoeff = 0.5f
    private var erLpL = 0f
    private var erLpR = 0f

    private var hpCoeff = 0.98f
    private var hpStateL = 0f; private var hpPrevL = 0f
    private var hpStateR = 0f; private var hpPrevR = 0f
    private var sendLpCoeff = 0.6f
    private var lp1L = 0f; private var lp2L = 0f
    private var lp1R = 0f; private var lp2R = 0f

    private val diffMs = floatArrayOf(4.7f, 3.6f, 12.7f, 9.3f)
    private var diffL = Array(4) { FloatArray(4) }
    private var diffR = Array(4) { FloatArray(4) }
    private val diffLenL = IntArray(4)
    private val diffLenR = IntArray(4)
    private val diffIdxL = IntArray(4)
    private val diffIdxR = IntArray(4)
    private var diffG = 0.65f

    private var echoL = FloatArray(1)
    private var echoR = FloatArray(1)
    private var echoCursor = 0
    private var echoLenL = 1
    private var echoLenR = 1
    private var echoLpCoeff = 0.4f
    private var echoFbL = 0f
    private var echoFbR = 0f
    private var echoFeedback = 0f
    private var echoGain = 0f
    private var echoPing = false

    private val fdnMs = floatArrayOf(29.7f, 37.1f, 41.1f, 43.7f, 53.3f, 59.9f, 67.7f, 73.1f)
    private val fdnSign = floatArrayOf(1f, 1f, -1f, -1f, 1f, -1f, -1f, 1f)
    private var fdn = Array(8) { FloatArray(4) }
    private val fdnLen = IntArray(8)
    private val fdnCursor = IntArray(8)
    private val fdnLow = FloatArray(8)
    private val gLow = FloatArray(8)
    private val gHigh = FloatArray(8)
    private val fdnY = FloatArray(8)
    private var xoverCoeff = 0.05f
    private val lfoC = FloatArray(4)
    private val lfoS = FloatArray(4)
    private val lfoCosW = FloatArray(4)
    private val lfoSinW = FloatArray(4)
    private var modDepth = 0f
    private var tailLpCoeff = 0.6f
    private var tailLpL = 0f
    private var tailLpR = 0f

    private var tailNorm = 0.02f
    private var erNorm = 1f
    private var widthActive = 1f
    private var directActive = 0.9f

    private var env = 0f
    private var envAttack = 0.01f
    private var envRelease = 0.0005f
    private var smoothing = 0.0008f
    private var currentWet = 0f
    @Volatile private var targetWet = 0f

    // Structural swaps (new room) happen only while faded out.
    private var fade = 1f
    private var fadeTarget = 1f
    private var fadeStep = 0.001f
    private var active: Character? = null
    @Volatile private var pending: Character = PLAIN_DEFAULT

    val isActive: Boolean
        get() = targetWet > 0.0005f || currentWet > 0.0005f

    /** Id of the room currently audible (for tests/diagnostics). */
    val activeId: String? get() = active?.id

    fun configure(rate: Int) {
        sampleRate = if (rate > 0) rate else 44100
        val sr = sampleRate.toFloat()
        preL = FloatArray((sr * 0.25f).toInt() + 8)
        preR = FloatArray(preL.size)
        erBufL = FloatArray((sr * 0.2f).toInt() + 8)
        erBufR = FloatArray(erBufL.size)
        echoL = FloatArray((sr * 0.75f).toInt() + 8)
        echoR = FloatArray(echoL.size)
        diffL = Array(4) { FloatArray((diffMs[it] * MAX_SCALE * sr / 1000f).toInt() + 8) }
        diffR = Array(4) { FloatArray((diffMs[it] * MAX_SCALE * 1.07f * sr / 1000f).toInt() + 8) }
        val maxMod = 1.2f * sr / 1000f
        fdn = Array(8) { FloatArray((fdnMs[it] * MAX_SCALE * sr / 1000f + maxMod).toInt() + 8) }
        envAttack = 1f - exp(-1f / (sr * 0.03f))
        envRelease = 1f - exp(-1f / (sr * 0.35f))
        smoothing = 1f - exp(-1f / (sr * 0.035f))
        fadeStep = 1f / (sr * 0.04f)
        active = null
        clearBuffers()
        swapIn(pending)
    }

    /**
     * @param kind          Studio Space id (hall, stadium, ...). Null/unknown
     *                      builds a generic room from the numbers below
     *                      (used by the plain reverb slider).
     * @param roomPercent   0..100 tail length
     * @param dampPercent   0..100 high-frequency absorption
     * @param wetPercent    0..100 room level
     * @param widthPercent  0..100 stereo spread
     * @param preDelayMs    0..240 initial gap
     * @param sizePercent   50..240 physical room scaling
     */
    fun setSpace(
        roomPercent: Int,
        dampPercent: Int,
        wetPercent: Int,
        widthPercent: Int,
        preDelayMs: Int,
        sizePercent: Int,
        kind: String? = null,
    ) {
        targetWet = wetPercent.coerceIn(0, 100) / 100f
        val preset = kind?.let { CHARACTERS[it] }
        val next = preset ?: genericCharacter(roomPercent, dampPercent, widthPercent, preDelayMs, sizePercent)
        if (!sameCharacter(next, pending)) pending = next
    }

    fun reset() {
        clearBuffers()
        currentWet = 0f
        env = 0f
        val p = pending
        if (active !== p) swapIn(p)
        fade = 1f
        fadeTarget = 1f
    }

    /** Called once per audio block on the audio thread. */
    fun tickBlock() {
        val p = pending
        if (active !== p) {
            if (currentWet <= 0.0005f || fade <= 0.0005f) {
                clearBuffers()
                swapIn(p)
                fade = if (currentWet <= 0.0005f) 1f else 0f
                fadeTarget = 1f
            } else {
                fadeTarget = 0f
            }
        }
        // Keep the LFO phasors on the unit circle.
        for (i in 0 until 4) {
            val m = sqrt(lfoC[i] * lfoC[i] + lfoS[i] * lfoS[i])
            if (m > 0f) { lfoC[i] /= m; lfoS[i] /= m } else { lfoC[i] = 1f; lfoS[i] = 0f }
        }
    }

    /** Adds the room to a stereo sample pair (16-bit sample scale). */
    fun process(inL: Float, inR: Float, out: FloatArray) {
        currentWet += smoothing * (targetWet - currentWet)
        if (fade != fadeTarget) {
            fade = if (fade < fadeTarget) min(fadeTarget, fade + fadeStep) else max(fadeTarget, fade - fadeStep)
        }
        if (currentWet <= 0.0005f) {
            out[0] = inL
            out[1] = inR
            return
        }

        // Band-limited send: no bass boom, no hiss/sibilance in the room.
        hpStateL = hpCoeff * (hpStateL + inL - hpPrevL); hpPrevL = inL
        hpStateR = hpCoeff * (hpStateR + inR - hpPrevR); hpPrevR = inR
        lp1L += sendLpCoeff * (hpStateL - lp1L); lp2L += sendLpCoeff * (lp1L - lp2L)
        lp1R += sendLpCoeff * (hpStateR - lp1R); lp2R += sendLpCoeff * (lp1R - lp2R)
        val sendL = lp2L
        val sendR = lp2R

        // Dry envelope, normalised from 16-bit scale, drives the duck.
        val level = max(abs(inL), abs(inR)) * INV_FULL_SCALE
        env += (if (level > env) envAttack else envRelease) * (level - env)

        // Pre-delay.
        val dL = preL[preCursor]
        val dR = preR[preCursor]
        preL[preCursor] = sendL
        preR[preCursor] = sendR
        if (++preCursor >= preLen) preCursor = 0

        // Early reflections: this room's own wall pattern.
        erBufL[erCursor] = dL
        erBufR[erCursor] = dR
        val n = erBufL.size
        var eL = 0f
        var eR = 0f
        for (i in 0 until erCount) {
            var idx = erCursor - erOff[i]
            if (idx < 0) idx += n
            val tl = erBufL[idx]
            val tr = erBufR[idx]
            eL += (tl * 0.75f + tr * 0.25f) * erGl[i]
            eR += (tr * 0.75f + tl * 0.25f) * erGr[i]
        }
        if (++erCursor >= n) erCursor = 0
        erLpL += erLpCoeff * (eL - erLpL)
        erLpR += erLpCoeff * (eR - erLpR)
        eL = erLpL
        eR = erLpR

        // Discrete echoes (stadium stands, canyon walls).
        var xL = 0f
        var xR = 0f
        if (echoGain > 0f) {
            val en = echoL.size
            var il = echoCursor - echoLenL; if (il < 0) il += en
            var ir = echoCursor - echoLenR; if (ir < 0) ir += en
            echoFbL += echoLpCoeff * (echoL[il] - echoFbL)
            echoFbR += echoLpCoeff * (echoR[ir] - echoFbR)
            if (echoPing) {
                echoL[echoCursor] = (dL + dR) * 0.5f + echoFbR * echoFeedback
                echoR[echoCursor] = echoFbL * echoFeedback
            } else {
                echoL[echoCursor] = dL + echoFbL * echoFeedback
                echoR[echoCursor] = dR + echoFbR * echoFeedback
            }
            if (++echoCursor >= en) echoCursor = 0
            xL = echoFbL
            xR = echoFbR
        }

        // Diffuse what feeds the tail (walls + echoes build the late field).
        var fL = dL * 0.6f + eL * 0.5f + xL * 0.5f
        var fR = dR * 0.6f + eR * 0.5f + xR * 0.5f
        for (k in 0 until 4) {
            fL = allpass(diffL[k], diffIdxL, k, diffLenL[k], fL)
            fR = allpass(diffR[k], diffIdxR, k, diffLenR[k], fR)
        }
        fL = fL * tailNorm + DENORMAL_GUARD
        fR = fR * tailNorm + DENORMAL_GUARD

        // 8-line feedback delay network with two-band decay and slow
        // modulation on four lines (lush, non-metallic tail).
        var sum = 0f
        for (i in 0 until 8) {
            val buf = fdn[i]
            val size = buf.size
            val o: Float
            if (i < 4) {
                val c = lfoC[i]; val s = lfoS[i]
                lfoC[i] = c * lfoCosW[i] - s * lfoSinW[i]
                lfoS[i] = s * lfoCosW[i] + c * lfoSinW[i]
                var rp = fdnCursor[i] - (fdnLen[i] + modDepth * (1f + s) * 0.5f)
                if (rp < 0f) rp += size
                val i0 = rp.toInt()
                val frac = rp - i0
                val a = buf[if (i0 >= size) i0 - size else i0]
                val b = buf[if (i0 + 1 >= size) i0 + 1 - size else i0 + 1]
                o = a + (b - a) * frac
            } else {
                var ri = fdnCursor[i] - fdnLen[i]
                if (ri < 0) ri += size
                o = buf[ri]
            }
            fdnLow[i] += xoverCoeff * (o - fdnLow[i])
            val y = fdnLow[i] * gLow[i] + (o - fdnLow[i]) * gHigh[i]
            fdnY[i] = y
            sum += y
        }
        val hh = sum * 0.25f
        for (i in 0 until 8) {
            val buf = fdn[i]
            val inject = if ((i and 1) == 0) fL else fR
            buf[fdnCursor[i]] = fdnY[i] - hh + inject * fdnSign[i]
            if (++fdnCursor[i] >= buf.size) fdnCursor[i] = 0
        }
        var tL = fdnY[0] - fdnY[2] + fdnY[4] - fdnY[6]
        var tR = fdnY[1] - fdnY[3] + fdnY[5] - fdnY[7]
        tailLpL += tailLpCoeff * (tL - tailLpL)
        tailLpR += tailLpCoeff * (tR - tailLpR)
        val mid = (tailLpL + tailLpR) * 0.5f
        val side = (tailLpL - tailLpR) * 0.5f * widthActive
        tL = mid + side
        tR = mid - side

        // Duck the tail while the song is loud; let the room bloom in gaps.
        val x = (env * 3f).coerceIn(0f, 1f)
        val duck = 1f - 0.3f * (x * x * (3f - 2f * x))
        val w = currentWet * fade
        val tailGain = w * duck
        val erGain = w * erNorm * (0.75f + 0.25f * duck)
        val echoOut = w * echoGain * (0.85f + 0.15f * duck)
        // Distance: big venues leave less direct sound. Pure gain, no EQ.
        val dry = (1f - currentWet * (1f - directActive) * 1.5f).coerceIn(0.55f, 1f)
        out[0] = inL * dry + eL * erGain + xL * echoOut + tL * tailGain
        out[1] = inR * dry + eR * erGain + xR * echoOut + tR * tailGain
    }

    // ------------------------------------------------------------ internals
    private fun allpass(buf: FloatArray, idx: IntArray, k: Int, len: Int, x: Float): Float {
        var i = idx[k]
        var r = i - len
        if (r < 0) r += buf.size
        val delayed = buf[r]
        val v = x + diffG * delayed
        buf[i] = v
        if (++i >= buf.size) i = 0
        idx[k] = i
        return delayed - diffG * v
    }

    private fun clearBuffers() {
        java.util.Arrays.fill(preL, 0f); java.util.Arrays.fill(preR, 0f)
        java.util.Arrays.fill(erBufL, 0f); java.util.Arrays.fill(erBufR, 0f)
        java.util.Arrays.fill(echoL, 0f); java.util.Arrays.fill(echoR, 0f)
        diffL.forEach { java.util.Arrays.fill(it, 0f) }
        diffR.forEach { java.util.Arrays.fill(it, 0f) }
        fdn.forEach { java.util.Arrays.fill(it, 0f) }
        java.util.Arrays.fill(fdnLow, 0f)
        java.util.Arrays.fill(diffIdxL, 0); java.util.Arrays.fill(diffIdxR, 0)
        java.util.Arrays.fill(fdnCursor, 0)
        preCursor = 0; erCursor = 0; echoCursor = 0
        hpStateL = 0f; hpPrevL = 0f; hpStateR = 0f; hpPrevR = 0f
        lp1L = 0f; lp2L = 0f; lp1R = 0f; lp2R = 0f
        erLpL = 0f; erLpR = 0f; echoFbL = 0f; echoFbR = 0f
        tailLpL = 0f; tailLpR = 0f
    }

    private fun onePole(hz: Float): Float {
        val dt = 1f / sampleRate
        val rc = 1f / (2f * PI.toFloat() * hz.coerceIn(20f, sampleRate * 0.45f))
        return dt / (rc + dt)
    }

    private fun swapIn(c: Character) {
        val sr = sampleRate.toFloat()
        // Send band.
        val rcHp = 1f / (2f * PI.toFloat() * c.sendHpHz)
        hpCoeff = rcHp / (rcHp + 1f / sr)
        sendLpCoeff = onePole(c.sendLpHz)

        preLen = (c.predelayMs * sr / 1000f).toInt().coerceIn(1, preL.size - 1)

        // Early reflections with equal-power panning.
        erCount = min(MAX_ER, c.erMs.size)
        var erEnergy = 0f
        for (i in 0 until erCount) {
            erOff[i] = (c.erMs[i] * sr / 1000f).toInt().coerceIn(1, erBufL.size - 1)
            val p = c.erPan[i].coerceIn(-1f, 1f)
            erGl[i] = c.erGain[i] * sqrt((1f - p) * 0.5f) * 1.414f
            erGr[i] = c.erGain[i] * sqrt((1f + p) * 0.5f) * 1.414f
            erEnergy += c.erGain[i] * c.erGain[i]
        }
        erNorm = if (erEnergy > 0f) c.erLevel * ER_LEVEL / sqrt(erEnergy) else 0f
        erLpCoeff = onePole(c.erLpHz)

        // Diffusers scale with the room (small rooms = tighter grain).
        val ds = c.fdnScale.coerceIn(MIN_SCALE, MAX_SCALE)
        for (k in 0 until 4) {
            diffLenL[k] = (diffMs[k] * ds * sr / 1000f).toInt().coerceIn(2, diffL[k].size - 1)
            diffLenR[k] = (diffMs[k] * ds * 1.07f * sr / 1000f).toInt().coerceIn(2, diffR[k].size - 1)
        }
        diffG = c.diffusion.coerceIn(0.4f, 0.75f)

        // Echo line.
        echoGain = c.echoGain * ECHO_LEVEL
        echoFeedback = c.echoFeedback.coerceIn(0f, 0.6f)
        echoPing = c.echoPingPong
        echoLenL = (c.echoMs * sr / 1000f).toInt().coerceIn(1, echoL.size - 1)
        echoLenR = ((c.echoMs + c.echoSpreadMs) * sr / 1000f).toInt().coerceIn(1, echoL.size - 1)
        echoLpCoeff = onePole(c.echoLpHz)

        // Tail network: per-line two-band decay from the room's RT60.
        val fs = c.fdnScale.coerceIn(MIN_SCALE, MAX_SCALE)
        var avgDelay = 0f
        val rtLow = c.rt60 * c.bassRatio
        val rtHigh = c.rt60 * c.trebleRatio
        for (i in 0 until 8) {
            fdnLen[i] = (fdnMs[i] * fs * sr / 1000f).toInt().coerceIn(8, fdn[i].size - 40)
            val sec = fdnLen[i] / sr
            avgDelay += sec
            gLow[i] = decayGain(sec, rtLow)
            gHigh[i] = decayGain(sec, rtHigh)
        }
        avgDelay /= 8f
        xoverCoeff = onePole(c.crossoverHz)
        modDepth = (c.modDepthMs * sr / 1000f).coerceIn(0f, 1.2f * sr / 1000f)
        for (i in 0 until 4) {
            val hz = c.modRateHz * (0.73f + 0.19f * i)
            val wv = 2f * PI.toFloat() * hz / sr
            lfoCosW[i] = cos(wv); lfoSinW[i] = sin(wv)
            lfoC[i] = cos(i * 1.3f); lfoS[i] = sin(i * 1.3f)
        }
        tailLpCoeff = onePole(c.sendLpHz * 0.9f)
        // Energy of an exponential tail grows with RT60 and line density.
        // Normalise it, then let longer rooms keep a little more body.
        val energy = 4f * c.rt60 / (13.8f * avgDelay)
        val perceived = sqrt(c.rt60.coerceIn(0.15f, 8f))
        tailNorm = c.tailLevel * TAIL_LEVEL * sqrt(perceived / max(0.2f, energy))
        widthActive = c.width.coerceIn(0f, 1f)
        directActive = c.direct.coerceIn(0.6f, 1f)
        active = c
    }

    private fun decayGain(delaySec: Float, rt: Float): Float {
        val g = Math.pow(10.0, -3.0 * delaySec / max(0.08f, rt)).toFloat()
        return g.coerceIn(0f, 0.9995f)
    }

    private fun sameCharacter(a: Character, b: Character): Boolean {
        if (a === b) return true
        if (a.id != b.id) return false
        if (!a.id.startsWith("generic")) return true
        return a.rt60 == b.rt60 && a.trebleRatio == b.trebleRatio && a.predelayMs == b.predelayMs &&
            a.fdnScale == b.fdnScale && a.width == b.width
    }

    private fun genericCharacter(room: Int, damp: Int, width: Int, predelay: Int, size: Int): Character {
        val r = room.coerceIn(0, 100) / 100f
        val d = damp.coerceIn(0, 100) / 100f
        val s = size.coerceIn(50, 240) / 100f
        val er = floatArrayOf(4.3f, 9.7f, 15.1f, 21.9f, 29.3f, 37.1f).map { it * s.coerceIn(0.4f, 2f) }.toFloatArray()
        return Character(
            id = "generic",
            rt60 = 0.18f * Math.pow(33.0, r.toDouble()).toFloat(),
            bassRatio = 1.1f, trebleRatio = 1f - d * 0.6f, crossoverHz = 400f,
            predelayMs = predelay.coerceIn(0, 240).toFloat(),
            erMs = er,
            erGain = floatArrayOf(0.7f, 0.56f, 0.46f, 0.38f, 0.3f, 0.24f),
            erPan = floatArrayOf(-0.6f, 0.6f, -0.3f, 0.4f, -0.7f, 0.7f),
            erLpHz = 11000f - d * 6000f,
            sendHpHz = 150f, sendLpHz = 12000f - d * 6000f,
            diffusion = 0.68f, modDepthMs = 0.3f, modRateHz = 0.4f,
            fdnScale = s.coerceIn(MIN_SCALE, MAX_SCALE),
            width = width.coerceIn(0, 100) / 100f,
            direct = 0.92f, erLevel = 0.8f, tailLevel = 0.9f,
        )
    }

    companion object {
        private const val INV_FULL_SCALE = 1f / 32768f
        private const val MAX_ER = 12
        private const val MIN_SCALE = 0.55f
        private const val MAX_SCALE = 1.4f
        private const val DENORMAL_GUARD = 1e-20f
        // Overall calibration (measured with the RoomReverbProbe harness).
        private const val ER_LEVEL = 0.55f
        private const val TAIL_LEVEL = 0.3f
        private const val ECHO_LEVEL = 0.9f

        private fun f(vararg v: Float) = v

        private val PLAIN_DEFAULT = Character(
            id = "generic-default", rt60 = 0.8f, bassRatio = 1.1f, trebleRatio = 0.7f, crossoverHz = 400f,
            predelayMs = 14f,
            erMs = f(4.3f, 9.7f, 15.1f, 21.9f, 29.3f, 37.1f),
            erGain = f(0.7f, 0.56f, 0.46f, 0.38f, 0.3f, 0.24f),
            erPan = f(-0.6f, 0.6f, -0.3f, 0.4f, -0.7f, 0.7f),
            erLpHz = 8000f, sendHpHz = 150f, sendLpHz = 9000f,
            diffusion = 0.68f, modDepthMs = 0.3f, modRateHz = 0.4f, fdnScale = 1f,
            width = 0.8f, direct = 0.92f, erLevel = 0.8f, tailLevel = 0.9f,
        )

        /** Ids match the app's Studio Space ids. */
        val CHARACTERS: Map<String, Character> = listOf(
            // Tiny dead booth: walls answer in 1-6 ms, dark, almost no tail.
            Character(
                id = "vinyl", rt60 = 0.22f, bassRatio = 1.1f, trebleRatio = 0.45f, crossoverHz = 500f,
                predelayMs = 1f,
                erMs = f(1.2f, 2.1f, 3.0f, 3.9f, 5.1f, 6.4f),
                erGain = f(0.55f, 0.45f, 0.38f, 0.3f, 0.24f, 0.18f),
                erPan = f(-0.6f, 0.6f, -0.3f, 0.4f, -0.7f, 0.7f),
                erLpHz = 3500f, sendHpHz = 220f, sendLpHz = 4200f,
                diffusion = 0.7f, modDepthMs = 0.08f, modRateHz = 0.5f, fdnScale = 0.55f,
                width = 0.45f, direct = 0.97f, erLevel = 0.95f, tailLevel = 0.45f,
            ),
            // Treated control room: quick, bright, tightly controlled.
            Character(
                id = "studio", rt60 = 0.32f, bassRatio = 1.0f, trebleRatio = 0.75f, crossoverHz = 400f,
                predelayMs = 3f,
                erMs = f(2.3f, 3.7f, 5.2f, 7.9f, 10.4f, 13.1f),
                erGain = f(0.5f, 0.42f, 0.34f, 0.26f, 0.2f, 0.15f),
                erPan = f(-0.7f, 0.7f, -0.4f, 0.5f, -0.2f, 0.3f),
                erLpHz = 10000f, sendHpHz = 200f, sendLpHz = 10000f,
                diffusion = 0.68f, modDepthMs = 0.12f, modRateHz = 0.6f, fdnScale = 0.62f,
                width = 0.7f, direct = 0.97f, erLevel = 0.85f, tailLevel = 0.55f,
            ),
            // Soft furnished room: close walls, curtains eat the treble.
            Character(
                id = "bedroom", rt60 = 0.5f, bassRatio = 1.15f, trebleRatio = 0.5f, crossoverHz = 450f,
                predelayMs = 4f,
                erMs = f(3.1f, 4.8f, 6.9f, 9.2f, 12.7f, 16.3f),
                erGain = f(0.55f, 0.46f, 0.38f, 0.3f, 0.23f, 0.17f),
                erPan = f(-0.5f, 0.6f, -0.7f, 0.3f, -0.2f, 0.7f),
                erLpHz = 5200f, sendHpHz = 180f, sendLpHz = 6000f,
                diffusion = 0.66f, modDepthMs = 0.18f, modRateHz = 0.5f, fdnScale = 0.7f,
                width = 0.65f, direct = 0.95f, erLevel = 0.9f, tailLevel = 0.6f,
            ),
            // Low concrete ceiling: dense floor/ceiling bounces, bass hangs.
            Character(
                id = "club", rt60 = 0.95f, bassRatio = 1.6f, trebleRatio = 0.5f, crossoverHz = 300f,
                predelayMs = 6f,
                erMs = f(4.0f, 7.5f, 11.2f, 15.0f, 18.6f, 22.4f, 30.1f),
                erGain = f(0.6f, 0.55f, 0.45f, 0.42f, 0.33f, 0.3f, 0.2f),
                erPan = f(0f, -0.5f, 0.5f, 0f, -0.6f, 0.6f, 0f),
                erLpHz = 6000f, sendHpHz = 110f, sendLpHz = 6500f,
                diffusion = 0.62f, modDepthMs = 0.25f, modRateHz = 0.7f, fdnScale = 0.82f,
                width = 0.8f, direct = 0.92f, erLevel = 0.9f, tailLevel = 0.8f,
            ),
            // Small stone chapel: bright, medium tail, clear side walls.
            Character(
                id = "chapel", rt60 = 2.0f, bassRatio = 1.05f, trebleRatio = 0.85f, crossoverHz = 400f,
                predelayMs = 18f,
                erMs = f(8f, 14f, 21f, 27f, 35f, 44f, 52f),
                erGain = f(0.55f, 0.5f, 0.44f, 0.38f, 0.32f, 0.27f, 0.22f),
                erPan = f(-0.7f, 0.7f, -0.4f, 0.5f, -0.8f, 0.8f, 0f),
                erLpHz = 11000f, sendHpHz = 160f, sendLpHz = 10500f,
                diffusion = 0.7f, modDepthMs = 0.25f, modRateHz = 0.4f, fdnScale = 1.05f,
                width = 0.85f, direct = 0.88f, erLevel = 0.8f, tailLevel = 0.95f,
            ),
            // Concert hall: strong lateral reflections, warm, lush bloom.
            Character(
                id = "hall", rt60 = 2.2f, bassRatio = 1.3f, trebleRatio = 0.62f, crossoverHz = 350f,
                predelayMs = 22f,
                erMs = f(11f, 14f, 19f, 24f, 31f, 37f, 45f, 58f, 72f),
                erGain = f(0.6f, 0.58f, 0.5f, 0.46f, 0.4f, 0.34f, 0.3f, 0.24f, 0.18f),
                erPan = f(-0.85f, 0.85f, -0.7f, 0.75f, -0.5f, 0.6f, -0.8f, 0.8f, 0f),
                erLpHz = 8500f, sendHpHz = 120f, sendLpHz = 9000f,
                diffusion = 0.72f, modDepthMs = 0.5f, modRateHz = 0.35f, fdnScale = 1.15f,
                width = 1f, direct = 0.84f, erLevel = 0.85f, tailLevel = 1f,
            ),
            // Opera house: wood and velvet, warm and very wide, drier than a hall.
            Character(
                id = "opera", rt60 = 1.5f, bassRatio = 1.35f, trebleRatio = 0.55f, crossoverHz = 350f,
                predelayMs = 16f,
                erMs = f(9f, 13f, 17f, 23f, 29f, 36f, 44f),
                erGain = f(0.62f, 0.6f, 0.52f, 0.46f, 0.38f, 0.3f, 0.24f),
                erPan = f(-0.9f, 0.9f, -0.8f, 0.8f, -0.6f, 0.6f, 0f),
                erLpHz = 7500f, sendHpHz = 120f, sendLpHz = 8000f,
                diffusion = 0.72f, modDepthMs = 0.45f, modRateHz = 0.3f, fdnScale = 1.0f,
                width = 1f, direct = 0.86f, erLevel = 0.95f, tailLevel = 0.85f,
            ),
            // Indoor arena: roof slap, long dark tail, big distance.
            Character(
                id = "arena", rt60 = 2.8f, bassRatio = 1.25f, trebleRatio = 0.5f, crossoverHz = 350f,
                predelayMs = 30f,
                erMs = f(25f, 38f, 52f, 66f, 81f, 97f),
                erGain = f(0.6f, 0.5f, 0.45f, 0.38f, 0.32f, 0.26f),
                erPan = f(0f, -0.7f, 0.7f, -0.5f, 0.5f, 0f),
                erLpHz = 6000f, sendHpHz = 140f, sendLpHz = 7000f,
                diffusion = 0.62f, modDepthMs = 0.4f, modRateHz = 0.3f, fdnScale = 1.25f,
                width = 1f, direct = 0.8f, erLevel = 0.75f, tailLevel = 1f,
                echoMs = 145f, echoSpreadMs = 18f, echoGain = 0.35f, echoFeedback = 0.18f, echoLpHz = 4500f,
            ),
            // Open-air stadium: thin sky tail, the PA comes back off the far
            // stands as distinct dark slapbacks (left/right stands differ).
            Character(
                id = "stadium", rt60 = 1.9f, bassRatio = 1.2f, trebleRatio = 0.4f, crossoverHz = 300f,
                predelayMs = 12f,
                erMs = f(15f, 28f, 46f),
                erGain = f(0.5f, 0.35f, 0.25f),
                erPan = f(0f, -0.6f, 0.6f),
                erLpHz = 5000f, sendHpHz = 160f, sendLpHz = 5000f,
                diffusion = 0.55f, modDepthMs = 0.3f, modRateHz = 0.25f, fdnScale = 1.3f,
                width = 1f, direct = 0.8f, erLevel = 0.55f, tailLevel = 0.7f,
                echoMs = 260f, echoSpreadMs = 35f, echoGain = 0.6f, echoFeedback = 0.3f, echoLpHz = 3200f,
            ),
            // Cathedral: long gap, sparse stone hits, very long bright wash.
            Character(
                id = "cathedral", rt60 = 5.5f, bassRatio = 1.2f, trebleRatio = 0.7f, crossoverHz = 350f,
                predelayMs = 45f,
                erMs = f(32f, 47f, 61f, 79f, 96f, 118f, 140f),
                erGain = f(0.5f, 0.46f, 0.42f, 0.36f, 0.32f, 0.27f, 0.22f),
                erPan = f(-0.6f, 0.6f, -0.8f, 0.8f, -0.3f, 0.3f, 0f),
                erLpHz = 9000f, sendHpHz = 140f, sendLpHz = 8500f,
                diffusion = 0.75f, modDepthMs = 0.35f, modRateHz = 0.2f, fdnScale = 1.4f,
                width = 1f, direct = 0.8f, erLevel = 0.7f, tailLevel = 1.1f,
            ),
            // Canyon: far rock walls, repeating echoes bouncing side to side.
            Character(
                id = "canyon", rt60 = 2.6f, bassRatio = 1.0f, trebleRatio = 0.45f, crossoverHz = 300f,
                predelayMs = 20f,
                erMs = f(40f, 75f),
                erGain = f(0.35f, 0.25f),
                erPan = f(-0.7f, 0.7f),
                erLpHz = 4500f, sendHpHz = 180f, sendLpHz = 4500f,
                diffusion = 0.5f, modDepthMs = 0.2f, modRateHz = 0.2f, fdnScale = 1.3f,
                width = 1f, direct = 0.86f, erLevel = 0.5f, tailLevel = 0.45f,
                echoMs = 420f, echoSpreadMs = 0f, echoGain = 0.7f, echoFeedback = 0.5f, echoLpHz = 2800f,
                echoPingPong = true,
            ),
        ).associateBy { it.id }
    }
}
