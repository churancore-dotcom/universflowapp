package com.universeflow.app

import android.net.Uri
import androidx.media3.common.C
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.TransferListener
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/** Fake server that serves [data] and records every requested byte range. */
private class FakeRangeSource(private val data: ByteArray) : DataSource {
    val ranges = mutableListOf<Pair<Long, Long>>()
    private var pos = 0L
    private var stop = 0L
    private var uri: Uri? = null
    override fun addTransferListener(transferListener: TransferListener) {}
    override fun open(dataSpec: DataSpec): Long {
        uri = dataSpec.uri
        pos = dataSpec.position
        stop = if (dataSpec.length == C.LENGTH_UNSET.toLong()) data.size.toLong()
        else minOf(data.size.toLong(), pos + dataSpec.length)
        ranges += pos to dataSpec.length
        return stop - pos
    }
    override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
        if (pos >= stop) return C.RESULT_END_OF_INPUT
        val n = minOf(length.toLong(), stop - pos).toInt()
        System.arraycopy(data, pos.toInt(), buffer, offset, n)
        pos += n
        return n
    }
    override fun getUri(): Uri? = uri
    override fun close() {}
}

@RunWith(RobolectricTestRunner::class)
class ChunkedHttpDataSourceTest {
    private fun readAll(src: DataSource, spec: DataSpec): ByteArray {
        src.open(spec)
        val out = java.io.ByteArrayOutputStream()
        val buf = ByteArray(700)
        while (true) {
            val n = src.read(buf, 0, buf.size)
            if (n == C.RESULT_END_OF_INPUT) break
            out.write(buf, 0, n)
        }
        src.close()
        return out.toByteArray()
    }

    @Test
    fun youtubeStreamIsFetchedInBoundedRangesAndBytesStayIntact() {
        val data = ByteArray(10_000) { (it % 251).toByte() }
        val fake = FakeRangeSource(data)
        val src = ChunkedHttpDataSource(fake, chunkBytes = 3_000)
        val uri = Uri.parse("https://rr1.googlevideo.com/videoplayback?itag=251&clen=10000")
        val got = readAll(src, DataSpec(uri))
        assertArrayEquals(data, got)
        assertEquals(listOf(0L to 3000L, 3000L to 3000L, 6000L to 3000L, 9000L to 1000L), fake.ranges)
    }

    @Test
    fun otherHostsAreNotChunked() {
        val data = ByteArray(5_000) { 7 }
        val fake = FakeRangeSource(data)
        val src = ChunkedHttpDataSource(fake, chunkBytes = 1_000)
        val got = readAll(src, DataSpec(Uri.parse("https://aac.saavncdn.com/song.mp4")))
        assertEquals(5_000, got.size)
        assertEquals(1, fake.ranges.size)
    }
}
