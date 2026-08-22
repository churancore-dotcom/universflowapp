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
        YouTubeAccount.attach(context)
        NativeYouTubeResolver.warm()
    }

    // ── Optional YouTube account pairing (youtube.com/activate device flow) ──
    // A signed-in InnerTube request is not refused with LOGIN_REQUIRED, which
    // is the single biggest cause of "tap play, nothing happens" on age-gated
    // or region-locked tracks. Tokens live only in this app's private prefs.

    @PluginMethod
    fun accountStatus(call: PluginCall) {
        call.resolve(JSObject().apply { put("connected", YouTubeAccount.isSignedIn()) })
    }

    /**
     * Hand the pairing URL to the system browser. A WebView `target="_blank"`
     * link is swallowed by Capacitor's shell, which is why the consent screen
     * never appeared for the user.
     */
    @PluginMethod
    fun openPairingUrl(call: PluginCall) {
        val url = call.getString("url")
        if (url.isNullOrBlank()) {
            call.reject("url required")
            return
        }
        try {
            val intent = android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse(url))
            intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(intent)
            call.resolve(JSObject().apply { put("opened", true) })
        } catch (t: Throwable) {
            Log.w("InnerTube", "openPairingUrl failed: ${t.message}")
            call.reject("could not open browser")
        }
    }



    @PluginMethod
    fun startAccountAuth(call: PluginCall) {
        Thread {
            val res = YouTubeAccount.startDeviceAuth()
            if (res == null) call.reject("could not start YouTube pairing")
            else call.resolve(JSObject.fromJSONObject(res))
        }.start()
    }

    @PluginMethod
    fun pollAccountAuth(call: PluginCall) {
        val deviceCode = call.getString("deviceCode")
        if (deviceCode.isNullOrBlank()) {
            call.reject("deviceCode required")
            return
        }
        Thread {
            call.resolve(JSObject.fromJSONObject(YouTubeAccount.pollDeviceAuth(deviceCode)))
        }.start()
    }

    @PluginMethod
    fun disconnectAccount(call: PluginCall) {
        YouTubeAccount.signOut()
        call.resolve(JSObject().apply { put("connected", false) })
    }


    /**
     * Streaming-quality tier (bits per second, 0 = unlimited) from Settings.
     * Without this the on-device resolver always grabbed the fattest audio
     * track, so the Saver/Normal/High/Ultra picker had no effect on the APK.
     */
    @PluginMethod
    fun setQualityCap(call: PluginCall) {
        val bps = call.getInt("bitrateCap") ?: 0
        NativeYouTubeResolver.setBitrateCap(bps)
        call.resolve(JSObject().apply { put("bitrateCap", bps) })
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
                val code = NativeYouTubeResolver.lastFailure(videoId)
                call.reject("InnerTube resolve failed: $code", code)
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