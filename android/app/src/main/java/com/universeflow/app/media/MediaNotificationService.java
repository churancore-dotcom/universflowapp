package com.universeflow.app.media;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.graphics.BitmapFactory;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.net.wifi.WifiManager;
import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;

import androidx.core.app.NotificationCompat;
import androidx.media.app.NotificationCompat.MediaStyle;
import androidx.media.session.MediaButtonReceiver;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Foreground service that owns a MediaSessionCompat and posts a MediaStyle
 * notification with previous / play-pause / next actions. Visible on the
 * lock screen and the notification shade. Required for Android 14+ media
 * playback foreground service type compliance.
 */
public class MediaNotificationService extends Service {

    public static final String CHANNEL_ID = "uf_media_playback";
    public static final int NOTIFICATION_ID = 4711;

    public static final String ACTION_UPDATE = "uf.media.UPDATE";
    public static final String ACTION_STATE  = "uf.media.STATE";
    public static final String ACTION_STOP   = "uf.media.STOP";
    public static final String ACTION_PLAY   = "uf.media.PLAY";
    public static final String ACTION_PAUSE  = "uf.media.PAUSE";
    public static final String ACTION_NEXT   = "uf.media.NEXT";
    public static final String ACTION_PREV   = "uf.media.PREV";

    private MediaSessionCompat session;
    private String title = "";
    private String artist = "";
    private String album = "";
    private String coverUrl = "";
    private long durationMs = 0L;
    private long positionMs = 0L;
    private boolean isPlaying = false;
    private Bitmap currentArt = null;
    private String loadedArtUrl = null;
    private PowerManager.WakeLock wakeLock = null;
    private WifiManager.WifiLock wifiLock = null;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    private AudioManager audioManager = null;
    private AudioFocusRequest focusRequest = null;
    private boolean noisyReceiverRegistered = false;

    private final BroadcastReceiver noisyReceiver = new BroadcastReceiver() {
        @Override public void onReceive(Context ctx, Intent i) {
            if (AudioManager.ACTION_AUDIO_BECOMING_NOISY.equals(i.getAction())) {
                // Headphones unplugged / BT disconnected — pause like Spotify/YouTube Music.
                MediaNotificationPlugin.emitControlEvent("music-controls-pause");
            }
        }
    };

    private final AudioManager.OnAudioFocusChangeListener focusListener = new AudioManager.OnAudioFocusChangeListener() {
        @Override public void onAudioFocusChange(int change) {
            switch (change) {
                case AudioManager.AUDIOFOCUS_LOSS:
                case AudioManager.AUDIOFOCUS_LOSS_TRANSIENT:
                case AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK:
                    // Phone call, Maps voice, alarm — pause cleanly.
                    MediaNotificationPlugin.emitControlEvent("music-controls-pause");
                    break;
                case AudioManager.AUDIOFOCUS_GAIN:
                    // Don't auto-resume — let the user decide.
                    break;
            }
        }
    };

    private void registerNoisyReceiver() {
        if (noisyReceiverRegistered) return;
        try {
            registerReceiver(noisyReceiver, new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY));
            noisyReceiverRegistered = true;
        } catch (Exception ignore) {}
    }

    private void unregisterNoisyReceiver() {
        if (!noisyReceiverRegistered) return;
        try { unregisterReceiver(noisyReceiver); } catch (Exception ignore) {}
        noisyReceiverRegistered = false;
    }

    private void requestAudioFocus() {
        // The real player is the WebView HTMLAudioElement. This foreground
        // notification service must NOT request audio focus too: on several
        // Android builds that makes the service compete with the WebView from
        // the same app, immediately emitting a pause command after every play.
    }

    private void abandonAudioFocus() {
        // No-op because this service intentionally never owns audio focus.
    }

    private void acquireWakeLockIfNeeded() {
        if (wakeLock != null && wakeLock.isHeld()) return;
        try {
            PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
            if (pm == null) return;
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "UniversFlow:MediaPlayback");
            wakeLock.setReferenceCounted(false);
            // Safety cap — Android allows long-held wake locks but we re-acquire on each track
            wakeLock.acquire(60L * 60L * 1000L);
        } catch (Exception ignore) {}
    }

    private void acquireWifiLockIfNeeded() {
        if (wifiLock != null && wifiLock.isHeld()) return;
        try {
            WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            if (wm == null) return;
            // Battery: WIFI_MODE_FULL is plenty for audio streaming. HIGH_PERF
            // disables Wi-Fi power-save and burns ~4%/hr extra over long sessions.
            wifiLock = wm.createWifiLock(WifiManager.WIFI_MODE_FULL, "UniversFlow:MediaWifi");
            wifiLock.setReferenceCounted(false);
            wifiLock.acquire();
        } catch (Exception ignore) {}
    }

    private void acquirePlaybackLocks() {
        acquireWakeLockIfNeeded();
        acquireWifiLockIfNeeded();
    }

    private void releaseWakeLock() {
        try {
            if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        } catch (Exception ignore) {}
        wakeLock = null;
    }

    private void releaseWifiLock() {
        try {
            if (wifiLock != null && wifiLock.isHeld()) wifiLock.release();
        } catch (Exception ignore) {}
        wifiLock = null;
    }

    private void releasePlaybackLocks() {
        releaseWakeLock();
        releaseWifiLock();
    }

    @Override
    public void onCreate() {
        super.onCreate();
        createChannel();
        session = new MediaSessionCompat(this, "UniversFlowMedia");
        session.setFlags(
            MediaSessionCompat.FLAG_HANDLES_MEDIA_BUTTONS |
            MediaSessionCompat.FLAG_HANDLES_TRANSPORT_CONTROLS
        );
        session.setCallback(new MediaSessionCompat.Callback() {
            @Override public void onPlay()      { MediaNotificationPlugin.emitControlEvent("music-controls-play"); }
            @Override public void onPause()     { MediaNotificationPlugin.emitControlEvent("music-controls-pause"); }
            @Override public void onSkipToNext(){ MediaNotificationPlugin.emitControlEvent("music-controls-next"); }
            @Override public void onSkipToPrevious() { MediaNotificationPlugin.emitControlEvent("music-controls-previous"); }
            @Override public void onStop()      { MediaNotificationPlugin.emitControlEvent("music-controls-destroy"); }
        });
        session.setActive(true);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null || intent.getAction() == null) {
            refresh(false);
            return START_STICKY;
        }
        String action = intent.getAction();

        if (Intent.ACTION_MEDIA_BUTTON.equals(action)) {
            MediaButtonReceiver.handleIntent(session, intent);
            return START_STICKY;
        }

        switch (action) {
            case ACTION_UPDATE: {
                title    = safe(intent.getStringExtra("title"));
                artist   = safe(intent.getStringExtra("artist"));
                album    = safe(intent.getStringExtra("album"));
                coverUrl = safe(intent.getStringExtra("cover"));
                durationMs = intent.getLongExtra("duration", 0L);
                isPlaying = intent.getBooleanExtra("isPlaying", false);
                if (isPlaying) { acquirePlaybackLocks(); requestAudioFocus(); registerNoisyReceiver(); }
                else { releasePlaybackLocks(); unregisterNoisyReceiver(); }
                refresh(true);
                break;
            }
            case ACTION_STATE: {
                isPlaying = intent.getBooleanExtra("isPlaying", isPlaying);
                if (isPlaying) { acquirePlaybackLocks(); requestAudioFocus(); registerNoisyReceiver(); }
                else { releasePlaybackLocks(); unregisterNoisyReceiver(); }
                if (intent.hasExtra("position")) {
                    positionMs = intent.getLongExtra("position", 0L);
                }
                refresh(false);
                break;
            }
            case ACTION_PLAY:  MediaNotificationPlugin.emitControlEvent("music-controls-play");  break;
            case ACTION_PAUSE: MediaNotificationPlugin.emitControlEvent("music-controls-pause"); break;
            case ACTION_NEXT:  MediaNotificationPlugin.emitControlEvent("music-controls-next");  break;
            case ACTION_PREV:  MediaNotificationPlugin.emitControlEvent("music-controls-previous"); break;
            case ACTION_STOP:
                MediaNotificationPlugin.emitControlEvent("music-controls-destroy");
                // CRITICAL: When started via startForegroundService(), Android requires
                // startForeground() to be called within ~5s OR the app crashes with
                // ForegroundServiceDidNotStartInTimeException. Post a minimal
                // notification first, then immediately tear it down.
                ensureForegroundBeforeStop();
                stopForegroundCompat();
                stopSelf();
                return START_NOT_STICKY;
        }
        return START_STICKY;
    }

    private void refresh(boolean reloadArt) {
        // Build & post first using whatever bitmap we have so the foreground
        // notification appears immediately (Android requires startForeground
        // within ~5s of startForegroundService).
        postNotification();
        if (reloadArt && coverUrl != null && coverUrl.length() > 0
                && !coverUrl.equals(loadedArtUrl)) {
            new Thread(() -> {
                Bitmap bmp = downloadBitmap(coverUrl);
                if (bmp != null) {
                    currentArt = bmp;
                    loadedArtUrl = coverUrl;
                    mainHandler.post(this::postNotification);
                }
            }).start();
        }
    }

    private void postNotification() {
        // Update MediaSession metadata + playback state
        MediaMetadataCompat.Builder meta = new MediaMetadataCompat.Builder()
            .putString(MediaMetadataCompat.METADATA_KEY_TITLE, title)
            .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, artist)
            .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, album)
            .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, durationMs);
        if (currentArt != null) {
            meta.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, currentArt);
        }
        session.setMetadata(meta.build());

        long actions = PlaybackStateCompat.ACTION_PLAY
            | PlaybackStateCompat.ACTION_PAUSE
            | PlaybackStateCompat.ACTION_PLAY_PAUSE
            | PlaybackStateCompat.ACTION_SKIP_TO_NEXT
            | PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS
            | PlaybackStateCompat.ACTION_STOP
            | PlaybackStateCompat.ACTION_SEEK_TO;

        PlaybackStateCompat state = new PlaybackStateCompat.Builder()
            .setActions(actions)
            .setState(
                isPlaying ? PlaybackStateCompat.STATE_PLAYING : PlaybackStateCompat.STATE_PAUSED,
                positionMs,
                isPlaying ? 1f : 0f
            )
            .build();
        session.setPlaybackState(state);

        // Build notification
        Intent contentIntent = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent contentPi = contentIntent == null ? null : PendingIntent.getActivity(
            this, 0, contentIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | piFlagImmutable()
        );

        // Resolve a transparent white silhouette icon for the status bar.
        // Android requires monochrome icons (Lollipop+); a colored launcher icon
        // shows as a white square. Falls back to launcher if drawable missing.
        int smallIconRes = getResources().getIdentifier("ic_stat_notify", "drawable", getPackageName());
        if (smallIconRes == 0) smallIconRes = getApplicationInfo().icon;

        NotificationCompat.Builder b = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(smallIconRes)
            .setColor(0xFFFF2D55)
            .setColorized(true)
            .setContentTitle(title.isEmpty() ? "Now Playing" : title)
            .setContentText(artist.isEmpty() ? "UniversFlow" : artist)
            .setLargeIcon(currentArt)
            .setContentIntent(contentPi)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(isPlaying)
            .setShowWhen(false)
            .setOnlyAlertOnce(true);

        if (album != null && !album.isEmpty()) {
            b.setSubText(album);
        }

        b.addAction(new NotificationCompat.Action(
            android.R.drawable.ic_media_previous, "Previous",
            buildActionPi(ACTION_PREV)));
        b.addAction(new NotificationCompat.Action(
            isPlaying ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play,
            isPlaying ? "Pause" : "Play",
            buildActionPi(isPlaying ? ACTION_PAUSE : ACTION_PLAY)));
        b.addAction(new NotificationCompat.Action(
            android.R.drawable.ic_media_next, "Next",
            buildActionPi(ACTION_NEXT)));

        b.setStyle(new MediaStyle()
            .setMediaSession(session.getSessionToken())
            .setShowActionsInCompactView(0, 1, 2));

        Notification notification = b.build();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            try {
                startForeground(
                    NOTIFICATION_ID, notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
                );
            } catch (Exception e) {
                startForeground(NOTIFICATION_ID, notification);
            }
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }

        // When paused, allow user to swipe it away
        if (!isPlaying) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                stopForeground(STOP_FOREGROUND_DETACH);
            } else {
                stopForeground(false);
            }
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (nm != null) nm.notify(NOTIFICATION_ID, notification);
        }

        // Keep the home-screen widget in sync even when the JS layer is asleep.
        syncWidget();
    }

    /** Push current track state to the NowPlayingWidget so it never goes stale. */
    private void syncWidget() {
        try {
            android.content.SharedPreferences.Editor editor = getSharedPreferences(
                "UniversFlowWidgetPrefs", Context.MODE_PRIVATE).edit();
            editor.putString("current_title", title.isEmpty() ? "Not Playing" : title);
            editor.putString("current_artist", artist.isEmpty() ? "Tap to open UniversFlow" : artist);
            editor.putBoolean("is_playing", isPlaying);
            int progress = durationMs > 0 ? (int) ((positionMs * 100L) / durationMs) : 0;
            editor.putInt("progress", Math.max(0, Math.min(100, progress)));
            editor.apply();

            // Broadcast widget update (resolves widget class via package name)
            String pkg = getPackageName();
            try {
                Class<?> widgetCls = Class.forName(pkg + ".widgets.NowPlayingWidget");
                Intent updateIntent = new Intent(this, widgetCls);
                updateIntent.setAction("android.appwidget.action.APPWIDGET_UPDATE");
                android.appwidget.AppWidgetManager mgr = android.appwidget.AppWidgetManager.getInstance(this);
                int[] ids = mgr.getAppWidgetIds(new android.content.ComponentName(this, widgetCls));
                if (ids != null && ids.length > 0) {
                    updateIntent.putExtra(android.appwidget.AppWidgetManager.EXTRA_APPWIDGET_IDS, ids);
                    sendBroadcast(updateIntent);
                }
            } catch (ClassNotFoundException ignore) {}
        } catch (Exception ignore) {}
    }

    private PendingIntent buildActionPi(String action) {
        Intent i = new Intent(this, MediaNotificationService.class).setAction(action);
        return PendingIntent.getService(
            this, action.hashCode(), i,
            PendingIntent.FLAG_UPDATE_CURRENT | piFlagImmutable()
        );
    }

    private int piFlagImmutable() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0;
    }

    private void stopForegroundCompat() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(STOP_FOREGROUND_REMOVE);
        } else {
            stopForeground(true);
        }
        if (session != null) {
            session.setActive(false);
            session.release();
            session = null;
        }
    }

    /**
     * Satisfy Android's startForegroundService → startForeground contract when
     * we're tearing down. Posts a transient notification so the system doesn't
     * crash the process with ForegroundServiceDidNotStartInTimeException.
     */
    private void ensureForegroundBeforeStop() {
        try {
            int smallIconRes = getResources().getIdentifier("ic_stat_notify", "drawable", getPackageName());
            if (smallIconRes == 0) smallIconRes = getApplicationInfo().icon;
            Notification stub = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(smallIconRes)
                .setContentTitle("UniversFlow")
                .setPriority(NotificationCompat.PRIORITY_MIN)
                .setOnlyAlertOnce(true)
                .build();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(NOTIFICATION_ID, stub,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
            } else {
                startForeground(NOTIFICATION_ID, stub);
            }
        } catch (Exception ignored) {
            // If even the stub fails we'd rather attempt the stop than crash.
        }
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (nm == null) return;
            NotificationChannel ch = new NotificationChannel(
                CHANNEL_ID, "Playback", NotificationManager.IMPORTANCE_LOW
            );
            ch.setDescription("Music playback controls");
            ch.setShowBadge(false);
            ch.setSound(null, null);
            ch.enableVibration(false);
            nm.createNotificationChannel(ch);
        }
    }

    private static String safe(String s) { return s == null ? "" : s; }

    private static Bitmap downloadBitmap(String url) {
        HttpURLConnection conn = null;
        InputStream is = null;
        try {
            URL u = new URL(url);
            conn = (HttpURLConnection) u.openConnection();
            conn.setConnectTimeout(8000);
            conn.setReadTimeout(8000);
            conn.setInstanceFollowRedirects(true);
            is = conn.getInputStream();
            BitmapFactory.Options opts = new BitmapFactory.Options();
            opts.inPreferredConfig = Bitmap.Config.RGB_565;
            Bitmap raw = BitmapFactory.decodeStream(is, null, opts);
            if (raw == null) return null;
            // Cap art at 512px for notification memory budget
            int max = 512;
            int w = raw.getWidth(), h = raw.getHeight();
            if (w > max || h > max) {
                float scale = Math.min((float) max / w, (float) max / h);
                Bitmap scaled = Bitmap.createScaledBitmap(
                    raw, Math.round(w * scale), Math.round(h * scale), true);
                if (scaled != raw) raw.recycle();
                return scaled;
            }
            return raw;
        } catch (Exception e) {
            return null;
        } finally {
            try { if (is != null) is.close(); } catch (Exception ignore) {}
            if (conn != null) conn.disconnect();
        }
    }

    @Override
    public void onDestroy() {
        unregisterNoisyReceiver();
        abandonAudioFocus();
        releasePlaybackLocks();
        stopForegroundCompat();
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent intent) { return null; }
}
