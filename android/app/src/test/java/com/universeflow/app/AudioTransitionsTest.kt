package com.universeflow.app

import androidx.media3.common.C
import androidx.media3.common.audio.AudioProcessor.AudioFormat
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.sin
import org.junit.Assert.*
import org.junit.Test

class AudioTransitionsTest {
    private fun render(processor: StemAudioProcessor, seconds: Double, mono: Boolean = false): ShortArray {
        val frames = (48000 * seconds).toInt()
        val input = ByteBuffer.allocateDirect(frames * if (mono) 2 else 4).order(ByteOrder.nativeOrder())
        for (i in 0 until frames) {
            val sample = (sin(i * 2.0 * Math.PI * 440 / 48000) * 6000).toInt().toShort()
            input.putShort(sample)
            if (!mono) input.putShort(sample)
        }
        input.flip()
        processor.queueInput(input)
        val output = processor.output.order(ByteOrder.nativeOrder())
        return ShortArray(output.remaining() / 2) { output.short }
    }

    private fun configured(): StemAudioProcessor {
        val processor = StemAudioProcessor()
        processor.configure(AudioFormat(48000, 2, C.ENCODING_PCM_16BIT))
        processor.flush()
        return processor
    }

    @Test fun curvesRemainDistinct() {
        assertEquals(0.5f, TransitionEnvelope.gains("linear", 0.5).second, 0.00001f)
        assertEquals(0.7071068f, TransitionEnvelope.gains("equal-power", 0.5).second, 0.00001f)
        assertEquals(0.15625f, TransitionEnvelope.gains("smooth", 0.25).second, 0.00001f)
        assertEquals(0.0625f, TransitionEnvelope.gains("exponential", 0.25).second, 0.00001f)
    }

    @Test fun rotatingPanSurvivesTrackFlush() {
        val processor = configured()
        processor.setEnhancements(1000, 0, 0, 0)
        val samples = render(processor, 2.0)
        val offset = samples.size - 4000
        val left = (offset until samples.size step 2).sumOf { kotlin.math.abs(samples[it].toInt()).toLong() }
        val right = (offset + 1 until samples.size step 2).sumOf { kotlin.math.abs(samples[it].toInt()).toLong() }
        assertTrue("8D must move signal between ears", right > left * 2)
        processor.equalizer.setEnabled(true)
        processor.equalizer.setBandMillibels(5, 600)
        processor.flush()
        assertEquals(600, processor.equalizer.getBandMillibels(5))
        assertTrue(processor.equalizer.isEnabled())
        val next = render(processor, 0.1)
        assertTrue("rotation must remain enabled after track flush", next.indices.step(2).any { next[it] != next[it + 1] })
    }

    @Test fun headphoneCrossfeedIsIndependentOfRotation() {
        val processor = configured()
        processor.setEnhancements(0, 1000, 0, 0)
        val input = ByteBuffer.allocateDirect(48000 * 4).order(ByteOrder.nativeOrder())
        repeat(48000) { input.putShort(6000); input.putShort(0) }
        input.flip()
        processor.queueInput(input)
        val output = processor.output.order(ByteOrder.nativeOrder())
        var rightEnergy = 0L
        while (output.remaining() >= 4) { output.short; rightEnergy += kotlin.math.abs(output.short.toInt()) }
        assertTrue("left-only signal must reach the opposite ear", rightEnergy > 1000000)
    }

    @Test fun monoStreamsStillHaveSpatialOutput() {
        val processor = StemAudioProcessor()
        val output = processor.configure(AudioFormat(48000, 1, C.ENCODING_PCM_16BIT))
        assertEquals(2, output.channelCount)
        processor.flush()
        processor.setEnhancements(1000, 0, 0, 0)
        assertEquals(9600, render(processor, 0.1, true).size)
    }
}