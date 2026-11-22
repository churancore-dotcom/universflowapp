package com.universeflow.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.log10
import kotlin.math.sin
import kotlin.math.sqrt

class BinauralOrbitTest {
    private val fs = 48000

    private fun engine(az: Double? = null, el: Double = 0.0) = BinauralOrbit().apply {
        configure(fs)
        if (az != null) fixPosition(az, el)
    }

    /** Left/right RMS of a band of noise-like partials (skips a settle period). */
    private fun bandRms(e: BinauralOrbit, lo: Double, hi: Double, seconds: Double = 0.5): Pair<Double, Double> {
        val partials = 24
        val freqs = DoubleArray(partials) { lo + (hi - lo) * it / (partials - 1) }
        val phases = DoubleArray(partials) { (it * 2.399963) % (2 * PI) }
        val out = FloatArray(2)
        var l = 0.0; var r = 0.0; var n = 0
        val total = (fs * seconds).toInt()
        for (i in 0 until total) {
            var x = 0.0
            for (k in 0 until partials) x += sin(2 * PI * freqs[k] * i / fs + phases[k])
            val v = (x * 1500).toFloat()
            e.process(v, v, 1f, out)
            if (i > fs / 10) { l += out[0] * out[0].toDouble(); r += out[1] * out[1].toDouble(); n++ }
        }
        return sqrt(l / n) to sqrt(r / n)
    }

    private fun db(a: Double, b: Double) = 20 * log10(a / b)

    @Test fun depthZeroIsTheUntouchedSong() {
        val e = engine()
        val out = FloatArray(2)
        var seed = 7
        repeat(20000) {
            seed = seed * 1103515245 + 12345
            val l = ((seed shr 8) % 20000).toFloat()
            val r = ((seed shr 4) % 20000).toFloat()
            e.process(l, r, 0f, out)
            assertEquals(l, out[0], 0.05f)
            assertEquals(r, out[1], 0.05f)
        }
    }

    @Test fun sourceOnTheRightIsLouderAndBrighterInTheRightEar() {
        val (hiL, hiR) = bandRms(engine(PI / 2), 3000.0, 6000.0)
        val (loL, loR) = bandRms(engine(PI / 2), 300.0, 600.0)
        assertTrue("treble ILD ${db(hiR, hiL)}", db(hiR, hiL) > 8)
        // Head shadow is frequency dependent: low mids wrap round the head.
        assertTrue("low ILD ${db(loR, loL)}", db(loR, loL) < db(hiR, hiL) - 4)
    }

    @Test fun farEarHearsTheSoundLater() {
        val e = engine(PI / 2)
        val out = FloatArray(2)
        var peakL = 0; var peakR = 0; var maxL = 0f; var maxR = 0f
        for (i in 0 until 400) {
            val x = if (i == 100) 20000f else 0f
            e.process(x, x, 1f, out)
            if (abs(out[0]) > maxL) { maxL = abs(out[0]); peakL = i }
            if (abs(out[1]) > maxR) { maxR = abs(out[1]); peakR = i }
        }
        val lagMs = (peakL - peakR) * 1000.0 / fs
        assertTrue("ITD $lagMs ms", lagMs in 0.3..0.75)
    }

    @Test fun behindTheHeadSoundsDarkerThanInFront() {
        val (fl, fr) = bandRms(engine(0.0), 3000.0, 12000.0)
        val (bl, br) = bandRms(engine(PI), 3000.0, 12000.0)
        assertTrue("front/back ${db(fl + fr, bl + br)}", db(fl + fr, bl + br) > 4)
        // And front stays centred: both ears match.
        assertTrue("front balance ${db(fl, fr)}", abs(db(fl, fr)) < 1)
    }

    @Test fun bassStaysCentredWhileTheOrbitMoves() {
        val (l, r) = bandRms(engine(PI / 2), 40.0, 90.0, 1.0)
        assertTrue("bass balance ${db(l, r)}", abs(db(l, r)) < 1.5)
    }

    @Test fun fullOrbitKeepsTheSongLoudness() {
        val e = engine()
        val out = FloatArray(2)
        var seed = 99
        var lp = 0.0
        var inPow = 0.0; var outPow = 0.0
        var worstWindowDb = 0.0
        var wIn = 0.0; var wOut = 0.0; var w = 0
        val total = (fs / BinauralOrbit.ORBIT_HZ).toInt()
        for (i in 0 until total) {
            seed = seed * 1103515245 + 12345
            val white = ((seed shr 9) % 10000).toDouble()
            lp += 0.15 * (white - lp) // music-like tilt: more lows than highs
            val x = lp.toFloat()
            e.process(x, x, 1f, out)
            if (i < fs) continue
            inPow += 2 * x * x.toDouble(); outPow += out[0] * out[0].toDouble() + out[1] * out[1].toDouble()
            wIn += 2 * x * x.toDouble(); wOut += out[0] * out[0].toDouble() + out[1] * out[1].toDouble()
            if (++w == fs / 4) {
                worstWindowDb = maxOf(worstWindowDb, abs(10 * log10(wOut / wIn)))
                wIn = 0.0; wOut = 0.0; w = 0
            }
        }
        val overall = 10 * log10(outPow / inPow)
        assertTrue("overall $overall dB", abs(overall) < 1.5)
        assertTrue("pumping $worstWindowDb dB", worstWindowDb < 3)
    }

    @Test fun aboveTheHeadNarrowsTheEarDifference() {
        val (l0, r0) = bandRms(engine(PI / 2, 0.0), 3000.0, 6000.0)
        val (l1, r1) = bandRms(engine(PI / 2, 0.6), 3000.0, 6000.0)
        assertTrue(db(r1, l1) < db(r0, l0))
    }
}
