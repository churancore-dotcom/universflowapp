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
    private var currentVocalMix = 1f
    private var currentInstrumentalMix = 1f
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
    @Volatile private var targetReverb = 0f
    private var currentSpatialDepth = 0f
    private var currentSurround = 0f
    private var currentLateNight = 0f
    private var currentReverb = 0f
    private var spatialPhase = 0.0
    private var spatialPhaseStep = 0.0
    private var reverbLeft = FloatArray(1)
    private var reverbRight = FloatArray(1)
    private var reverbCursor = 0

    /** Device-independent 10-band EQ; replaces the vendor AudioFX equalizer. */
    val equalizer = PcmEqualizer()
    private var blockCounter = 0
    private var eqActive = false
    private var eqHeadroom = 1f

    fun setStemMix(vocalPercent: Int, instrumentalPercent: Int) {
        targetVocalMix = vocalPercent.coerceIn(0, 100) / 100f
        targetInstrumentalMix = instrumentalPercent.coerceIn(0, 100) / 100f
    }

    fun setEnhancements(spatialStrength: Int, surroundStrength: Int, lateNightGainMb: Int, reverbAmount: Int) {
        targetSpatialDepth = spatialStrength.coerceIn(0, 1000) / 1000f
        targetSurround = surroundStrength.coerceIn(0, 1000) / 1000f
        targetLateNight = lateNightGainMb.coerceIn(0, 2000) / 2000f
        targetReverb = reverbAmount.coerceIn(0, 100) / 100f
    }

    override fun onConfigure(inputAudioFormat: AudioFormat): AudioFormat {
        // Keep the processor active for stereo PCM even when neutral. That lets
        // slider changes take effect on the next audio buffer without rebuilding
        // or flushing ExoPlayer.
        if (inputAudioFormat.encoding != C.ENCODING_PCM_16BIT || inputAudioFormat.channelCount < 2) {
            return AudioFormat.NOT_SET
        }
        // 180 Hz one-pole cutoff for the current sample rate.
        val rc = 1f / (2f * Math.PI.toFloat() * 180f)
        val dt = 1f / inputAudioFormat.sampleRate.toFloat()
        lowCoeff = dt / (rc + dt)
        val rcHigh = 1f / (2f * Math.PI.toFloat() * 9000f)
        highCoeff = dt / (rcHigh + dt)
        smoothingCoeff = 1f - kotlin.math.exp((-1f / (inputAudioFormat.sampleRate * 0.025f)).toDouble()).toFloat()
        spatialPhaseStep = 2.0 * Math.PI * 0.12 / inputAudioFormat.sampleRate.toDouble()
        // A cross-fed 89ms delay gives Spaces a real, device-independent room
        // tail instead of relying on optional vendor EnvironmentalReverb.
        reverbLeft = FloatArray(max(1, (inputAudioFormat.sampleRate * 0.089f).toInt()))
        reverbRight = FloatArray(reverbLeft.size)
        reverbCursor = 0
        lowState = 0f
        highState = 0f
        equalizer.configure(inputAudioFormat.sampleRate)
        eqActive = equalizer.tickBlock()
        eqHeadroom = equalizer.headroomGain()
        blockCounter = 0
        return inputAudioFormat
    }

    override fun onFlush() {
        lowState = 0f
        highState = 0f
        equalizer.reset()
        java.util.Arrays.fill(reverbLeft, 0f)
        java.util.Arrays.fill(reverbRight, 0f)
        reverbCursor = 0
    }

    override fun queueInput(inputBuffer: ByteBuffer) {
        val position = inputBuffer.position()
        val limit = inputBuffer.limit()
        val bytesPerFrame = inputAudioFormat.bytesPerFrame
        val output = replaceOutputBuffer(limit - position)
        var cursor = position
        while (cursor + bytesPerFrame <= limit) {
            // Smooth EQ gains once per 64-frame block: cheap, and slider drags
            // become sweeps instead of coefficient jumps.
            if (blockCounter <= 0) {
                eqActive = equalizer.tickBlock()
                eqHeadroom = equalizer.headroomGain()
                blockCounter = 64
            }
            blockCounter--
            currentVocalMix += smoothingCoeff * (targetVocalMix - currentVocalMix)
            currentInstrumentalMix += smoothingCoeff * (targetInstrumentalMix - currentInstrumentalMix)
            currentSpatialDepth += smoothingCoeff * (targetSpatialDepth - currentSpatialDepth)
            currentSurround += smoothingCoeff * (targetSurround - currentSurround)
            currentLateNight += smoothingCoeff * (targetLateNight - currentLateNight)
            currentReverb += smoothingCoeff * (targetReverb - currentReverb)
            val vocal = currentVocalMix.coerceIn(0f, 1f)
            val instrument = currentInstrumentalMix.coerceIn(0f, 1f)
            val power = sqrt(((vocal * vocal + instrument * instrument) / 2f).toDouble()).toFloat()
            val makeup = if (power > 0.04f) min(1.6f, max(1f, 1f / power)) else 1f
            val left = inputBuffer.getShort(cursor).toInt()
            val right = inputBuffer.getShort(cursor + 2).toInt()

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
            val centre = (midLow + midHigh) * instrument + midBand * vocal
            val widenedSide = side * instrument * (1f + currentSurround * 0.85f)
            val pan = sin(spatialPhase).toFloat() * currentSpatialDepth * 0.82f
            spatialPhase += spatialPhaseStep
            if (spatialPhase >= 2.0 * Math.PI) spatialPhase -= 2.0 * Math.PI
            val leftPan = sqrt(((1f - pan) * 0.5f).toDouble()).toFloat() * 1.4142135f
            val rightPan = sqrt(((1f + pan) * 0.5f).toDouble()).toFloat() * 1.4142135f
            val lateMakeup = 1f + currentLateNight * 0.65f
            var rawLeft = (centre + widenedSide) * makeup * leftPan * lateMakeup
            var rawRight = (centre - widenedSide) * makeup * rightPan * lateMakeup
            if (eqActive) {
                rawLeft = equalizer.process(0, rawLeft * eqHeadroom)
                rawRight = equalizer.process(1, rawRight * eqHeadroom)
            }
            if (currentReverb > 0.001f) {
                val delayedLeft = reverbLeft[reverbCursor]
                val delayedRight = reverbRight[reverbCursor]
                val feedback = 0.18f + currentReverb * 0.48f
                reverbLeft[reverbCursor] = rawLeft + delayedRight * feedback
                reverbRight[reverbCursor] = rawRight + delayedLeft * feedback
                val wet = currentReverb * 0.38f
                rawLeft = rawLeft * (1f - wet * 0.35f) + delayedLeft * wet
                rawRight = rawRight * (1f - wet * 0.35f) + delayedRight * wet
                reverbCursor++
                if (reverbCursor >= reverbLeft.size) reverbCursor = 0
            }
            output.putShort(clip16(softLimit(rawLeft, currentLateNight)))
            output.putShort(clip16(softLimit(rawRight, currentLateNight)))

            // Preserve extra channels, if any, instead of dropping them.
            var extra = 4
            while (extra < bytesPerFrame) {
                output.putShort(inputBuffer.getShort(cursor + extra))
                extra += 2
            }
            cursor += bytesPerFrame
        }

        inputBuffer.position(limit)
        output.flip()
    }

    private fun clip16(value: Float): Short {
        return value.toInt().coerceIn(Short.MIN_VALUE.toInt(), Short.MAX_VALUE.toInt()).toShort()
    }

    private fun softLimit(value: Float, amount: Float): Float {
        if (amount <= 0.001f) return value
        val threshold = 22000f - amount * 6000f
        val magnitude = kotlin.math.abs(value)
        if (magnitude <= threshold) return value
        val compressed = threshold + (magnitude - threshold) / (1f + amount * 5f)
        return if (value < 0f) -compressed else compressed
    }
}