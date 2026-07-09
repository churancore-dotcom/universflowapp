package com.universeflow.app

import android.util.Log
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * Capacitor wrapper around the shared on-device YouTube resolver.
 * The actual resolver/cache is in NativeYouTubeResolver so ExoPlayerPlugin can
 * preload queue items natively without round-tripping through WebView JS.
 */
@CapacitorPlugin(name = "InnerTube")
class InnerTubePlugin : Plugin() {
    override fun load() {
        super.load()
        NativeYouTubeResolver.attach(context)
        NativeYouTubeResolver.warm()
    }

    @PluginMethod
    fun resolveAudio(call: PluginCall) {
        val videoId = call.getString("videoId")
        Log.d("InnerTube", "Resolving: $videoId")
        if (videoId.isNullOrBlank() || videoId.length != 11) {
            call.reject("invalid videoId")
            return
        }

        Thread {
            val resolved = NativeYouTubeResolver.resolve(videoId)
            if (resolved == null) {
                call.reject("InnerTube resolve failed")
                return@Thread
            }
            call.resolve(JSObject().apply {
                put("url", resolved.url)
                put("itag", resolved.itag)
                put("client", resolved.client)
            })
        }.start()
    }
}