package com.universeflow.app

import android.content.res.AssetManager
import kotlin.math.min

/**
 * Real measured room impulse responses (OpenAIR, University of York, CC BY 4.0)
 * bundled in assets/rooms/<spaceId>.wav as 48 kHz 16-bit stereo, direct sound
 * removed. Spaces without a recording fall back to the synthesized room.
 */
object RecordedRooms {
    @Volatile var assets: AssetManager? = null

    fun load(id: String, sr: Int): Pair<FloatArray, FloatArray>? {
        val am = assets ?: return null
        val bytes = try { am.open("rooms/$id.wav").use { it.readBytes() } } catch (_: Throwable) { return null }
        return decode(bytes, sr)
    }

    /** Parses a PCM16 stereo WAV and linearly resamples it to [sr]. */
    internal fun decode(b: ByteArray, sr: Int): Pair<FloatArray, FloatArray>? {
        fun u16(o: Int) = (b[o].toInt() and 0xff) or ((b[o + 1].toInt() and 0xff) shl 8)
        fun u32(o: Int) = u16(o) or (u16(o + 2) shl 16)
        if (b.size < 44) return null
        var p = 12; var ch = 0; var rate = 0; var bits = 0; var dataOff = -1; var dataLen = 0
        while (p + 8 <= b.size) {
            val tag = String(b, p, 4, Charsets.US_ASCII); val len = u32(p + 4)
            if (tag == "fmt ") { ch = u16(p + 10); rate = u32(p + 12); bits = u16(p + 22) }
            if (tag == "data") { dataOff = p + 8; dataLen = min(len, b.size - dataOff); break }
            p += 8 + len + (len and 1)
        }
        if (dataOff < 0 || bits != 16 || ch !in 1..2 || rate <= 0) return null
        val frames = dataLen / (2 * ch)
        val l = FloatArray(frames); val r = FloatArray(frames)
        for (i in 0 until frames) {
            val o = dataOff + i * 2 * ch
            l[i] = u16(o).toShort() / 32768f
            r[i] = if (ch == 2) u16(o + 2).toShort() / 32768f else l[i]
        }
        if (rate == sr) return l to r
        val outLen = (frames.toLong() * sr / rate).toInt()
        val ol = FloatArray(outLen); val rr = FloatArray(outLen)
        val step = rate.toDouble() / sr
        for (i in 0 until outLen) {
            val pos = i * step; val j = pos.toInt(); val f = (pos - j).toFloat()
            val j1 = min(j + 1, frames - 1)
            ol[i] = l[j] + (l[j1] - l[j]) * f
            rr[i] = r[j] + (r[j1] - r[j]) * f
        }
        return ol to rr
    }
}
