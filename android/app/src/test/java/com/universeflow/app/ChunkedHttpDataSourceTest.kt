package com.universeflow.app

import org.junit.Assert.*
import org.junit.Test

class ChunkedHttpDataSourceTest {
    @Test
    fun onlyYouTubeAudioHostsAreChunked() {
        assertTrue(ChunkedHttpDataSource.isChunkedHost("rr3---sn-abc.googlevideo.com"))
        assertFalse(ChunkedHttpDataSource.isChunkedHost("aac.saavncdn.com"))
        assertFalse(ChunkedHttpDataSource.isChunkedHost(null))
    }

    @Test
    fun rangesCoverTheWholeFileWithoutPassingItsEnd() {
        val end = 10_000L
        var pos = 0L
        val ranges = mutableListOf<Long>()
        while (pos < end) {
            val len = ChunkedHttpDataSource.chunkLength(pos, end, 3_000L)
            ranges += len
            pos += len
        }
        assertEquals(listOf(3_000L, 3_000L, 3_000L, 1_000L), ranges)
        assertEquals(end, pos)
    }

    @Test
    fun unknownLengthUsesFullChunks() {
        assertEquals(2_097_152L, ChunkedHttpDataSource.chunkLength(5L, -1L, ChunkedHttpDataSource.DEFAULT_CHUNK_BYTES))
    }
}
