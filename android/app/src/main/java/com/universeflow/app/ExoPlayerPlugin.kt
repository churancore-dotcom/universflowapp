package com.universeflow.app

import android.Manifest
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.content.pm.PackageManager
import android.net.Uri

import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import org.json.JSONObject
import java.util.concurrent.atomic.AtomicLong

/**
 * JS bridge for the on-device ExoPlayer media session.
 *
 * Methods: play, playQueue, preloadQueue, pause, resume, stop, seekTo, setVolume,
 * getCurrentPosition, getDuration, isPlaying.
 *
 * Events: playbackStateChange, playbackProgress, playbackError, mediaItemTransition.
 */
@CapacitorPlugin(name = "ExoPlayer")
class ExoPlayerPlugin : Plugin() {

    private val main = Handler(Looper.getMainLooper())
    private var progressTimer: Runnable? = null
    private var listenerAttached = false
    private var listenerPlayer: Player? = null
    @Volatile private var isStartingUp = false
    private val playGeneration = AtomicLong(0L)

    private data class NativeTrack(
        val id: String,
        val title: String,
        val artist: String,
        val artworkUrl: String?,
        val url: String?,
        val videoId: String?,
    )

    private fun isYouTubeFallback(url: String?): Boolean = url?.startsWith("yt-video:") == true

    private fun directPlayableUrl(url: String?): String? {
        if (url.isNullOrBlank()) return null
        if (isYouTubeFallback(url)) return null
        return if (url.startsWith("http") || url.startsWith("file:") || url.startsWith("content:")) url else null
    }

    private fun resolveTrackUrl(track: NativeTrack, nativeTimeoutMs: Long = 5200L): String? {
        val vid = track.videoId?.takeIf { it.length == 11 }
        if (vid != null) {
            NativeYouTubeResolver.resolve(vid, nativeTimeoutMs)?.let { return it.url }
        }
        return directPlayableUrl(track.url)
    }

    private fun mediaItemFor(track: NativeTrack, resolvedUrl: String): MediaItem {
        val metadata = MediaMetadata.Builder()
            .setTitle(track.title)
            .setArtist(track.artist)
            .apply { if (!track.artworkUrl.isNullOrBlank()) setArtworkUri(Uri.parse(track.artworkUrl)) }
            .build()
        return MediaItem.Builder()
            .setMediaId(track.id)
            .setUri(Uri.parse(resolvedUrl))
            .setMediaMetadata(metadata)
            .build()
    }

    private fun parseTrack(obj: JSONObject?, fallbackIndex: Int): NativeTrack? {
        if (obj == null) return null
        val rawUrl = obj.optString("url", obj.optString("audio_url", "")).takeIf { it.isNotBlank() }
        val explicitVideoId = obj.optString("videoId", "").takeIf { it.length == 11 }
        val fallbackVideoId = rawUrl?.takeIf { it.startsWith("yt-video:") }?.removePrefix("yt-video:")?.takeIf { it.length == 11 }
        val id = obj.optString("id", explicitVideoId ?: fallbackVideoId ?: rawUrl ?: "native-$fallbackIndex")
        return NativeTrack(
            id = id,
            title = obj.optString("title", ""),
            artist = obj.optString("artist", ""),
            artworkUrl = obj.optString("artworkUrl", obj.optString("cover_url", "")).takeIf { it.isNotBlank() },
            url = rawUrl,
            videoId = explicitVideoId ?: fallbackVideoId,
        )
    }

    private fun emitPlaybackState(player: Player) {
        val name = when {
            player.playbackState == Player.STATE_ENDED -> "ended"
            player.playbackState == Player.STATE_IDLE -> "stopped"
            player.isPlaying -> "playing"
            player.playWhenReady && (player.playbackState == Player.STATE_BUFFERING || player.playbackState == Player.STATE_READY) -> "buffering"
            player.playbackState == Player.STATE_BUFFERING -> "buffering"
            else -> "paused"
        }
        // During a track swap ExoPlayer briefly emits IDLE/paused/ended for the
        // old item. If JS receives that after a tap, it looks like an auto-pause.
        if (isStartingUp && (name == "stopped" || name == "paused" || name == "ended")) return
        notifyListeners("playbackStateChange", JSObject().put("state", name))
    }

    @Volatile private var serviceConnected = false
    @Volatile private var serviceBindAttempted = false
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
            serviceBindAttempted = false
            listenerAttached = false
            listenerPlayer = null
            isStartingUp = false
            stopProgress()
        }
    }

    override fun load() {
        super.load()
        ensureServiceAvailable()
    }

    private fun serviceIntent(ctx: Context): Intent = Intent(ctx, ExoPlayerService::class.java).apply {
        // MediaSessionService.onBind() only returns a binder when this action is set.
        action = "androidx.media3.session.MediaSessionService"
    }

    private fun ensureNotificationPermissionBestEffort() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        try {
            if (ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) return
            ActivityCompat.requestPermissions(activity, arrayOf(Manifest.permission.POST_NOTIFICATIONS), 8802)
        } catch (t: Throwable) {
            Log.w("ExoPlayerPlugin", "notification permission request skipped: ${t.message}")
        }
    }

    private fun ensureServiceAvailable() {
        // Eagerly bring up the MediaSessionService so playback latency on the
        // very first tap is just the InnerTube resolve + ExoPlayer prepare.
        val ctx = context.applicationContext
        val intent = serviceIntent(ctx)
        // IMPORTANT: plain startService() — NOT startForegroundService().
        // Media3 promotes the service to FG itself once playback is active;
        // calling startForegroundService here would arm Android's 5s
        // startForeground deadline and crash the APK while the service is
        // still warming up. bindService() with BIND_AUTO_CREATE is enough to
        // create the service eagerly and give us a connection callback.
        try {
            ctx.startService(intent)
        } catch (t: Throwable) {
            Log.w("ExoPlayerPlugin", "startService failed: ${t.message}")
        }
        if (!serviceBindAttempted) {
            try {
                serviceBindAttempted = true
                ctx.bindService(intent, connection, Context.BIND_AUTO_CREATE)
            } catch (t: Throwable) {
                Log.w("ExoPlayerPlugin", "bindService failed: ${t.message}")
                serviceBindAttempted = false
            }
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
        ensureServiceAvailable()
        // ServiceRegistry is the real in-process source of truth. Some Android
        // builds create/start the MediaSessionService successfully but delay or
        // skip the ServiceConnection callback during background transitions;
        // requiring serviceConnected here caused the "Service ready timeout" and
        // left playback silent. If the registry has a player, run immediately.
        if (service()?.player != null) {
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
        val poll = object : Runnable {
            override fun run() {
                if (fired) return
                if (service()?.player != null) {
                    synchronized(pendingCommands) { pendingCommands.remove(wrapper) }
                    runOnMain(wrapper)
                } else {
                    main.postDelayed(this, 100L)
                }
            }
        }
        main.postDelayed(poll, 100L)
        main.postDelayed({
            // If service still isn't ready and the command hasn't fired, drop
            // it and signal timeout.
            if (!fired) {
                fired = true
                synchronized(pendingCommands) { pendingCommands.remove(wrapper) }
                main.removeCallbacks(poll)
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
                emitPlaybackState(player)
            }
            override fun onIsPlayingChanged(isPlaying: Boolean) {
                if (isPlaying) isStartingUp = false
                emitPlaybackState(player)
                if (isPlaying) startProgress() else stopProgress()
            }
            override fun onPlayerError(error: PlaybackException) {
                Log.e("ExoPlayerPlugin", "onPlayerError: ${error.message}")
                isStartingUp = false
                stopProgress()
                notifyListeners(
                    "playbackError",
                    JSObject().put("message", error.message ?: "playback error"),
                )
            }
            override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
                mediaItem?.let {
                    notifyListeners(
                        "mediaItemTransition",
                        JSObject().put("mediaId", it.mediaId).put("reason", reason),
                    )
                }
            }
        })
        listenerAttached = true
        listenerPlayer = player
        call?.let { ensureListener(null) }
    }

    @PluginMethod
    fun playQueue(call: PluginCall) {
        val generation = playGeneration.incrementAndGet()
        ensureNotificationPermissionBestEffort()
        val arr = call.getArray("tracks")
        if (arr == null || arr.length() == 0) { call.reject("missing tracks"); return }
        val startIndex = (call.getInt("startIndex") ?: 0).coerceIn(0, arr.length() - 1)
        val tracks = mutableListOf<NativeTrack>()
        for (i in 0 until arr.length()) {
            parseTrack(arr.optJSONObject(i), i)?.let { tracks.add(it) }
        }
        if (tracks.isEmpty()) { call.reject("empty tracks"); return }
        val firstTrack = tracks[startIndex]
        Log.d("ExoPlayerPlugin", "playQueue() index=$startIndex title=${firstTrack.title}")

        val performPlay: () -> Unit = {
            val player = service()?.player
            if (player == null) {
                isStartingUp = false
                notifyListeners("playbackError", JSObject().put("message", "ExoPlayer player not ready"))
                call.reject("ExoPlayer player not ready")
            } else {
                Thread {
                    val firstUrl = resolveTrackUrl(firstTrack, nativeTimeoutMs = 5200L)
                    if (playGeneration.get() != generation) {
                        main.post { call.resolve() }
                        return@Thread
                    }
                    if (firstUrl == null) {
                        main.post {
                            isStartingUp = false
                            notifyListeners("playbackError", JSObject().put("message", "Could not resolve first track"))
                            call.reject("Could not resolve first track")
                        }
                        return@Thread
                    }

                    main.post {
                        if (playGeneration.get() != generation) {
                            call.resolve()
                            return@post
                        }
                        isStartingUp = true
                        ensureListener(null)
                        stopProgress()
                        player.stop()
                        player.clearMediaItems()
                        player.setMediaItem(mediaItemFor(firstTrack, firstUrl))
                        player.prepare()
                        player.playWhenReady = true
                        call.resolve()
                    }

                    // Native queue preloading: resolve upcoming tracks from the
                    // phone IP and append them directly to ExoPlayer. This keeps
                    // background/lock-screen autoplay alive even if WebView JS is
                    // frozen by Android.
                    val ordered = tracks.drop(startIndex + 1)
                    val warm = ordered.take(8).mapNotNull { t ->
                        val u = resolveTrackUrl(t, nativeTimeoutMs = 5200L) ?: return@mapNotNull null
                        mediaItemFor(t, u)
                    }
                    if (warm.isNotEmpty()) {
                        main.post {
                            if (playGeneration.get() != generation) return@post
                            val p = service()?.player ?: return@post
                            p.addMediaItems(warm)
                        }
                    }
                }.start()
            }
        }

        runWhenReady(
            timeoutMs = 3000L,
            onTimeout = {
                isStartingUp = false
                notifyListeners("playbackError", JSObject().put("message", "ExoPlayer service did not become ready"))
                call.reject("ExoPlayer service did not become ready")
            },
            block = performPlay,
        )
    }

    @PluginMethod
    fun preloadQueue(call: PluginCall) {
        val arr = call.getArray("tracks")
        if (arr == null || arr.length() == 0) { call.resolve(); return }
        Thread {
            val max = minOf(arr.length(), call.getInt("limit") ?: 5)
            for (i in 0 until max) {
                val track = parseTrack(arr.optJSONObject(i), i) ?: continue
                val vid = track.videoId
                if (vid != null && vid.length == 11) NativeYouTubeResolver.resolve(vid, nativeTimeoutMs = 5200L)
            }
            call.resolve()
        }.start()
    }

    private fun startProgress() {
        stopProgress()
        val r = object : Runnable {
            override fun run() {
                val p = service()?.player ?: return
                if (!p.isPlaying) {
                    stopProgress()
                    return
                }
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
        playGeneration.incrementAndGet()
        val url = call.getString("url")
        if (url.isNullOrBlank()) { call.reject("missing url"); return }
        ensureNotificationPermissionBestEffort()
        val title = call.getString("title") ?: ""
        val artist = call.getString("artist") ?: ""
        val artwork = call.getString("artworkUrl")
        Log.d("ExoPlayerPlugin", "play() title=$title url=${url.take(80)}...")

        val performPlay: () -> Unit = {
            val player = service()?.player
            if (player == null) {
                Log.e("ExoPlayerPlugin", "service ready but player == null")
                isStartingUp = false
                notifyListeners("playbackError", JSObject().put("message", "ExoPlayer player not ready"))
                call.reject("ExoPlayer player not ready")
            } else {
                isStartingUp = true
                ensureListener(null)
                stopProgress()
                val metadata = MediaMetadata.Builder()
                    .setTitle(title)
                    .setArtist(artist)
                    .apply { if (!artwork.isNullOrBlank()) setArtworkUri(Uri.parse(artwork)) }
                    .build()
                val item = MediaItem.Builder()
                    .setUri(Uri.parse(url))
                    .setMediaMetadata(metadata)
                    .build()
                player.stop()
                player.clearMediaItems()
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
                isStartingUp = false
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
        playGeneration.incrementAndGet()
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
        try {
            context.applicationContext.unbindService(connection)
        } catch (_: Throwable) {}
        serviceConnected = false
        super.handleOnDestroy()
    }
}

