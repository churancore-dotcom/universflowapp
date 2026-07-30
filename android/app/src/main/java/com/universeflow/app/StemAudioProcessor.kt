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
    @Volatile private var vocalMix = 1f
    @Volatile private var instrumentalMix = 1f

    fun setStemMix(vocalPercent: Int, instrumentalPercent: Int) {
        vocalMix = vocalPercent.coerceIn(0, 100) / 100f
        instrumentalMix = instrumentalPercent.coerceIn(0, 100) / 100f
    }

    override fun onConfigure(inputAudioFormat: AudioFormat): AudioFormat {
        // Keep the processor active for stereo PCM even when neutral. That lets
        // slider changes take effect on the next audio buffer without rebuilding
        // or flushing ExoPlayer.
        if (inputAudioFormat.encoding != C.ENCODING_PCM_16BIT || inputAudioFormat.channelCount < 2) {
            return AudioFormat.NOT_SET
        }
        return inputAudioFormat
    }

    override fun queueInput(inputBuffer: ByteBuffer) {
        val position = inputBuffer.position()
        val limit = inputBuffer.limit()
        val bytesPerFrame = inputAudioFormat.bytesPerFrame
        val output = replaceOutputBuffer(limit - position)
        val midAmount = vocalMix.coerceIn(0f, 1f)
        val sideAmount = instrumentalMix.coerceIn(0f, 1f)
        val neutral = midAmount >= 0.995f && sideAmount >= 0.995f
        val power = sqrt(((midAmount * midAmount + sideAmount * sideAmount) / 2f).toDouble()).toFloat()
        val makeup = if (power > 0.04f) min(1.75f, max(1f, 0.95f / power)) else 1f

        var cursor = position
        while (cursor + bytesPerFrame <= limit) {
            val left = inputBuffer.getShort(cursor).toInt()
            val right = inputBuffer.getShort(cursor + 2).toInt()

            if (neutral) {
                output.putShort(left.toShort())
                output.putShort(right.toShort())
            } else {
                val mid = (left + right) * 0.5f
                val side = (left - right) * 0.5f
                val outLeft = (mid * midAmount + side * sideAmount) * makeup
                val outRight = (mid * midAmount - side * sideAmount) * makeup
                output.putShort(clip16(outLeft))
                output.putShort(clip16(outRight))
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