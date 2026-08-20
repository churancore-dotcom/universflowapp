package com.universeflow.app

import java.net.URLDecoder

/** Pure helpers for signed media URL lifetime and resolver retry policy. */
object StreamUrlPolicy {
    private const val DEFAULT_TTL_MS = 4L * 60L * 60L * 1000L
    private const val EXPIRY_SAFETY_MS = 2L * 60L * 1000L

    fun expiresAt(url: String, nowMs: Long = System.currentTimeMillis()): Long {
        val rawQuery = url.substringAfter('?', "").substringBefore('#')
        val expireSeconds = rawQuery.split('&')
            .firstNotNullOfOrNull { part ->
                val separator = part.indexOf('=')
                if (separator <= 0) return@firstNotNullOfOrNull null
                val key = decode(part.substring(0, separator))
                if (key != "expire" && key != "expires") return@firstNotNullOfOrNull null
                decode(part.substring(separator + 1)).toLongOrNull()
            }
        val signedExpiry = expireSeconds?.times(1000L)?.minus(EXPIRY_SAFETY_MS)
        return signedExpiry?.takeIf { it > nowMs } ?: nowMs + DEFAULT_TTL_MS
    }

    fun isUsable(expiresAtMs: Long, nowMs: Long = System.currentTimeMillis()): Boolean =
        expiresAtMs > nowMs

    private fun decode(value: String): String =
        try { URLDecoder.decode(value, "UTF-8") } catch (_: Throwable) { value }
}