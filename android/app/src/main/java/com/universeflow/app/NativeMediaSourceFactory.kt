package com.universeflow.app

import android.content.Context
import android.net.Uri
import android.util.Log
import androidx.media3.common.C
import androidx.media3.database.StandaloneDatabaseProvider
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.datasource.ResolvingDataSource
import androidx.media3.datasource.cache.CacheDataSink
import androidx.media3.datasource.cache.CacheDataSource
import androidx.media3.datasource.cache.ContentMetadata
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
 * 2. Resolved audio bytes are persisted to a 512 MB LRU disk cache keyed by the
 *    exact file (video + format + length), so replaying a fully saved track is
 *    offline and instant and two versions of a song are never mixed.
 */
object NativeMediaSourceFactory {

    private const val TAG = "NativeMediaSource"
    private const val SCHEME = "yt"
    private const val METADATA_SCHEME = "ufresolve"
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

        // DefaultDataSource opens file:// / content:// itself and hands http(s)
        // to the HTTP factory. The upstream used to be HTTP-only, so downloaded
        // songs (saved as real files) could never play offline in the APK.
        val upstreamFactory = DefaultDataSource.Factory(ctx.applicationContext, httpFactory)

        val sc = cache(ctx)
        val cacheSinkFactory = CacheDataSink.Factory()
            .setCache(sc)
            .setFragmentSize(C.LENGTH_UNSET.toLong())

        // The cache sits BELOW resolution, so it only ever sees the exact file
        // that was chosen. Its key names the video, the audio format (itag) and
        // the byte length (clen); a different format or a JioSaavn/fallback
        // stream for the same song can therefore never be spliced into a
        // half-saved file, which used to break playback mid-song.
        val cacheFactory = CacheDataSource.Factory()
            .setCache(sc)
            .setUpstreamDataSourceFactory(upstreamFactory)
            .setCacheWriteDataSinkFactory(cacheSinkFactory)
            .setFlags(
                CacheDataSource.FLAG_IGNORE_CACHE_ON_ERROR or
                    CacheDataSource.FLAG_BLOCK_ON_CACHE,
            )
            .setCacheKeyFactory { spec: DataSpec -> spec.key ?: spec.uri.toString() }

        val splitFactory = DataSource.Factory {
            SchemeSplitDataSource(cacheFactory.createDataSource(), upstreamFactory.createDataSource())
        }

        // Resolves yt://<id> -> direct googlevideo URL (or refreshes a stale one).
        val resolvingFactory = ResolvingDataSource.Factory(splitFactory, ResolvingDataSource.Resolver { dataSpec ->
            val uri = dataSpec.uri
            if (uri.scheme != SCHEME && uri.scheme != METADATA_SCHEME) {
                // Plain URLs and downloaded files stream straight through.
                return@Resolver dataSpec.buildUpon().setKey(null).build()
            }
            val videoId = if (uri.scheme == SCHEME) {
                uri.host ?: uri.schemeSpecificPart?.removePrefix("//")?.substringBefore('?')
            } else null
            if (uri.scheme == SCHEME && (videoId.isNullOrBlank() || videoId.length != 11)) {
                throw java.io.IOException("Invalid yt:// uri: $uri")
            }
            // A song already saved in full plays straight from the cache, so
            // replays work offline and skip the lookup entirely.
            if (videoId != null) {
                fullyCachedKey(sc, videoId)?.let { key ->
                    return@Resolver dataSpec.buildUpon().setKey(key).build()
                }
            }
            val title = uri.getQueryParameter("title")
            val artist = uri.getQueryParameter("artist")
            val fallback = uri.getQueryParameter("fallback")
            val resolved = MasterResolver.resolve(videoId, title, artist, timeoutMs = 7000L)
                ?: fallback?.takeIf { it.startsWith("http") || it.startsWith("file:") || it.startsWith("content:") }?.let {
                    Log.w(TAG, "native resolve failed for $videoId; using queued fallback URL")
                    MasterResolver.Resolved(it, "fallback", System.currentTimeMillis() + 60_000L)
                }
                ?: throw java.io.IOException("Native resolve failed for $videoId")
            Log.d(TAG, "resolved $videoId via ${resolved.source}")
            val resolvedUri = Uri.parse(resolved.url)
            val key = if (videoId != null) cacheKeyFor(videoId, resolvedUri) else null
            dataSpec.buildUpon().setUri(resolvedUri).setKey(key).build()
        })

        return DefaultMediaSourceFactory(resolvingFactory)
    }

    private fun fullyCachedKey(cache: SimpleCache, videoId: String): String? = try {
        val prefix = "yt2:$videoId:"
        cache.keys.firstOrNull { k ->
            if (!k.startsWith(prefix)) return@firstOrNull false
            val len = k.substringAfterLast(':').toLongOrNull() ?: return@firstOrNull false
            // The saved length must match too, so the player knows where the
            // song ends and never reaches for the network mid-song.
            len > 0 &&
                ContentMetadata.getContentLength(cache.getContentMetadata(k)) == len &&
                cache.isCached(k, 0, len)
        }
    } catch (_: Throwable) { null }

    /**
     * Cache key for one exact YouTube audio file, or null when the stream is
     * not a fully identified googlevideo file (JioSaavn, fallback, unknown
     * length) — those stream uncached rather than risk mixing two files.
     */
    internal fun cacheKeyFor(videoId: String, resolved: Uri): String? {
        val host = resolved.host ?: return null
        if (!host.endsWith("googlevideo.com")) return null
        val itag = resolved.getQueryParameter("itag")?.takeIf { it.isNotBlank() && it.all(Char::isDigit) } ?: return null
        val clen = resolved.getQueryParameter("clen")?.takeIf { it.isNotBlank() && it.all(Char::isDigit) } ?: return null
        return "yt2:$videoId:$itag:$clen"
    }

    private class SchemeSplitDataSource(
        private val cached: DataSource,
        private val direct: DataSource,
    ) : DataSource {
        private var active: DataSource? = null
        override fun addTransferListener(transferListener: androidx.media3.datasource.TransferListener) {
            cached.addTransferListener(transferListener)
            direct.addTransferListener(transferListener)
        }
        override fun open(dataSpec: DataSpec): Long {
            // Only fully identified YouTube files (see cacheKeyFor) use the cache.
            val src = if (dataSpec.key?.startsWith("yt2:") == true) cached else direct
            active = src
            return src.open(dataSpec)
        }
        override fun read(buffer: ByteArray, offset: Int, length: Int): Int =
            active?.read(buffer, offset, length) ?: C.RESULT_END_OF_INPUT
        override fun getUri(): Uri? = active?.uri
        override fun getResponseHeaders(): Map<String, List<String>> = active?.responseHeaders ?: emptyMap()
        override fun close() {
            try { active?.close() } finally { active = null }
        }
    }

    fun release() {
        try { simpleCache?.release() } catch (_: Throwable) {}
        simpleCache = null
    }
}
