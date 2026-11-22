package com.universeflow.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class StreamUrlPolicyTest {
    @Test
    fun usesSignedUrlExpiryWithSafetyWindow() {
        val now = 1_700_000_000_000L
        val expirySeconds = now / 1000L + 3600L
        assertEquals(
            expirySeconds * 1000L - 120_000L,
            StreamUrlPolicy.expiresAt("https://example.test/audio?expire=$expirySeconds&foo=bar", now),
        )
    }

    @Test
    fun defaultsToFourHoursWithoutExpiry() {
        val now = 1_700_000_000_000L
        assertEquals(now + 4L * 60L * 60L * 1000L, StreamUrlPolicy.expiresAt("https://example.test/audio", now))
    }

    @Test
    fun reportsUsabilityAtBoundary() {
        assertTrue(StreamUrlPolicy.isUsable(2_000L, 1_999L))
        assertFalse(StreamUrlPolicy.isUsable(2_000L, 2_000L))
    }

    @Test
    fun playingUrlIsReusedUntilItsSignedExpiry() {
        val url = "https://rr1.googlevideo.com/videoplayback?expire=10000&itag=251"
        assertTrue(StreamUrlPolicy.canReuse(url, 0L, 9_000_000L))
        assertFalse(StreamUrlPolicy.canReuse(url, 0L, 9_900_000L))
    }

    @Test
    fun unsignedUrlIsReusedForFourHours() {
        val url = "https://cdn.example.com/song.mp4"
        assertTrue(StreamUrlPolicy.canReuse(url, 0L, 4L * 3600_000L - 1))
        assertFalse(StreamUrlPolicy.canReuse(url, 0L, 4L * 3600_000L))
    }
}
