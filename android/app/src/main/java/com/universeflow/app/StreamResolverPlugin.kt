package com.universeflow.app

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * Metadata-only stream resolver bridge.
 *
 * Calls the native [MasterResolver] (JioSaavn → InnerTube) and returns the
 * direct CDN URL + source to JS. This is for UI-only consumers (lyrics
 * sync, share links, the download manager). Actual audio playback NEVER
 * routes back through an HTML `<audio>` element — it stays inside
 * [ExoPlayerService] / [ExoPlayerPlugin].
 */
@CapacitorPlugin(name = "StreamResolver")
class StreamResolverPlugin : Plugin() {

    @PluginMethod
    fun resolveStream(call: PluginCall) {
        val videoId = call.getString("videoId")
        val title = call.getString("title")
        val artist = call.getString("artist")
        if (videoId.isNullOrBlank() && title.isNullOrBlank()) {
            call.reject("missing videoId or title")
            return
        }
        Thread {
            val r = try {
                MasterResolver.resolve(videoId, title, artist, timeoutMs = 5200L)
            } catch (t: Throwable) {
                null
            }
            if (r == null) {
                call.reject("resolution failed")
            } else {
                val out = JSObject()
                    .put("url", r.url)
                    .put("source", r.source)
                    .put("expiresAt", r.expiresAt)
                call.resolve(out)
            }
        }.start()
    }

    /**
     * Prefetch a batch of tracks in parallel. Accepts `tracks: [{ videoId,
     * title, artist }]`. Resolves immediately; resolution proceeds in the
     * background and seeds the native cache so the next tap is instant.
     */
    @PluginMethod
    fun prefetch(call: PluginCall) {
        val arr = call.getArray("tracks")
        if (arr == null || arr.length() == 0) { call.resolve(); return }
        val limit = call.getInt("limit") ?: 5
        val list = mutableListOf<Triple<String?, String?, String?>>()
        for (i in 0 until arr.length()) {
            val o = arr.optJSONObject(i) ?: continue
            list.add(
                Triple(
                    o.optString("videoId", "").takeIf { it.isNotBlank() },
                    o.optString("title", "").takeIf { it.isNotBlank() },
                    o.optString("artist", "").takeIf { it.isNotBlank() },
                ),
            )
        }
        MasterResolver.prefetch(list, limit = limit)
        call.resolve()
    }
}
