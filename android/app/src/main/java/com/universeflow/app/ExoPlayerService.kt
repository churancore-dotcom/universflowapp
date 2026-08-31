package com.universeflow.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
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
        const val NOTIFICATION_CHANNEL_ID = "uf_playback"
        const val NOTIFICATION_ID = 8801
        // Smoothed effect-ramp shape (see applySavedEffectsToBoundSession).
        private const val TICK_MS = 30L
        private const val EQ_STEP_MB = 120          // ~1.2 dB per tick
        private const val STRENGTH_STEP = 90        // of 0..1000
        private const val LOUDNESS_STEP_MB = 150
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

    /** Our own device-independent 10-band EQ (see PcmEqualizer). */
    val pcmEqualizer: PcmEqualizer get() = stemAudioProcessor.equalizer

    /**
     * Push saved band levels into the PCM equalizer. Unlike the vendor
     * AudioFX equalizer this is not tied to the audio session id, so nothing
     * has to be re-applied on a per-song session rebind.
     */
    fun applyPcmEq() {
        pcmEqualizer.setEnabled(eqEnabled)
        for (i in 0 until PcmEqualizer.BAND_COUNT) {
            pcmEqualizer.setBandMillibels(i, savedEqBands[i.toShort()]?.toInt() ?: 0)
        }
    }

    private var boundSessionId: Int = C.AUDIO_SESSION_ID_UNSET
    private val appliedEqBands: MutableMap<Short, Short> = HashMap()
    private var appliedEqEnabled: Boolean? = null
    private var appliedBass: Short? = null
    private var appliedVirtualizer: Short? = null
    private var appliedLoudness: Int? = null
    private var appliedReverb: Int? = null

    private var mediaSession: MediaSession? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private var wifiLock: WifiManager.WifiLock? = null

    override fun onCreate() {
        super.onCreate()

        // Promote to the foreground with a placeholder notification BEFORE the
        // player and session exist. On Android 12+ a service started from the
        // background is killed (ForegroundServiceStartNotAllowed / ANR) if it
        // waits for Media3 to publish its own notification — this is what makes
        // background playback survive screen-off and app-swipe reliably.
        promoteToForegroundEarly()

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

        // Echo-style load control: a very low `bufferForPlayback` is the single
        // biggest instant-start lever (playback begins after ~0.75s of audio),
        // while min == max caps prefetch so long queues never balloon memory.
        val loadControl = androidx.media3.exoplayer.DefaultLoadControl.Builder()
            .setBufferDurationsMs(50_000, 50_000, 750, 2_000)
            .build()

        val builder = ExoPlayer.Builder(this)
            .setRenderersFactory(renderersFactory)
            .setMediaSourceFactory(mediaSourceFactory)
            .setLoadControl(loadControl)
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
                ensureEffectsBound(forceReapply = playbackState == Player.STATE_READY)
                if (playbackState == Player.STATE_READY) refreshMediaNotification()
            }
            override fun onIsPlayingChanged(isPlaying: Boolean) {
                if (isPlaying || (exo.playWhenReady && exo.playbackState == Player.STATE_BUFFERING)) acquireLocks() else releaseLocks()
                ensureEffectsBound()
                refreshMediaNotification()
            }
            override fun onAudioSessionIdChanged(audioSessionId: Int) {
                ensureEffectsBound()
            }
            override fun onMediaMetadataChanged(mediaMetadata: androidx.media3.common.MediaMetadata) {
                // Title/artwork arrived — repaint the shade/lock-screen player.
                refreshMediaNotification()
            }
            override fun onMediaItemTransition(
                mediaItem: androidx.media3.common.MediaItem?,
                reason: Int,
            ) {
                // Echo-style look-ahead: pre-resolve the next two queue items so
                // the ResolvingDataSource never blocks on the network at the
                // moment of transition (gapless, instant next-track start).
                preloadUpcoming(exo, 2)
                refreshMediaNotification()
            }
        })



        val sessionActivity = packageManager.getLaunchIntentForPackage(packageName)?.let {
            it.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
            PendingIntent.getActivity(
                this,
                0,
                it,
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
        }

        val sessionBuilder = MediaSession.Builder(this, exo)
            .setId("universflow")
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

        // Create the playback notification channel up front. Media3 creates one
        // lazily, but doing it here guarantees the lock-screen / shade player
        // exists the instant playback starts (and gives it a real name).
        try {
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                val manager = getSystemService(NotificationManager::class.java)
                val channel = NotificationChannel(
                    NOTIFICATION_CHANNEL_ID,
                    "Playback",
                    NotificationManager.IMPORTANCE_LOW,
                ).apply {
                    description = "Now playing controls"
                    setShowBadge(false)
                    lockscreenVisibility = Notification.VISIBILITY_PUBLIC
                    setSound(null, null)
                    enableVibration(false)
                }
                manager?.createNotificationChannel(channel)
            }
        } catch (t: Throwable) {
            android.util.Log.w("ExoPlayerService", "channel create failed: ${t.message}")
        }

        // Explicitly install the default media notification provider so the
        // lock screen / status bar player ALWAYS appears as soon as playback
        // starts (some devices skip the auto-install path).
        try {
            val provider = DefaultMediaNotificationProvider.Builder(this)
                .setChannelId(NOTIFICATION_CHANNEL_ID)
                .setChannelName(androidx.media3.session.R.string.default_notification_channel_name)
                .setNotificationId(NOTIFICATION_ID)
                .build()
            // A monochrome silhouette — using the launcher mipmap here renders
            // as a grey blob in the status bar on most devices.
            provider.setSmallIcon(R.drawable.ic_stat_music)
            setMediaNotificationProvider(provider)
        } catch (t: Throwable) {
            android.util.Log.w("ExoPlayerService", "notification provider install failed: ${t.message}")
        }

        ensureEffectsBound()

        ServiceRegistry.exoService = this
    }

    /**
     * Minimal channel + foreground promotion used before the media session is
     * ready. Media3 replaces this notification (same id) as soon as it renders
     * the real player, so the user never sees the placeholder.
     */
    private fun promoteToForegroundEarly() {
        try {
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                val manager = getSystemService(NotificationManager::class.java)
                val channel = NotificationChannel(
                    NOTIFICATION_CHANNEL_ID,
                    "Playback",
                    NotificationManager.IMPORTANCE_LOW,
                ).apply {
                    setShowBadge(false)
                    lockscreenVisibility = Notification.VISIBILITY_PUBLIC
                    setSound(null, null)
                    enableVibration(false)
                }
                manager?.createNotificationChannel(channel)
            }
            val placeholder = androidx.core.app.NotificationCompat.Builder(this, NOTIFICATION_CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_stat_music)
                .setContentTitle(getString(R.string.app_name))
                .setContentText(getString(R.string.preparing_playback))
                .setCategory(androidx.core.app.NotificationCompat.CATEGORY_TRANSPORT)
                .setVisibility(androidx.core.app.NotificationCompat.VISIBILITY_PUBLIC)
                .setOnlyAlertOnce(true)
                .setOngoing(true)
                .setSilent(true)
                .build()
            startForeground(NOTIFICATION_ID, placeholder)
        } catch (t: Throwable) {
            android.util.Log.w("ExoPlayerService", "early foreground failed: ${t.message}")
        }
    }

    /** Pre-resolve the next [count] queue items so transitions never stall. */
    private fun preloadUpcoming(exo: ExoPlayer, count: Int) {
        try {
            val tracks = ArrayList<Triple<String?, String?, String?>>()
            var index = exo.nextMediaItemIndex
            var remaining = count
            while (index != C.INDEX_UNSET && remaining > 0 && index < exo.mediaItemCount) {
                val uri = exo.getMediaItemAt(index).localConfiguration?.uri
                if (uri != null && uri.scheme == "yt") {
                    tracks.add(
                        Triple(
                            uri.host,
                            uri.getQueryParameter("title"),
                            uri.getQueryParameter("artist"),
                        ),
                    )
                }
                index += 1
                remaining -= 1
            }
            if (tracks.isNotEmpty()) MasterResolver.prefetch(tracks, tracks.size)
        } catch (_: Throwable) {}
    }

    /**
     * Force Media3 to (re)publish the MediaStyle notification for the current
     * session. Without this, the plain "Preparing your music…" placeholder that
     * promotes the service to the foreground can stay on screen for the whole
     * session on devices where Media3's own update path does not fire, so the
     * user gets no transport controls in the shade or on the lock screen.
     * Posted to the main thread because notification updates must run there.
     */
    private fun refreshMediaNotification() {
        val session = mediaSession ?: return
        val post = Runnable {
            try { onUpdateNotification(session, true) } catch (_: Throwable) {}
        }
        try {
            if (android.os.Looper.myLooper() == android.os.Looper.getMainLooper()) post.run()
            else android.os.Handler(android.os.Looper.getMainLooper()).post(post)
        } catch (_: Throwable) {}
    }

    /**
     * Keep the media notification alive while paused so the user can resume
     * from the lock screen / shade instead of the player vanishing on pause.
     */
    override fun onUpdateNotification(session: MediaSession, startInForegroundRequired: Boolean) {
        super.onUpdateNotification(session, true)
    }




    /** (Re)bind AudioEffects to the current player's session id. */
    @Synchronized
    fun ensureEffectsBound(forceReapply: Boolean = false) {
        val sid = player?.audioSessionId ?: return
        if (sid == C.AUDIO_SESSION_ID_UNSET || sid == 0) return
        // Optional AudioEffect implementations vary by manufacturer. Do not
        // repeatedly tear down the working EQ just because (for example) a
        // device does not implement Virtualizer or LoudnessEnhancer.
        if (sid == boundSessionId) {
            if (forceReapply) scheduleEffectRamp()
            return
        }

        releaseEffects()
        // No vendor Equalizer: bands run through PcmEqualizer inside the PCM
        // pipeline so every device behaves identically.
        equalizer = null
        applyPcmEq()
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

    // ---- Smoothed parameter ramps ----
    //
    // Writing a new band level / strength in one jump makes the DSP change its
    // filter coefficients instantly, which is audible as a click ("zipper
    // noise") and on some Qualcomm/MTK devices briefly starves the audio track
    // enough to stall playback. Every parameter now walks to its target in
    // small steps on a 30ms tick, so a slider drag is heard as a smooth sweep.
    private val effectHandler = android.os.Handler(android.os.Looper.getMainLooper())
    private val rampTick = Runnable { applySavedEffectsToBoundSession() }
    private var rampScheduled = false

    private fun stepToward(current: Int, target: Int, step: Int): Int {
        if (current == target) return target
        return if (target > current) minOf(target, current + step) else maxOf(target, current - step)
    }

    private fun applySavedEffectsToBoundSession() {
        var settled = true
        try {
            bassBoost?.let { effect ->
                val target = savedBassBoostStrength.toInt()
                val current = appliedBass?.toInt() ?: target
                val next = stepToward(current, target, STRENGTH_STEP)
                if (next != current || appliedBass == null) {
                    // Keep the effect enabled while ramping down to 0 so the
                    // final step is a fade, not an abrupt bypass switch.
                    effect.enabled = next > 0 || target > 0
                    if (effect.enabled && effect.strengthSupported) effect.setStrength(next.toShort())
                    if (next == 0 && target == 0) effect.enabled = false
                    appliedBass = next.toShort()
                }
                if (next != target) settled = false
            }
            virtualizer?.let { effect ->
                val target = savedVirtualizerStrength.toInt()
                val current = appliedVirtualizer?.toInt() ?: target
                val next = stepToward(current, target, STRENGTH_STEP)
                if (next != current || appliedVirtualizer == null) {
                    effect.enabled = next > 0 || target > 0
                    if (effect.enabled && effect.strengthSupported) effect.setStrength(next.toShort())
                    if (next == 0 && target == 0) effect.enabled = false
                    appliedVirtualizer = next.toShort()
                }
                if (next != target) settled = false
            }
            loudnessEnhancer?.let { effect ->
                val target = savedLoudnessGainMb
                val current = appliedLoudness ?: target
                val next = stepToward(current, target, LOUDNESS_STEP_MB)
                if (next != current || appliedLoudness == null) {
                    effect.enabled = next > 0 || target > 0
                    if (effect.enabled) effect.setTargetGain(next)
                    if (next == 0 && target == 0) effect.enabled = false
                    appliedLoudness = next
                }
                if (next != target) settled = false
            }
        } catch (_: Throwable) { settled = true }

        rampScheduled = false
        if (!settled) {
            rampScheduled = true
            effectHandler.postDelayed(rampTick, TICK_MS)
        }
    }

    /** Schedule one ramp pass; repeat calls while a ramp is running are free. */
    private fun scheduleEffectRamp() {
        if (rampScheduled) return
        rampScheduled = true
        effectHandler.post(rampTick)
    }


    fun applyReverb(amount: Int) {
        savedReverbAmount = amount.coerceIn(0, 100)
        stemAudioProcessor.setEnhancements(
            savedVirtualizerStrength.toInt(),
            savedVirtualizerStrength.toInt(),
            savedLoudnessGainMb,
            savedReverbAmount,
        )
        if (appliedReverb == savedReverbAmount) return
        // The vendor EnvironmentalReverb aux bus is intentionally left off: it
        // stacks on our own RoomReverb and its per-device voicing is what made
        // Studio Spaces sound like a muddy fade instead of a real room.
        try { player?.setAuxEffectInfo(AuxEffectInfo(0, 0f)) } catch (_: Throwable) {}
        try { environmentalReverb?.enabled = false } catch (_: Throwable) {}
        appliedReverb = savedReverbAmount
        persistEffectState()
    }

    /** Studio Space voicing (room size, damping, wet, width, pre-delay). */
    fun applySpace(room: Int, damping: Int, wet: Int, width: Int, preDelayMs: Int, size: Int) {
        stemAudioProcessor.setSpace(room, damping, wet, width, preDelayMs, size)
    }


    fun applyStemMix(vocalMix: Int, instrumentalMix: Int, persist: Boolean = true) {
        savedVocalMix = vocalMix.coerceIn(0, 100)
        savedInstrumentalMix = instrumentalMix.coerceIn(0, 100)
        stemAudioProcessor.setStemMix(savedVocalMix, savedInstrumentalMix)
        if (persist) persistEffectState()
    }

    fun applyPcmEnhancements(spatialStrength: Int, surroundStrength: Int, lateNightGainMb: Int, reverbAmount: Int = savedReverbAmount) {
        stemAudioProcessor.setEnhancements(spatialStrength, surroundStrength, lateNightGainMb, reverbAmount)
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
            stemAudioProcessor.setEnhancements(
                savedVirtualizerStrength.toInt(),
                savedVirtualizerStrength.toInt(),
                savedLoudnessGainMb,
                savedReverbAmount,
            )
            prefs.getString("bands", null)?.split(',')?.forEach { entry ->
                val pair = entry.split(':')
                if (pair.size == 2) {
                    val band = pair[0].toShortOrNull()
                    val level = pair[1].toShortOrNull()
                    if (band != null && level != null) savedEqBands[band] = level
                }
            }
            applyPcmEq()
        } catch (_: Throwable) {}

    }

    private fun releaseEffects() {
        effectHandler.removeCallbacks(rampTick)
        rampScheduled = false
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
        appliedEqBands.clear()
        appliedEqEnabled = null
        appliedBass = null
        appliedVirtualizer = null
        appliedLoudness = null
        appliedReverb = null
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
