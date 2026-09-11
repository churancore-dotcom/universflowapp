package com.universeflow.app

/**
 * Bridge for lock-screen / Control-Center mini player button presses.
 *
 * ExoPlayerService owns the MediaSession custom layout (like, shuffle,
 * repeat). When the user taps one of those buttons the action name is pushed
 * here, and ExoPlayerPlugin forwards it to the web layer so the app's own
 * state (liked songs, shuffle, repeat) stays in sync with the notification.
 */
object NativeMediaEvents {
    const val ACTION_LIKE = "uf.like"
    const val ACTION_SHUFFLE = "uf.shuffle"
    const val ACTION_REPEAT = "uf.repeat"

    @Volatile
    var onAction: ((String) -> Unit)? = null

    fun emit(action: String) {
        try {
            onAction?.invoke(action)
        } catch (_: Throwable) {
        }
    }
}
