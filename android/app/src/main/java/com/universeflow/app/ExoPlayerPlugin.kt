package com.universeflow.app

import android.content.ComponentName
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * JS bridge for the on-device ExoPlayer media session.
 *
 * Methods: play, pause, resume, stop, seekTo, setVolume,
 * getCurrentPosition, getDuration, isPlaying.
 *
 * Events: playbackStateChange, playbackProgress, playbackError.
 */
@CapacitorPlugin(name = "ExoPlayer")
class ExoPlayerPlugin : Plugin() {

    private val main = Handler(Looper.getMainLooper())
    private var progressTimer: Runnable? = null
    private var listenerAttached = false

    override fun load() {
        super.load()
        // Eagerly start the foreground service so the MediaSession exists before
        // the JS calls play(). Required for MediaSessionService on Android 14+.
        val ctx = context.applicationContext
        val intent = Intent(ctx, ExoPlayerService::class.java)
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                ctx.startForegroundService(intent)
            } else {
                ctx.startService(intent)
            }
        } catch (_: Throwable) { /* will retry on play() */ }
    }

    private fun service(): ExoPlayerService? = ServiceRegistry.exoService

    private fun runOnMain(block: () -> Unit) {
        if (Looper.myLooper() == Looper.getMainLooper()) block() else main.post(block)
    }

    private fun ensureListener(call: PluginCall?) {
        if (listenerAttached) return
        val svc = service() ?: return
        val player = svc.player ?: return
        player.addListener(object : Player.Listener {
            override fun onPlaybackStateChanged(state: Int) {
                val name = when (state) {
                    Player.STATE_IDLE -> "stopped"
                    Player.STATE_BUFFERING -> "buffering"
                    Player.STATE_READY -> if (player.playWhenReady) "playing" else "paused"
                    Player.STATE_ENDED -> "ended"
                    else -> "unknown"
                }
                notifyListeners("playbackStateChange", JSObject().put("state", name))
            }
            override fun onIsPlayingChanged(isPlaying: Boolean) {
                notifyListeners(
                    "playbackStateChange",
                    JSObject().put("state", if (isPlaying) "playing" else "paused"),
                )
                if (isPlaying) startProgress() else stopProgress()
            }
            override fun onPlayerError(error: PlaybackException) {
                notifyListeners(
                    "playbackError",
                    JSObject().put("message", error.message ?: "playback error"),
                )
            }
        })
        listenerAttached = true
        call?.let { ensureListener(null) }
    }

    private fun startProgress() {
        stopProgress()
        val r = object : Runnable {
            override fun run() {
                val p = service()?.player ?: return
                val data = JSObject().apply {
                    put("position", p.currentPosition.coerceAtLeast(0L))
                    val d = p.duration
                    put("duration", if (d > 0) d else 0L)
                }
                notifyListeners("playbackProgress", data)
                main.postDelayed(this, 500)
            }
        }
        progressTimer = r
        main.post(r)
    }

    private fun stopProgress() {
        progressTimer?.let { main.removeCallbacks(it) }
        progressTimer = null
    }

    @PluginMethod
    fun play(call: PluginCall) {
        val url = call.getString("url")
        if (url.isNullOrBlank()) { call.reject("missing url"); return }
        val title = call.getString("title") ?: ""
        val artist = call.getString("artist") ?: ""
        val artwork = call.getString("artworkUrl")

        runOnMain {
            val ctx = context.applicationContext
            // Make sure the service is up.
            val intent = Intent(ctx, ExoPlayerService::class.java)
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    ctx.startForegroundService(intent)
                } else {
                    ctx.startService(intent)
                }
            } catch (_: Throwable) {}

            // Wait one tick if the service hasn't published its player yet.
            fun perform(): Boolean {
                val player = service()?.player ?: return false
                ensureListener(null)
                val metadata = MediaMetadata.Builder()
                    .setTitle(title)
                    .setArtist(artist)
                    .apply { if (!artwork.isNullOrBlank()) setArtworkUri(Uri.parse(artwork)) }
                    .build()
                val item = MediaItem.Builder()
                    .setUri(Uri.parse(url))
                    .setMediaMetadata(metadata)
                    .build()
                player.setMediaItem(item)
                player.prepare()
                player.playWhenReady = true
                return true
            }

            if (!perform()) {
                main.postDelayed({ perform(); call.resolve() }, 120)
            } else {
                call.resolve()
            }
        }
    }

    @PluginMethod
    fun pause(call: PluginCall) {
        runOnMain {
            service()?.player?.playWhenReady = false
            call.resolve()
        }
    }

    @PluginMethod
    fun resume(call: PluginCall) {
        runOnMain {
            service()?.player?.let {
                ensureListener(null)
                it.playWhenReady = true
            }
            call.resolve()
        }
    }

    @PluginMethod
    fun stop(call: PluginCall) {
        runOnMain {
            service()?.player?.let {
                it.stop()
                it.clearMediaItems()
            }
            stopProgress()
            call.resolve()
        }
    }

    @PluginMethod
    fun seekTo(call: PluginCall) {
        val positionMs = call.getLong("positionMs") ?: run { call.reject("missing positionMs"); return }
        runOnMain {
            service()?.player?.seekTo(positionMs)
            call.resolve()
        }
    }

    @PluginMethod
    fun setVolume(call: PluginCall) {
        val volume = call.getFloat("volume") ?: 1.0f
        runOnMain {
            service()?.player?.volume = volume.coerceIn(0f, 1f)
            call.resolve()
        }
    }

    @PluginMethod
    fun getCurrentPosition(call: PluginCall) {
        runOnMain {
            val pos = service()?.player?.currentPosition ?: 0L
            call.resolve(JSObject().put("position", pos.coerceAtLeast(0L)))
        }
    }

    @PluginMethod
    fun getDuration(call: PluginCall) {
        runOnMain {
            val d = service()?.player?.duration ?: 0L
            call.resolve(JSObject().put("duration", if (d > 0) d else 0L))
        }
    }

    @PluginMethod
    fun isPlaying(call: PluginCall) {
        runOnMain {
            val v = service()?.player?.isPlaying == true
            call.resolve(JSObject().put("isPlaying", v))
        }
    }

    override fun handleOnDestroy() {
        stopProgress()
        super.handleOnDestroy()
    }
}
