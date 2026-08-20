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
}