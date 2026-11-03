package com.universeflow.app

import androidx.media3.common.C
import androidx.media3.common.audio.AudioProcessor.AudioFormat
import androidx.media3.common.audio.BaseAudioProcessor
import androidx.media3.common.util.UnstableApi
import java.nio.ByteBuffer
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt
import kotlin.math.sin

/**
 * Real-time native Mid/Side stem processor for the APK ExoPlayer path.
 *
 * WebAudio can do karaoke/a-cappella with gain nodes, but Android users hear
 * ExoPlayer directly. This processor sits inside Media3's PCM pipeline, so the
 * Vocal / Instrument sliders affect the actual lock-screen/background audio.
 */
@OptIn(UnstableApi::class)
class StemAudioProcessor : BaseAudioProcessor() {
    @Volatile private var targetVocalMix = 1f
    @Volatile private var targetInstrumentalMix = 1f
    @Volatile private var targetShine = 0f
    @Volatile private var targetWidth = 1f
    private var currentVocalMix = 1f
    private var currentInstrumentalMix = 1f
    private var currentShine = 0f
    private var currentWidth = 1f
    private var smoothingCoeff = 0.002f

    // One-pole low-pass state used to split the mid channel into
    // low (kick/bass -> instrument bed) and band (lead vocal) content.
    private var lowState = 0f
    private var lowCoeff = 0.05f
    // Second one-pole at 9 kHz: mid content above it is air/cymbals, i.e.
    // instrument bed, not lead vocal. Without this split karaoke also erased
    // the top end and sounded hollow.
    private var highState = 0f
    private var highCoeff = 0.5f
    @Volatile private var targetSpatialDepth = 0f
    @Volatile private var targetSurround = 0f
    @Volatile private var targetLateNight = 0f
    private var currentSpatialDepth = 0f
    private var currentSurround = 0f
    private var currentLateNight = 0f
    private var spatialPhase = 0.0
    private var spatialPhaseStep = 0.0
    private var crossfeedLeft = FloatArray(16)
    private var crossfeedRight = FloatArray(16)
    private var crossfeedCursor = 0
    private var crossfeedLowLeft = 0f
    private var crossfeedLowRight = 0f
    private var crossfeedCoeff = 0.1f
    // 9D orbit: its own slow phase (independent of 8D) plus a head-shadow
    // lowpass that closes as the source travels behind the listener.
    private var ninePhase = 0.0
    private var ninePhaseStep = 0.0
    private var nineShadowLeft = 0f
    private var nineShadowRight = 0f
    private var nineShadowCoeff = 0.5f

    /** Real room reverb (pre-delay + comb/allpass network) — see RoomReverb. */
    val reverb = RoomReverb()
    private val reverbScratch = FloatArray(2)


    /** Device-independent 10-band EQ; replaces the vendor AudioFX equalizer. */
    val equalizer = PcmEqualizer()
    private var blockCounter = 0
    private var eqActive = false
    private var eqHeadroom = 1f

    fun setStemMix(vocalPercent: Int, instrumentalPercent: Int, shinePercent: Int = 0, widthPercent: Int = 50) {
        targetVocalMix = vocalPercent.coerceIn(0, 140) / 100f
        targetInstrumentalMix = instrumentalPercent.coerceIn(0, 140) / 100f
        targetShine = shinePercent.coerceIn(0, 100) / 100f
        targetWidth = widthPercent.coerceIn(0, 100) / 50f
    }

    fun setEnhancements(spatialStrength: Int, surroundStrength: Int, lateNightGainMb: Int, reverbAmount: Int) {
        targetSpatialDepth = spatialStrength.coerceIn(0, 1000) / 1000f
        targetSurround = surroundStrength.coerceIn(0, 1000) / 1000f
        targetLateNight = lateNightGainMb.coerceIn(0, 2000) / 2000f
        // Plain reverb slider with no Studio Space: a modest small-room voicing.
        reverb.setSpace(
            roomPercent = 45 + reverbAmount / 3,
            dampPercent = 45,
            wetPercent = reverbAmount,
            widthPercent = 80,
            preDelayMs = 14,
            sizePercent = 100,
        )
    }

    /** Studio Space voicing pushed down from the app (Hall, Cathedral, ...). */
    fun setSpace(room: Int, damping: Int, wet: Int, width: Int, preDelayMs: Int, size: Int) {
        reverb.setSpace(room, damping, wet, width, preDelayMs, size)
    }

    override fun onConfigure(inputAudioFormat: AudioFormat): AudioFormat {
        // Keep the processor active for stereo PCM even when neutral. That lets
        // slider changes take effect on the next audio buffer without rebuilding
        // or flushing ExoPlayer.
        if (inputAudioFormat.encoding != C.ENCODING_PCM_16BIT || inputAudioFormat.channelCount !in 1..2) {
            return AudioFormat.NOT_SET
        }
        // Mono streams still need stereo output for rotating pan and crossfeed.
        crossfeedLeft = FloatArray(max(1, (inputAudioFormat.sampleRate * 0.0003).toInt()))
        crossfeedRight = FloatArray(crossfeedLeft.size)
        val crossfeedDt = 1f / inputAudioFormat.sampleRate
        crossfeedCoeff = crossfeedDt / (1f / (2f * Math.PI.toFloat() * 700f) + crossfeedDt)
        // 180 Hz one-pole cutoff for the current sample rate.
        val rc = 1f / (2f * Math.PI.toFloat() * 180f)
        val dt = 1f / inputAudioFormat.sampleRate.toFloat()
        lowCoeff = dt / (rc + dt)
        val rcHigh = 1f / (2f * Math.PI.toFloat() * 9000f)
        highCoeff = dt / (rcHigh + dt)
        smoothingCoeff = 1f - kotlin.math.exp((-1f / (inputAudioFormat.sampleRate * 0.025f)).toDouble()).toFloat()
        spatialPhaseStep = 2.0 * Math.PI * 0.12 / inputAudioFormat.sampleRate.toDouble()
        ninePhaseStep = 2.0 * Math.PI * 0.07 / inputAudioFormat.sampleRate.toDouble()
        val rcShadow = 1f / (2f * Math.PI.toFloat() * 5500f)
        nineShadowCoeff = dt / (rcShadow + dt)
        reverb.configure(inputAudioFormat.sampleRate)
        limiterRelease = 1f - kotlin.math.exp((-1f / (inputAudioFormat.sampleRate * 0.12f)).toDouble()).toFloat()
        limiterGain = 1f
        limiterHeld = 1f
        limiterHoldLeft = 0
        // ~1.5 ms look-ahead; attack reaches ~98% of the needed reduction
        // within that window so peaks are caught before they are output.
        lookaheadLen = max(16, (inputAudioFormat.sampleRate * 0.0015f).toInt())
        lookaheadL = FloatArray(lookaheadLen)
        lookaheadR = FloatArray(lookaheadLen)
        lookaheadCursor = 0
        limiterAttack = 1f - kotlin.math.exp((-4.0 / lookaheadLen)).toFloat()
        lowState = 0f
        highState = 0f
        equalizer.configure(inputAudioFormat.sampleRate)
        eqActive = equalizer.tickBlock()
        eqHeadroom = equalizer.headroomGain()
        blockCounter = 0
        return AudioFormat(inputAudioFormat.sampleRate, 2, C.ENCODING_PCM_16BIT)
    }

    override fun onFlush() {
        lowState = 0f
        highState = 0f
        equalizer.reset()
        reverb.reset()
        crossfeedLeft.fill(0f)
        crossfeedRight.fill(0f)
        crossfeedCursor = 0
        crossfeedLowLeft = 0f
        crossfeedLowRight = 0f
        nineShadowLeft = 0f
        nineShadowRight = 0f
        lookaheadL.fill(0f)
        lookaheadR.fill(0f)
        lookaheadCursor = 0
        limiterGain = 1f
        limiterHeld = 1f
        limiterHoldLeft = 0
    }


    override fun queueInput(inputBuffer: ByteBuffer) {
        val position = inputBuffer.position()
        val limit = inputBuffer.limit()
        val bytesPerFrame = inputAudioFormat.bytesPerFrame
        val output = replaceOutputBuffer((limit - position) / bytesPerFrame * 4)
        var cursor = position
        while (cursor + bytesPerFrame <= limit) {
            // Smooth EQ gains once per 64-frame block: cheap, and slider drags
            // become sweeps instead of coefficient jumps.
            if (blockCounter <= 0) {
                eqActive = equalizer.tickBlock()
                eqHeadroom = equalizer.headroomGain()
                reverb.tickBlock()
                blockCounter = 64
            }
            blockCounter--
            currentVocalMix += smoothingCoeff * (targetVocalMix - currentVocalMix)
            currentInstrumentalMix += smoothingCoeff * (targetInstrumentalMix - currentInstrumentalMix)
            currentShine += smoothingCoeff * (targetShine - currentShine)
            currentWidth += smoothingCoeff * (targetWidth - currentWidth)
            currentSpatialDepth += smoothingCoeff * (targetSpatialDepth - currentSpatialDepth)
            currentSurround += smoothingCoeff * (targetSurround - currentSurround)
            currentLateNight += smoothingCoeff * (targetLateNight - currentLateNight)

            val vocal = currentVocalMix.coerceIn(0f, 1.4f)
            val instrument = currentInstrumentalMix.coerceIn(0f, 1.4f)
            val power = sqrt(((vocal * vocal + instrument * instrument) / 2f).toDouble()).toFloat()
            val makeup = if (power > 0.04f) min(1.6f, max(1f, 1f / power)) else 1f
            val left = inputBuffer.getShort(cursor).toInt()
            val right = if (inputAudioFormat.channelCount == 1) left else inputBuffer.getShort(cursor + 2).toInt()

            // Always use one continuous signal path. Switching between a raw
            // passthrough branch and this matrix at 100% caused a buffer-edge
            // discontinuity (click/stall) while a stem slider was moving.
            val mid = (left + right) * 0.5f
            val side = (left - right) * 0.5f
            lowState += lowCoeff * (mid - lowState)
            highState += highCoeff * (mid - highState)
            val midLow = lowState
            val midHigh = mid - highState
            val midBand = mid - lowState - midHigh
            val centre = (midLow + midHigh) * instrument + midBand * vocal * (1f + currentShine * 0.35f)
            val widenedSide = side * instrument * currentWidth.coerceIn(0f, 2f)
            val pan = sin(spatialPhase).toFloat() * currentSpatialDepth * 0.82f
            spatialPhase += spatialPhaseStep
            if (spatialPhase >= 2.0 * Math.PI) spatialPhase -= 2.0 * Math.PI
            val leftPan = sqrt(((1f - pan) * 0.5f).toDouble()).toFloat() * 1.4142135f
            val rightPan = sqrt(((1f + pan) * 0.5f).toDouble()).toFloat() * 1.4142135f
            val lateMakeup = 1f + currentLateNight * 0.4f
            var rawLeft = (centre + widenedSide) * makeup * leftPan * lateMakeup
            var rawRight = (centre - widenedSide) * makeup * rightPan * lateMakeup
            if (eqActive) {
                rawLeft = equalizer.process(0, rawLeft * eqHeadroom)
                rawRight = equalizer.process(1, rawRight * eqHeadroom)
            }
            if (reverb.isActive) {
                reverb.process(rawLeft, rawRight, reverbScratch)
                rawLeft = reverbScratch[0]
                rawRight = reverbScratch[1]
            }

            // Low-passed opposite-ear sound delayed by 0.3ms: headphone
            // crossfeed is a separate static cue, never an alias for 8D pan.
            crossfeedLowLeft += crossfeedCoeff * (rawLeft - crossfeedLowLeft)
            crossfeedLowRight += crossfeedCoeff * (rawRight - crossfeedLowRight)
            val delayedLeft = crossfeedLeft[crossfeedCursor]
            val delayedRight = crossfeedRight[crossfeedCursor]
            crossfeedLeft[crossfeedCursor] = crossfeedLowLeft
            crossfeedRight[crossfeedCursor] = crossfeedLowRight
            crossfeedCursor = (crossfeedCursor + 1) % crossfeedLeft.size
            val crossfeed = currentSurround * 0.4f
            rawLeft = (rawLeft + delayedRight * crossfeed) / (1f + crossfeed)
            rawRight = (rawRight + delayedLeft * crossfeed) / (1f + crossfeed)

            // 9D orbit: equal-power pan around the head; when "behind"
            // (cos < 0) blend in the head-shadow lowpass for a rear cue.
            if (currentSurround > 0.001f) {
                val orbitPan = sin(ninePhase).toFloat() * currentSurround * 0.75f
                val behind = ((1f - kotlin.math.cos(ninePhase).toFloat()) * 0.5f) * currentSurround * 0.7f
                ninePhase += ninePhaseStep
                if (ninePhase >= 2.0 * Math.PI) ninePhase -= 2.0 * Math.PI
                val gl = sqrt(((1f - orbitPan) * 0.5f).toDouble()).toFloat() * 1.4142135f
                val gr = sqrt(((1f + orbitPan) * 0.5f).toDouble()).toFloat() * 1.4142135f
                rawLeft *= gl
                rawRight *= gr
                nineShadowLeft += nineShadowCoeff * (rawLeft - nineShadowLeft)
                nineShadowRight += nineShadowCoeff * (rawRight - nineShadowRight)
                rawLeft += (nineShadowLeft - rawLeft) * behind
                rawRight += (nineShadowRight - rawRight) * behind
            } else {
                nineShadowLeft = rawLeft
                nineShadowRight = rawRight
            }

            // Look-ahead stereo-linked limiter. The previous limiter slammed
            // the gain down on the exact sample that peaked, which is an
            // audible click/crunch on every loud hit once a room adds level.
            // Here the gain glides down over ~1.5 ms BEFORE the peak reaches
            // the output (the signal is delayed by the same amount), so loud
            // drums and room swells stay clean instead of distorting.
            val peak = max(kotlin.math.abs(rawLeft), kotlin.math.abs(rawRight))
            val needed = if (peak > LIMIT_CEILING) LIMIT_CEILING / peak else 1f
            if (needed <= limiterHeld) {
                limiterHeld = needed
                limiterHoldLeft = lookaheadLen
            } else if (limiterHoldLeft > 0) {
                limiterHoldLeft--
            } else {
                limiterHeld += limiterRelease * (1f - limiterHeld)
            }
            limiterGain += (if (limiterHeld < limiterGain) limiterAttack else limiterRelease) * (limiterHeld - limiterGain)
            val outL = lookaheadL[lookaheadCursor]
            val outR = lookaheadR[lookaheadCursor]
            lookaheadL[lookaheadCursor] = rawLeft
            lookaheadR[lookaheadCursor] = rawRight
            if (++lookaheadCursor >= lookaheadLen) lookaheadCursor = 0
            output.putShort(toPcm16(outL * limiterGain))
            output.putShort(toPcm16(outR * limiterGain))

            cursor += bytesPerFrame
        }

        inputBuffer.position(limit)
        output.flip()
    }

    /**
     * Float -> 16-bit with rounding and light TPDF dither. Plain truncation
     * toward zero turned quiet room tails and fade-outs into a gritty,
     * noisy buzz; dither keeps them smooth all the way down to silence.
     */
    private fun toPcm16(value: Float): Short {
        ditherSeed = ditherSeed xor (ditherSeed shl 13)
        ditherSeed = ditherSeed xor (ditherSeed ushr 17)
        ditherSeed = ditherSeed xor (ditherSeed shl 5)
        val r1 = (ditherSeed and 0xFFFF) / 65536f
        val r2 = ((ditherSeed ushr 16) and 0xFFFF) / 65536f
        val dithered = value + (r1 - r2)
        return kotlin.math.round(dithered).toInt()
            .coerceIn(Short.MIN_VALUE.toInt(), Short.MAX_VALUE.toInt()).toShort()
    }

    private var ditherSeed = 0x2545F491
    private var limiterGain = 1f
    private var limiterHeld = 1f
    private var limiterHoldLeft = 0
    private var limiterAttack = 0.05f
    private var limiterRelease = 0.0003f
    private var lookaheadLen = 64
    private var lookaheadL = FloatArray(64)
    private var lookaheadR = FloatArray(64)
    private var lookaheadCursor = 0
    // Small safety margin: the look-ahead glide can land a hair late.
    private val LIMIT_CEILING = 31500f

    @Suppress("unused")
    private fun softLimit(value: Float, amount: Float): Float {
        // Always-on smooth ceiling: neutral audio below ~-3.5 dBFS is untouched,
        // overshoot from EQ/stems/width bends toward full scale instead of hard-clipping.
        val threshold = 22000f - amount * 6000f
        val magnitude = kotlin.math.abs(value)
        if (magnitude <= threshold) return value
        val headroom = 32000f - threshold
        val over = magnitude - threshold
        val compressed = threshold + headroom * (over / (over + headroom))
        return if (value < 0f) -compressed else compressed
    }
}