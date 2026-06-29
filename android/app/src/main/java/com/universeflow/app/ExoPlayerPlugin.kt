package com.universeflow.app

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log
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
    private var listenerPlayer: Player? = null

    @Volatile private var serviceConnected = false
    private val pendingCommands: MutableList<() -> Unit> = mutableListOf()
    private val connection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, binder: IBinder?) {
            Log.d("ExoPlayerPlugin", "ServiceConnection.onServiceConnected")
            serviceConnected = true
            drainPending()
        }
        override fun onServiceDisconnected(name: ComponentName?) {
            Log.d("ExoPlayerPlugin", "ServiceConnection.onServiceDisconnected")
            serviceConnected = false
        }
    }

    override fun load() {
        super.load()
        // Eagerly bring up the MediaSessionService so playback latency on the
        // very first tap is just the InnerTube resolve + ExoPlayer prepare.
        val ctx = context.applicationContext
        val intent = Intent(ctx, ExoPlayerService::class.java).apply {
            // MediaSessionService.onBind() only returns a binder when this
            // action is set. Without it, onServiceConnected never fires.
            action = "androidx.media3.session.MediaSessionService"
        }
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                ctx.startForegroundService(intent)
            } else {
                ctx.startService(intent)
            }
        } catch (t: Throwable) {
            Log.w("ExoPlayerPlugin", "startService failed: ${t.message}")
            try { ctx.startService(intent) } catch (_: Throwable) {}
        }
        try {
            ctx.bindService(intent, connection, Context.BIND_AUTO_CREATE)
        } catch (t: Throwable) {
            Log.w("ExoPlayerPlugin", "bindService failed: ${t.message}")
        }
    }

    private fun service(): ExoPlayerService? = ServiceRegistry.exoService

    private fun runOnMain(block: () -> Unit) {
        if (Looper.myLooper() == Looper.getMainLooper()) block() else main.post(block)
    }

    private fun drainPending() {
        val copy: List<() -> Unit>
        synchronized(pendingCommands) {
            copy = pendingCommands.toList()
            pendingCommands.clear()
        }
        copy.forEach { runOnMain(it) }
    }

    /**
     * Run [block] now if the service is connected; otherwise queue it and run
     * it as soon as onServiceConnected fires. If [timeoutMs] elapses with no
     * connection, invokes [onTimeout] (typically: reject the PluginCall + emit
     * playbackError).
     */
    private fun runWhenReady(timeoutMs: Long, onTimeout: () -> Unit, block: () -> Unit) {
        if (serviceConnected && service()?.player != null) {
            runOnMain(block)
            return
        }
        val sentinel = object {}
        var fired = false
        val wrapper: () -> Unit = {
            if (!fired) {
                fired = true
                block()
            }
        }
        synchronized(pendingCommands) { pendingCommands.add(wrapper) }
        main.postDelayed({
            // If service still isn't ready and the command hasn't fired, drop
            // it and signal timeout.
            if (!fired) {
                fired = true
                synchronized(pendingCommands) { pendingCommands.remove(wrapper) }
                Log.e("ExoPlayerPlugin", "Service ready timeout after ${timeoutMs}ms")
                onTimeout()
            }
            // touch sentinel so kotlin doesn't elide the lambda
            sentinel.hashCode()
        }, timeoutMs)
    }

    private fun ensureListener(call: PluginCall?) {
        val svc = service() ?: return
        val player = svc.player ?: return
        if (listenerAttached && listenerPlayer === player) return
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
                Log.e("ExoPlayerPlugin", "onPlayerError: ${error.message}")
                notifyListeners(
                    "playbackError",
                    JSObject().put("message", error.message ?: "playback error"),
                )
            }
        })
        listenerAttached = true
        listenerPlayer = player
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
        Log.d("ExoPlayerPlugin", "play() title=$title url=${url.take(80)}...")

        val performPlay: () -> Unit = {
            val player = service()?.player
            if (player == null) {
                Log.e("ExoPlayerPlugin", "service ready but player == null")
                notifyListeners("playbackError", JSObject().put("message", "ExoPlayer player not ready"))
                call.reject("ExoPlayer player not ready")
            } else {
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
                call.resolve()
            }
        }

        runWhenReady(
            timeoutMs = 3000L,
            onTimeout = {
                Log.e("ExoPlayerPlugin", "ExoPlayer service did not connect within 3s")
                notifyListeners(
                    "playbackError",
                    JSObject().put("message", "ExoPlayer service did not become ready"),
                )
                call.reject("ExoPlayer service did not become ready")
            },
            block = performPlay,
        )
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

    // ---------- Audio effects ----------

    @PluginMethod
    fun getAudioSessionId(call: PluginCall) {
        runOnMain {
            service()?.ensureEffectsBound()
            val sid = service()?.player?.audioSessionId ?: 0
            call.resolve(JSObject().put("sessionId", sid))
        }
    }

    @PluginMethod
    fun setEQEnabled(call: PluginCall) {
        val enabled = call.getBoolean("enabled") ?: true
        runOnMain {
            val svc = service()
            svc?.ensureEffectsBound()
            try { svc?.equalizer?.enabled = enabled } catch (_: Throwable) {}
            call.resolve()
        }
    }

    @PluginMethod
    fun setEQBand(call: PluginCall) {
        val band = call.getInt("band") ?: run { call.reject("missing band"); return }
        val mb = call.getInt("levelMillibels") ?: run { call.reject("missing levelMillibels"); return }
        runOnMain {
            val svc = service()
            svc?.ensureEffectsBound()
            val eq = svc?.equalizer
            if (eq == null) { call.resolve(); return@runOnMain }
            try {
                val range = eq.bandLevelRange
                val min = range[0].toInt()
                val max = range[1].toInt()
                val clamped = mb.coerceIn(min, max).toShort()
                eq.setBandLevel(band.toShort(), clamped)
            } catch (_: Throwable) {}
            call.resolve()
        }
    }

    @PluginMethod
    fun getEQBands(call: PluginCall) {
        runOnMain {
            val svc = service()
            svc?.ensureEffectsBound()
            val eq = svc?.equalizer
            val out = JSObject()
            if (eq == null) {
                out.put("available", false)
                out.put("numberOfBands", 0)
                out.put("minLevel", 0)
                out.put("maxLevel", 0)
                out.put("bands", org.json.JSONArray())
                call.resolve(out)
                return@runOnMain
            }
            try {
                val n = eq.numberOfBands.toInt()
                val range = eq.bandLevelRange
                val arr = org.json.JSONArray()
                for (i in 0 until n) {
                    val freqRange = eq.getBandFreqRange(i.toShort())
                    val center = eq.getCenterFreq(i.toShort()) // milliHz
                    val obj = JSObject()
                    obj.put("index", i)
                    obj.put("centerFrequencyHz", center / 1000)
                    obj.put("minFrequencyHz", freqRange[0] / 1000)
                    obj.put("maxFrequencyHz", freqRange[1] / 1000)
                    arr.put(obj)
                }
                out.put("available", true)
                out.put("numberOfBands", n)
                out.put("minLevel", range[0].toInt())
                out.put("maxLevel", range[1].toInt())
                out.put("bands", arr)
            } catch (_: Throwable) {
                out.put("available", false)
            }
            call.resolve(out)
        }
    }

    @PluginMethod
    fun setBassBoost(call: PluginCall) {
        val strength = (call.getInt("strength") ?: 0).coerceIn(0, 1000)
        runOnMain {
            val svc = service()
            svc?.ensureEffectsBound()
            val bb = svc?.bassBoost
            try {
                if (bb != null) {
                    if (strength <= 0) { bb.enabled = false }
                    else {
                        bb.enabled = true
                        if (bb.strengthSupported) bb.setStrength(strength.toShort())
                    }
                }
            } catch (_: Throwable) {}
            call.resolve()
        }
    }

    @PluginMethod
    fun setVirtualizer(call: PluginCall) {
        val strength = (call.getInt("strength") ?: 0).coerceIn(0, 1000)
        runOnMain {
            val svc = service()
            svc?.ensureEffectsBound()
            val v = svc?.virtualizer
            try {
                if (v != null) {
                    if (strength <= 0) { v.enabled = false }
                    else {
                        v.enabled = true
                        if (v.strengthSupported) v.setStrength(strength.toShort())
                    }
                }
            } catch (_: Throwable) {}
            call.resolve()
        }
    }

    @PluginMethod
    fun setLoudnessEnhancer(call: PluginCall) {
        val gainMb = (call.getInt("gainMb") ?: 0).coerceIn(0, 2000)
        runOnMain {
            val svc = service()
            svc?.ensureEffectsBound()
            val le = svc?.loudnessEnhancer
            try {
                if (le != null) {
                    if (gainMb <= 0) { le.enabled = false }
                    else {
                        le.setTargetGain(gainMb)
                        le.enabled = true
                    }
                }
            } catch (_: Throwable) {}
            call.resolve()
        }
    }

    override fun handleOnDestroy() {
        stopProgress()
        super.handleOnDestroy()
    }
}

