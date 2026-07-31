package com.universeflow.app

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.audiofx.BassBoost
import android.media.audiofx.Equalizer
import android.media.audiofx.EnvironmentalReverb
import android.media.audiofx.LoudnessEnhancer
import android.media.audiofx.Virtualizer
import android.net.wifi.WifiManager
import android.os.PowerManager
import androidx.media3.common.AudioAttributes
import androidx.media3.common.AuxEffectInfo
import androidx.media3.common.C
import androidx.media3.common.Player
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.audio.AudioSink
import androidx.media3.exoplayer.audio.DefaultAudioSink
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.session.CacheBitmapLoader
import androidx.media3.session.DefaultMediaNotificationProvider
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import androidx.media3.datasource.DataSourceBitmapLoader

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
@OptIn(UnstableApi::class)
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
    var environmentalReverb: EnvironmentalReverb? = null
        private set

    // Persisted audio-effect state — survives audio-session rebinds so the
    // user's EQ / bass / virtualizer / loudness settings stick across every
    // song change. Without this, ExoPlayer's per-track session-id changes
    // silently reset the Equalizer to flat and users hear no effect.
    @Volatile var eqEnabled: Boolean = true
    val savedEqBands: MutableMap<Short, Short> = java.util.concurrent.ConcurrentHashMap()
    @Volatile var savedBassBoostStrength: Short = 0
    @Volatile var savedVirtualizerStrength: Short = 0
    @Volatile var savedLoudnessGainMb: Int = 0
    @Volatile var savedReverbAmount: Int = 0
    @Volatile var savedVocalMix: Int = 100
    @Volatile var savedInstrumentalMix: Int = 100

    private val stemAudioProcessor = StemAudioProcessor()

    private var boundSessionId: Int = C.AUDIO_SESSION_ID_UNSET

    private var mediaSession: MediaSession? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private var wifiLock: WifiManager.WifiLock? = null

    override fun onCreate() {
        super.onCreate()

        restoreEffectState()

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

        val renderersFactory = object : DefaultRenderersFactory(this@ExoPlayerService) {
            override fun buildAudioSink(
                context: Context,
                enableFloatOutput: Boolean,
                enableAudioTrackPlaybackParams: Boolean,
            ): AudioSink? {
                return DefaultAudioSink.Builder(context)
                    .setAudioProcessors(arrayOf<AudioProcessor>(stemAudioProcessor))
                    // Float output bypasses PCM-16 processors, which silently
                    // disabled vocal/beat isolation on some devices. Force the
                    // 16-bit path so the stem processor always runs.
                    .setEnableFloatOutput(false)
                    .setEnableAudioTrackPlaybackParams(enableAudioTrackPlaybackParams)
                    .build()
            }
        }

        // Prewarm the InnerTube connection so first-tap latency is minimal.
        NativeYouTubeResolver.warm()

        val builder = ExoPlayer.Builder(this)
            .setRenderersFactory(renderersFactory)
            .setMediaSourceFactory(mediaSourceFactory)
            .setAudioAttributes(audioAttrs, /* handleAudioFocus */ true)
            .setHandleAudioBecomingNoisy(true)
            .setWakeMode(C.WAKE_MODE_NETWORK)
            .setPauseAtEndOfMediaItems(false)

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

        // Rich Spotify-style artwork on the lock screen / shade notification:
        // wrap the default context-backed bitmap loader in an in-memory cache
        // so artwork renders instantly on track transitions and survives
        // session rebinds. Uses the (Context) constructor which internally
        // provides a ListeningExecutorService + default HTTP DataSource.
        try {
            val bitmapLoader = CacheBitmapLoader(DataSourceBitmapLoader(this))
            sessionBuilder.setBitmapLoader(bitmapLoader)
        } catch (t: Throwable) {
            android.util.Log.w("ExoPlayerService", "bitmap loader install failed: ${t.message}")
        }

        this.player = exo
        this.mediaSession = sessionBuilder.build()

        // Explicitly install the default media notification provider so the
        // lock screen / status bar player ALWAYS appears as soon as playback
        // starts (some devices skip the auto-install path).
        try {
            val provider = DefaultMediaNotificationProvider.Builder(this)
                .setChannelId("uf_playback")
                .setChannelName(androidx.media3.session.R.string.default_notification_channel_name)
                .setNotificationId(8801)
                .build()
            provider.setSmallIcon(R.mipmap.ic_launcher)
            setMediaNotificationProvider(provider)
        } catch (t: Throwable) {
            android.util.Log.w("ExoPlayerService", "notification provider install failed: ${t.message}")
        }

        ensureEffectsBound()

        ServiceRegistry.exoService = this
    }

    /** (Re)bind AudioEffects to the current player's session id. */
    @Synchronized
    fun ensureEffectsBound() {
        val sid = player?.audioSessionId ?: return
        if (sid == C.AUDIO_SESSION_ID_UNSET || sid == 0) return
        // Optional AudioEffect implementations vary by manufacturer. Do not
        // repeatedly tear down the working EQ just because (for example) a
        // device does not implement Virtualizer or LoudnessEnhancer.
        if (sid == boundSessionId) return

        releaseEffects()
        try {
            equalizer = Equalizer(1, sid).apply {
                enabled = eqEnabled
                // Re-apply every previously saved band level so user EQ
                // survives per-song audio-session rebinds.
                try {
                    val range = bandLevelRange
                    val min = range[0].toInt()
                    val max = range[1].toInt()
                    for ((band, level) in savedEqBands) {
                        val clamped = level.toInt().coerceIn(min, max).toShort()
                        try { setBandLevel(band, clamped) } catch (_: Throwable) {}
                    }
                } catch (_: Throwable) {}
            }
        } catch (_: Throwable) { equalizer = null }
        try {
            bassBoost = BassBoost(1, sid).apply {
                if (savedBassBoostStrength > 0) {
                    enabled = true
                    if (strengthSupported) try { setStrength(savedBassBoostStrength) } catch (_: Throwable) {}
                } else enabled = false
            }
        } catch (_: Throwable) { bassBoost = null }
        try {
            virtualizer = Virtualizer(1, sid).apply {
                if (savedVirtualizerStrength > 0) {
                    enabled = true
                    if (strengthSupported) try { setStrength(savedVirtualizerStrength) } catch (_: Throwable) {}
                } else enabled = false
            }
        } catch (_: Throwable) { virtualizer = null }
        try {
            loudnessEnhancer = LoudnessEnhancer(sid).apply {
                if (savedLoudnessGainMb > 0) {
                    try { setTargetGain(savedLoudnessGainMb) } catch (_: Throwable) {}
                    enabled = true
                } else enabled = false
            }
        } catch (_: Throwable) { loudnessEnhancer = null }
        try {
            environmentalReverb = EnvironmentalReverb(1, 0).apply {
                applyReverbParameters(this, savedReverbAmount)
            }
            if (savedReverbAmount > 0) {
                player?.setAuxEffectInfo(AuxEffectInfo(environmentalReverb!!.id, savedReverbAmount / 100f))
            }
        } catch (_: Throwable) { environmentalReverb = null }
        boundSessionId = sid
    }

    fun applyReverb(amount: Int) {
        savedReverbAmount = amount.coerceIn(0, 100)
        val effect = environmentalReverb
        if (effect != null) {
            try {
                applyReverbParameters(effect, savedReverbAmount)
                player?.setAuxEffectInfo(
                    if (savedReverbAmount > 0) AuxEffectInfo(effect.id, savedReverbAmount / 100f)
                    else AuxEffectInfo(0, 0f)
                )
            } catch (_: Throwable) {}
        }
        persistEffectState()
    }

    fun applyStemMix(vocalMix: Int, instrumentalMix: Int) {
        savedVocalMix = vocalMix.coerceIn(0, 100)
        savedInstrumentalMix = instrumentalMix.coerceIn(0, 100)
        stemAudioProcessor.setStemMix(savedVocalMix, savedInstrumentalMix)
        persistEffectState()
    }

    private fun applyReverbParameters(effect: EnvironmentalReverb, amount: Int) {
        val wet = amount.coerceIn(0, 100)
        effect.enabled = wet > 0
        if (wet <= 0) return
        effect.roomLevel = (-6000 + wet * 50).coerceIn(-6000, -1000).toShort()
        effect.reverbLevel = (-6000 + wet * 65).coerceIn(-6000, 500).toShort()
        effect.decayTime = (500 + wet * 75).coerceIn(100, 8000)
        effect.decayHFRatio = (500 + wet * 5).coerceIn(100, 1000).toShort()
        effect.diffusion = (400 + wet * 6).coerceIn(0, 1000).toShort()
        effect.density = (500 + wet * 5).coerceIn(0, 1000).toShort()
    }

    fun persistEffectState() {
        try {
            val bands = savedEqBands.entries.joinToString(",") { "${it.key}:${it.value}" }
            getSharedPreferences("uf_native_eq", MODE_PRIVATE).edit()
                .putBoolean("enabled", eqEnabled)
                .putString("bands", bands)
                .putInt("bass", savedBassBoostStrength.toInt())
                .putInt("virtualizer", savedVirtualizerStrength.toInt())
                .putInt("loudness", savedLoudnessGainMb)
                .putInt("reverb", savedReverbAmount)
                .putInt("vocalMix", savedVocalMix)
                .putInt("instrumentalMix", savedInstrumentalMix)
                .apply()
        } catch (_: Throwable) {}
    }

    private fun restoreEffectState() {
        try {
            val prefs = getSharedPreferences("uf_native_eq", MODE_PRIVATE)
            eqEnabled = prefs.getBoolean("enabled", true)
            savedBassBoostStrength = prefs.getInt("bass", 0).coerceIn(0, 1000).toShort()
            savedVirtualizerStrength = prefs.getInt("virtualizer", 0).coerceIn(0, 1000).toShort()
            savedLoudnessGainMb = prefs.getInt("loudness", 0).coerceIn(0, 2000)
            savedReverbAmount = prefs.getInt("reverb", 0).coerceIn(0, 100)
            savedVocalMix = prefs.getInt("vocalMix", 100).coerceIn(0, 100)
            savedInstrumentalMix = prefs.getInt("instrumentalMix", 100).coerceIn(0, 100)
            stemAudioProcessor.setStemMix(savedVocalMix, savedInstrumentalMix)
            prefs.getString("bands", null)?.split(',')?.forEach { entry ->
                val pair = entry.split(':')
                if (pair.size == 2) {
                    val band = pair[0].toShortOrNull()
                    val level = pair[1].toShortOrNull()
                    if (band != null && level != null) savedEqBands[band] = level
                }
            }
        } catch (_: Throwable) {}
    }

    private fun releaseEffects() {
        try { equalizer?.release() } catch (_: Throwable) {}
        try { bassBoost?.release() } catch (_: Throwable) {}
        try { virtualizer?.release() } catch (_: Throwable) {}
        try { loudnessEnhancer?.release() } catch (_: Throwable) {}
        try { environmentalReverb?.release() } catch (_: Throwable) {}
        equalizer = null
        bassBoost = null
        virtualizer = null
        loudnessEnhancer = null
        environmentalReverb = null
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
        // NEVER stop the service on swipe-away if the player has any content
        // loaded — user must be able to resume from lock screen / notification.
        val p = player
        if (p == null || p.mediaItemCount == 0) {
            stopSelf()
        }
        super.onTaskRemoved(rootIntent)
    }

    override fun onDestroy() {
        ServiceRegistry.exoService = null
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
