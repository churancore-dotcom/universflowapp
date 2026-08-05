package com.universeflow.app

import androidx.media3.common.C
import androidx.media3.common.audio.AudioProcessor.AudioFormat
import androidx.media3.common.audio.BaseAudioProcessor
import androidx.media3.common.util.UnstableApi
import java.nio.ByteBuffer
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

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

    fun setStemMix(vocalPercent: Int, instrumentalPercent: Int) {
        targetVocalMix = vocalPercent.coerceIn(0, 100) / 100f
        targetInstrumentalMix = instrumentalPercent.coerceIn(0, 100) / 100f
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
        smoothingCoeff = 1f - kotlin.math.exp((-1f / (inputAudioFormat.sampleRate * 0.025f)).toDouble()).toFloat()
        lowState = 0f
        return inputAudioFormat
    }

    override fun onFlush() {
        lowState = 0f
    }

    override fun queueInput(inputBuffer: ByteBuffer) {
        val position = inputBuffer.position()
        val limit = inputBuffer.limit()
        val bytesPerFrame = inputAudioFormat.bytesPerFrame
        val output = replaceOutputBuffer(limit - position)
        var cursor = position
        while (cursor + bytesPerFrame <= limit) {
            currentVocalMix += smoothingCoeff * (targetVocalMix - currentVocalMix)
            currentInstrumentalMix += smoothingCoeff * (targetInstrumentalMix - currentInstrumentalMix)
            val vocal = currentVocalMix.coerceIn(0f, 1f)
            val instrument = currentInstrumentalMix.coerceIn(0f, 1f)
            val neutral = vocal >= 0.9995f && instrument >= 0.9995f
            val power = sqrt(((vocal * vocal + instrument * instrument) / 2f).toDouble()).toFloat()
            val makeup = if (power > 0.04f) min(1.6f, max(1f, 1f / power)) else 1f
            val left = inputBuffer.getShort(cursor).toInt()
            val right = inputBuffer.getShort(cursor + 2).toInt()

            if (neutral) {
                lowState += lowCoeff * ((left + right) * 0.5f - lowState)
                output.putShort(left.toShort())
                output.putShort(right.toShort())
            } else {
                val mid = (left + right) * 0.5f
                val side = (left - right) * 0.5f
                // Split mid: low end is part of the instrument bed, the rest is
                // the lead vocal band. Keeps karaoke punchy, makes a-cappella
                // actually strip the beat instead of just narrowing the stereo.
                lowState += lowCoeff * (mid - lowState)
                val midLow = lowState
                val midBand = mid - lowState
                val centre = midLow * instrument + midBand * vocal
                val stereo = side * instrument
                output.putShort(clip16((centre + stereo) * makeup))
                output.putShort(clip16((centre - stereo) * makeup))
            }

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
}