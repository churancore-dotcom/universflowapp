package com.universeflow.app

import android.app.PendingIntent
import android.bluetooth.BluetoothA2dp
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.audiofx.BassBoost
import android.media.audiofx.Equalizer
import android.media.audiofx.LoudnessEnhancer
import android.media.audiofx.Virtualizer
import android.net.wifi.WifiManager
import android.os.Build
import android.os.PowerManager
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.session.DefaultMediaNotificationProvider
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService

/**
 * Media3 ExoPlayer-backed MediaSessionService.
 *
 * Replaces the old WebView HTML5 audio path so playback survives screen lock
 * and Doze. The system pins this service in the foreground as long as the
 * MediaSession reports an active playing state.
 *
 * Audio effects (Equalizer / BassBoost / Virtualizer / LoudnessEnhancer) are
 * bound to the player's audio session id and exposed through ExoPlayerPlugin.
 */
class ExoPlayerService : MediaSessionService() {

    companion object {
        private const val WAKELOCK_TAG = "UniverseFlow::ExoWakeLock"
        private const val WIFILOCK_TAG = "UniverseFlow::ExoWifiLock"
        private const val WAKELOCK_TIMEOUT_MS = 4L * 60L * 60L * 1000L
        private const val HTTP_USER_AGENT = "Mozilla/5.0 (Linux; Android 14; UniverseFlow) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36"
    }

    var player: ExoPlayer? = null
        private set

    // ---- Audio effects (lazy on first session-id discovery) ----
    var equalizer: Equalizer? = null
        private set
    var bassBoost: BassBoost? = null
        private set
    var virtualizer: Virtualizer? = null
        private set
    var loudnessEnhancer: LoudnessEnhancer? = null
        private set

    private var boundSessionId: Int = C.AUDIO_SESSION_ID_UNSET

    private var mediaSession: MediaSession? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private var wifiLock: WifiManager.WifiLock? = null
    private var smartReceiver: BroadcastReceiver? = null
    private var pausedByBtDisconnect: Boolean = false

    override fun onCreate() {
        super.onCreate()

        val audioAttrs = AudioAttributes.Builder()
            .setUsage(C.USAGE_MEDIA)
            .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
            .build()

        // Force a stable audio session id BEFORE prepare() so AudioEffects can
        // bind on first play with no race.
        val sessionId = try {
            C.generateAudioSessionIdV21(this)
        } catch (_: Throwable) {
            C.AUDIO_SESSION_ID_UNSET
        }

        // Echo-style media pipeline: yt://<videoId> URIs are resolved lazily by
        // InnerTube on-device, and resolved audio is persisted in a 512MB LRU
        // disk cache so replays are instant and expired URLs auto-refresh.
        val mediaSourceFactory = NativeMediaSourceFactory.build(this)

        // Prewarm the InnerTube connection so first-tap latency is minimal.
        NativeYouTubeResolver.warm()

        val builder = ExoPlayer.Builder(this)
            .setMediaSourceFactory(mediaSourceFactory)
            .setAudioAttributes(audioAttrs, /* handleAudioFocus */ true)
            .setHandleAudioBecomingNoisy(true)
            .setWakeMode(C.WAKE_MODE_NETWORK)

        val exo = builder.build().also { p ->
            if (sessionId != C.AUDIO_SESSION_ID_UNSET) {
                try { p.setAudioSessionId(sessionId) } catch (_: Throwable) {}
            }
        }

        exo.addListener(object : androidx.media3.common.Player.Listener {
            override fun onPlaybackStateChanged(playbackState: Int) {
                if (exo.playWhenReady && playbackState == Player.STATE_BUFFERING) acquireLocks()
                if (playbackState == Player.STATE_ENDED || playbackState == Player.STATE_IDLE) releaseLocks()
                ensureEffectsBound()
            }
            override fun onIsPlayingChanged(isPlaying: Boolean) {
                if (isPlaying || (exo.playWhenReady && exo.playbackState == Player.STATE_BUFFERING)) acquireLocks() else releaseLocks()
                ensureEffectsBound()
            }
            override fun onAudioSessionIdChanged(audioSessionId: Int) {
                ensureEffectsBound()
            }
        })

        val sessionActivity = packageManager.getLaunchIntentForPackage(packageName)?.let {
            PendingIntent.getActivity(
                this,
                0,
                it,
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
        }

        val sessionBuilder = MediaSession.Builder(this, exo)
        sessionActivity?.let { sessionBuilder.setSessionActivity(it) }

        this.player = exo
        this.mediaSession = sessionBuilder.build()

        ensureEffectsBound()
        registerSmartPlaybackReceiver()

        ServiceRegistry.exoService = this
    }

    /**
     * Resume-on-Bluetooth smart playback.
     * IMPORTANT: volume=0 must NOT pause the player — screen recordings and
     * some Android builds dispatch transient zero-volume broadcasts while the
     * app is locked/backgrounded, which looked exactly like background audio
     * being killed.
     * Listens for A2DP connect/disconnect.
     */
    private fun registerSmartPlaybackReceiver() {
        smartReceiver = object : BroadcastReceiver() {
            override fun onReceive(ctx: Context?, intent: Intent?) {
                val p = player ?: return
                when (intent?.action) {
                    BluetoothA2dp.ACTION_CONNECTION_STATE_CHANGED -> {
                        val state = intent.getIntExtra(BluetoothA2dp.EXTRA_STATE, -1)
                        when (state) {
                            BluetoothA2dp.STATE_DISCONNECTED -> {
                                if (p.isPlaying) {
                                    pausedByBtDisconnect = true
                                    p.pause()
                                }
                            }
                            BluetoothA2dp.STATE_CONNECTED -> {
                                if (pausedByBtDisconnect && !p.isPlaying) {
                                    pausedByBtDisconnect = false
                                    p.play()
                                }
                            }
                        }
                    }
                }
            }
        }
        val filter = IntentFilter().apply {
            addAction(BluetoothA2dp.ACTION_CONNECTION_STATE_CHANGED)
        }
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                // Bluetooth broadcasts are sent by privileged system components.
                // NOT_EXPORTED blocks some Android 13+ devices from delivering
                // them, which made Smart Playback inconsistent.
                registerReceiver(smartReceiver, filter, Context.RECEIVER_EXPORTED)
            } else {
                @Suppress("UnspecifiedRegisterReceiverFlag")
                registerReceiver(smartReceiver, filter)
            }
        } catch (_: Throwable) { /* noop */ }
    }

    /** (Re)bind AudioEffects to the current player's session id. */
    @Synchronized
    fun ensureEffectsBound() {
        val sid = player?.audioSessionId ?: return
        if (sid == C.AUDIO_SESSION_ID_UNSET || sid == 0) return
        if (sid == boundSessionId
            && equalizer != null && bassBoost != null
            && virtualizer != null && loudnessEnhancer != null) return

        releaseEffects()
        try {
            equalizer = Equalizer(0, sid).apply { enabled = true }
        } catch (_: Throwable) { equalizer = null }
        try {
            bassBoost = BassBoost(0, sid).apply { enabled = false }
        } catch (_: Throwable) { bassBoost = null }
        try {
            virtualizer = Virtualizer(0, sid).apply { enabled = false }
        } catch (_: Throwable) { virtualizer = null }
        try {
            loudnessEnhancer = LoudnessEnhancer(sid).apply { enabled = false }
        } catch (_: Throwable) { loudnessEnhancer = null }
        boundSessionId = sid
    }

    private fun releaseEffects() {
        try { equalizer?.release() } catch (_: Throwable) {}
        try { bassBoost?.release() } catch (_: Throwable) {}
        try { virtualizer?.release() } catch (_: Throwable) {}
        try { loudnessEnhancer?.release() } catch (_: Throwable) {}
        equalizer = null
        bassBoost = null
        virtualizer = null
        loudnessEnhancer = null
        boundSessionId = C.AUDIO_SESSION_ID_UNSET
    }

    private fun acquireLocks() {
        try {
            if (wakeLock == null) {
                val pm = getSystemService(POWER_SERVICE) as PowerManager
                wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, WAKELOCK_TAG).apply {
                    setReferenceCounted(false)
                }
            }
            if (wakeLock?.isHeld != true) wakeLock?.acquire(WAKELOCK_TIMEOUT_MS)

            if (wifiLock == null) {
                val wm = applicationContext.getSystemService(WIFI_SERVICE) as WifiManager
                wifiLock = wm.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, WIFILOCK_TAG).apply {
                    setReferenceCounted(false)
                }
            }
            if (wifiLock?.isHeld != true) wifiLock?.acquire()
        } catch (_: Throwable) { /* noop */ }
    }

    private fun releaseLocks() {
        try { if (wakeLock?.isHeld == true) wakeLock?.release() } catch (_: Throwable) {}
        try { if (wifiLock?.isHeld == true) wifiLock?.release() } catch (_: Throwable) {}
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = mediaSession

    override fun onTaskRemoved(rootIntent: Intent?) {
        val p = player
        if (p == null || !p.playWhenReady || p.mediaItemCount == 0) {
            stopSelf()
        }
        super.onTaskRemoved(rootIntent)
    }

    override fun onDestroy() {
        ServiceRegistry.exoService = null
        try { smartReceiver?.let { unregisterReceiver(it) } } catch (_: Throwable) {}
        smartReceiver = null
        releaseEffects()
        try { mediaSession?.run { player.release(); release() } } catch (_: Throwable) {}
        mediaSession = null
        player = null
        releaseLocks()
        // Keep the SimpleCache alive across service restarts; only release
        // when the process dies. NativeMediaSourceFactory.release() is
        // intentionally NOT called here.
        super.onDestroy()
    }
}

/** Tiny static holder so the plugin can reach the service instance. */
object ServiceRegistry {
    @Volatile var exoService: ExoPlayerService? = null
}
