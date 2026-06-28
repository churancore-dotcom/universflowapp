package com.universeflow.app

import android.app.PendingIntent
import android.content.Intent
import android.content.pm.PackageManager
import android.net.wifi.WifiManager
import android.os.PowerManager
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService

/**
 * Media3 ExoPlayer-backed MediaSessionService.
 *
 * Replaces the old WebView HTML5 audio path so playback survives screen lock
 * and Doze. The system pins this service in the foreground as long as the
 * MediaSession reports an active playing state.
 */
class ExoPlayerService : MediaSessionService() {

    companion object {
        private const val WAKELOCK_TAG = "UniverseFlow::ExoWakeLock"
        private const val WIFILOCK_TAG = "UniverseFlow::ExoWifiLock"
        private const val WAKELOCK_TIMEOUT_MS = 4L * 60L * 60L * 1000L
    }

    var player: ExoPlayer? = null
        private set

    private var mediaSession: MediaSession? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private var wifiLock: WifiManager.WifiLock? = null

    override fun onCreate() {
        super.onCreate()

        val audioAttrs = AudioAttributes.Builder()
            .setUsage(C.USAGE_MEDIA)
            .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
            .build()

        val exo = ExoPlayer.Builder(this)
            .setAudioAttributes(audioAttrs, /* handleAudioFocus */ true)
            .setHandleAudioBecomingNoisy(true)
            .setWakeMode(C.WAKE_MODE_NETWORK)
            .build()

        exo.addListener(object : androidx.media3.common.Player.Listener {
            override fun onIsPlayingChanged(isPlaying: Boolean) {
                if (isPlaying) acquireLocks() else releaseLocks()
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

        // Expose to the plugin without static plumbing.
        ServiceRegistry.exoService = this
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
        try { mediaSession?.run { player.release(); release() } } catch (_: Throwable) {}
        mediaSession = null
        player = null
        releaseLocks()
        super.onDestroy()
    }
}

/** Tiny static holder so the plugin can reach the service instance. */
object ServiceRegistry {
    @Volatile var exoService: ExoPlayerService? = null
}
