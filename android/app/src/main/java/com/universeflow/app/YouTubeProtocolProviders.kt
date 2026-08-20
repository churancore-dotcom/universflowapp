package com.universeflow.app

/**
 * Compatibility seams for YouTube's evolving playback protocols.
 * Implementations must run on-device; no remote proxy is required by these APIs.
 */
interface PoTokenProvider {
    fun tokenFor(visitorData: String?, videoId: String): String?
}

interface SabrPlaybackProvider {
    fun supports(serverAbrStreamingUrl: String): Boolean
    fun playableUrl(serverAbrStreamingUrl: String): String?
}

object YouTubeProtocolProviders {
    @Volatile var poTokenProvider: PoTokenProvider? = null
    @Volatile var sabrPlaybackProvider: SabrPlaybackProvider? = null
}