package com.universeflow.app

import android.content.Context
import android.net.Uri
import android.util.Log
import androidx.media3.common.C
import androidx.media3.database.StandaloneDatabaseProvider
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.datasource.ResolvingDataSource
import androidx.media3.datasource.cache.CacheDataSink
import androidx.media3.datasource.cache.CacheDataSource
import androidx.media3.datasource.cache.LeastRecentlyUsedCacheEvictor
import androidx.media3.datasource.cache.SimpleCache
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import java.io.File

/**
 * Echo-style media source pipeline.
 *
 * 1. `yt://<videoId>` URIs are resolved lazily by [NativeYouTubeResolver] at the
 *    moment ExoPlayer opens the data source — so the first tap path has zero
 *    extra JS round-trips and the player can refresh expired googlevideo URLs
 *    on demand.
 * 2. Resolved audio bytes are persisted to a 512 MB LRU disk cache, so replaying
 *     a track is fully offline and instant.
 */
object NativeMediaSourceFactory {

    private const val TAG = "NativeMediaSource"
    private const val SCHEME = "yt"
    private const val CACHE_DIR_NAME = "uf_media_cache"
    private const val CACHE_MAX_BYTES = 512L * 1024L * 1024L
    private const val USER_AGENT =
        "Mozilla/5.0 (Linux; Android 14; UniverseFlow) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36"

    @Volatile private var simpleCache: SimpleCache? = null

    @Synchronized
    private fun cache(ctx: Context): SimpleCache {
        simpleCache?.let { return it }
        val dir = File(ctx.cacheDir, CACHE_DIR_NAME).apply { mkdirs() }
        val evictor = LeastRecentlyUsedCacheEvictor(CACHE_MAX_BYTES)
        val db = StandaloneDatabaseProvider(ctx.applicationContext)
        val created = SimpleCache(dir, evictor, db)
        simpleCache = created
        return created
    }

    fun build(ctx: Context): DefaultMediaSourceFactory {
        val httpFactory = DefaultHttpDataSource.Factory()
            .setUserAgent(USER_AGENT)
            .setAllowCrossProtocolRedirects(true)
            .setConnectTimeoutMs(12000)
            .setReadTimeoutMs(20000)

        // Resolves yt://<id> -> direct googlevideo URL (or refreshes a stale one).
        val resolvingFactory = ResolvingDataSource.Factory(httpFactory, ResolvingDataSource.Resolver { dataSpec ->
            val uri = dataSpec.uri
            if (uri.scheme != SCHEME) return@Resolver dataSpec
            val videoId = uri.host ?: uri.schemeSpecificPart?.removePrefix("//")?.substringBefore('?')
            if (videoId.isNullOrBlank() || videoId.length != 11) {
                throw java.io.IOException("Invalid yt:// uri: $uri")
            }
            val title = uri.getQueryParameter("title")
            val artist = uri.getQueryParameter("artist")
            val resolved = MasterResolver.resolve(videoId, title, artist, timeoutMs = 7000L)
                ?: throw java.io.IOException("Native resolve failed for $videoId")
            Log.d(TAG, "resolved $videoId via ${resolved.source}")
            dataSpec.withUri(Uri.parse(resolved.url))
        })

        val sc = cache(ctx)
        val cacheSinkFactory = CacheDataSink.Factory()
            .setCache(sc)
            .setFragmentSize(C.LENGTH_UNSET.toLong())

        val cacheFactory = CacheDataSource.Factory()
            .setCache(sc)
            .setUpstreamDataSourceFactory(resolvingFactory)
            .setCacheWriteDataSinkFactory(cacheSinkFactory)
            .setFlags(
                CacheDataSource.FLAG_IGNORE_CACHE_ON_ERROR or
                    CacheDataSource.FLAG_BLOCK_ON_CACHE,
            )
            // Use the videoId as cache key so re-resolved URLs hit the same cache entry.
            .setCacheKeyFactory { spec: DataSpec ->
                val u = spec.uri
                if (u.scheme == SCHEME) "yt:${u.host ?: u.schemeSpecificPart?.removePrefix("//")?.substringBefore('?')}"
                else spec.key ?: u.toString()
            }

        return DefaultMediaSourceFactory(cacheFactory)
    }

    fun release() {
        try { simpleCache?.release() } catch (_: Throwable) {}
        simpleCache = null
    }
}
