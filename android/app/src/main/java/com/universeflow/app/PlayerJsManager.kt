package com.universeflow.app

import android.util.Log
import okhttp3.OkHttpClient
import okhttp3.Request
import org.mozilla.javascript.Context
import org.mozilla.javascript.Function
import org.mozilla.javascript.Scriptable
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import java.util.regex.Pattern

/**
 * On-device YouTube player.js manager — bridges Echo / NewPipe-style
 * signature deciphering to ExoPlayer without any backend hop.
 *
 * Responsibilities:
 *  1. Download the current player.js from www.youtube.com.
 *  2. Extract the `sts` (signature timestamp).
 *  3. Locate the signature-decipher function ("s" param) and the
 *     n-param throttling function via NewPipe-style regex patterns.
 *  4. Evaluate them on-device in Mozilla Rhino, cached per player ID.
 *  5. Expose helpers: `decipherSignature(s)` and `decipherNParam(n)`.
 *
 * Cache lifetime: 24h. If decoding fails (YouTube ships a new player.js
 * with a regex we don't recognize), callers MUST fall back to a
 * pre-signed mobile/TV client so playback never breaks.
 */
object PlayerJsManager {
    private const val TAG = "PlayerJsManager"
    private const val EMBED_URL = "https://www.youtube.com/iframe_api"
    private const val PLAYER_HOST = "https://www.youtube.com"
    private const val CACHE_TTL_MS = 24L * 60L * 60L * 1000L

    // Self-heal cooldowns (zemer-cipher style: two independent triggers sharing
    // one single-flight lock so neither path can starve the other).
    private const val REJECTION_COOLDOWN_MS = 5L * 60L * 1000L
    private const val MISS_COOLDOWN_MS = 60L * 1000L

    private val http: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(3, TimeUnit.SECONDS)
            .readTimeout(8, TimeUnit.SECONDS)
            .callTimeout(10, TimeUnit.SECONDS)
            .build()
    }

    private data class PlayerBundle(
        val playerId: String,
        val sts: String?,
        val sigFnSource: String?,
        val sigFnName: String?,
        val nFnSource: String?,
        val nFnName: String?,
        val ts: Long,
        val epoch: Long,
    )

    @Volatile private var current: PlayerBundle? = null
    @Volatile private var epochCounter = 0L
    @Volatile private var lastRejectionRefresh = 0L
    @Volatile private var lastMissRefresh = 0L
    /** Set when the extracted n-function is proven ineffective this session. */
    @Volatile private var nDisabledForSession = false
    private val nCache = ConcurrentHashMap<String, String>()

    /** Returns the current signature timestamp, downloading player.js if needed. */
    fun getSts(): String? = ensureBundle()?.sts

    /** Current player.js identity — useful for logs and cache keys. */
    fun currentPlayerId(): String? = current?.playerId

    fun decipherSignature(s: String): String? {
        decipherSignatureOnce(s)?.let { return it }
        // Self-heal: a rotated player.js makes our regexes miss. Re-download once
        // (rate-limited) and retry before giving up on the whole format.
        if (touchCooldown("miss", MISS_COOLDOWN_MS)) {
            forceRefresh("signature extraction failed")
            return decipherSignatureOnce(s)
        }
        return null
    }

    private fun decipherSignatureOnce(s: String): String? {
        val b = ensureBundle() ?: return null
        val src = b.sigFnSource ?: return null
        val name = b.sigFnName ?: return null
        return try {
            evalFn(src, name, s)?.takeIf { it.isNotBlank() && it != s }
        } catch (t: Throwable) {
            Log.w(TAG, "decipherSignature failed: ${t.message}")
            null
        }
    }

    fun decipherNParam(n: String): String? {
        if (nDisabledForSession) return null
        nCache[n]?.let { return it }
        val b = ensureBundle() ?: return null
        val src = b.nFnSource ?: return null
        val name = b.nFnName ?: return null
        return try {
            val out = evalFn(src, name, n) ?: return null
            // Defensive: some n-fn bug branches return "enhanced_except_*"
            // which means the regex misidentified the function. Treat as failure.
            if (out.startsWith("enhanced_except_") || out == n || out.isBlank()) {
                Log.w(TAG, "n-fn produced suspicious output, ignoring")
                nMisses++
                if (nMisses >= 3) {
                    // Proven ineffective: stop paying Rhino cost for the rest of
                    // the session. Callers already fall back to the un-rewritten
                    // (possibly throttled but playable) URL.
                    nDisabledForSession = true
                    Log.w(TAG, "n-transform disabled for session after $nMisses misses")
                }
                return null
            }
            nMisses = 0
            nCache[n] = out
            out
        } catch (t: Throwable) {
            Log.w(TAG, "decipherNParam failed: ${t.message}")
            null
        }
    }

    @Volatile private var nMisses = 0

    /**
     * Call this when the CDN rejects (403) a URL we deciphered. A wrong-but-
     * non-throwing signature is invisible to normal error handling, so a stream
     * rejection is the only signal that our extraction has silently rotted.
     */
    fun onStreamRejected() {
        if (!touchCooldown("rejection", REJECTION_COOLDOWN_MS)) return
        forceRefresh("stream rejected by CDN")
    }

    @Synchronized
    private fun touchCooldown(kind: String, cooldownMs: Long): Boolean {
        val now = System.currentTimeMillis()
        return when (kind) {
            "rejection" -> if (now - lastRejectionRefresh < cooldownMs) false
                else { lastRejectionRefresh = now; true }
            else -> if (now - lastMissRefresh < cooldownMs) false
                else { lastMissRefresh = now; true }
        }
    }

    @Synchronized
    private fun forceRefresh(reason: String) {
        Log.w(TAG, "force refreshing player.js ($reason)")
        val previousId = current?.playerId
        current = null
        nDisabledForSession = false
        nMisses = 0
        val refreshed = try { downloadAndExtract() } catch (_: Throwable) { null }
        if (refreshed != null) {
            current = refreshed
            nCache.clear()
            if (refreshed.playerId != previousId) {
                Log.d(TAG, "player.js rotated $previousId -> ${refreshed.playerId}")
            }
        }
    }

    /**
     * Download + compile player.js in the background at app launch.
     *
     * Cold-start playback used to pay this cost (~1.5-3s: embed page fetch,
     * player.js download, Rhino compile) inside the very first resolve, which is
     * exactly why the first tap after opening the app felt dead. Doing it while
     * the user is still looking at the home feed makes the first play as fast as
     * every later one.
     */
    fun prewarm() {
        if (current != null) return
        Thread {
            try { ensureBundle() } catch (_: Throwable) { /* best effort */ }
        }.apply { priority = Thread.MIN_PRIORITY; isDaemon = true }.start()
    }

    // ── Internal ──────────────────────────────────────────────────────────



    @Synchronized
    private fun ensureBundle(): PlayerBundle? {
        val cur = current
        if (cur != null && System.currentTimeMillis() - cur.ts < CACHE_TTL_MS && cur.epoch == epochCounter) return cur
        return try {
            val refreshed = downloadAndExtract()
            if (refreshed != null) {
                current = refreshed
                nCache.clear()
            }
            refreshed ?: cur
        } catch (t: Throwable) {
            Log.w(TAG, "ensureBundle error: ${t.message}")
            cur
        }
    }


    private fun downloadAndExtract(): PlayerBundle? {
        // 1. Hit the embed/iframe page to discover the current player.js path.
        val iframe = httpGet(EMBED_URL) ?: return null
        val playerJsPath = Regex("""/s/player/([a-zA-Z0-9_-]+)/[a-zA-Z0-9_/.-]+player[a-zA-Z0-9_.-]*\.js""")
            .find(iframe)?.value
            ?: Regex("""\\?/s/player/([a-zA-Z0-9_-]+)/player_ias\.vflset/[a-zA-Z]+_[A-Z]+/base\.js""")
                .find(iframe)?.value
            ?: return null
        val playerId = Regex("""/s/player/([a-zA-Z0-9_-]+)/""").find(playerJsPath)?.groupValues?.get(1) ?: return null
        val playerJs = httpGet(PLAYER_HOST + playerJsPath) ?: return null

        // 2. sts (signature timestamp) — used when building player payloads.
        val sts = Regex("""signatureTimestamp[=:](\d+)""").find(playerJs)?.groupValues?.get(1)

        // 3. Locate signature decipher function name. NewPipe maintains
        //    several alternative patterns; we keep them ordered by frequency.
        val sigFnName = listOf(
            """\b([a-zA-Z0-9${'$'}_]+)&&\(b=a\.get\("n"\)\)""",         // (rare alias)
            """\bm=([a-zA-Z0-9${'$'}_]{1,})\(decodeURIComponent\(h\.s\)\)""",
            """\bc&&\(c=([a-zA-Z0-9${'$'}_]{1,})\(decodeURIComponent\(c\)\)""",
            """([a-zA-Z0-9${'$'}_]+)\s*=\s*function\(\s*a\s*\)\s*\{\s*a\s*=\s*a\.split\(""\)""",
            """\bfunction\s+([a-zA-Z0-9${'$'}_]+)\s*\(a\)\s*\{\s*a=a\.split\(""\)""",
        ).firstNotNullOfOrNull { Regex(it).find(playerJs)?.groupValues?.getOrNull(1) }

        val sigFnSource = sigFnName?.let { name ->
            // Function body, including helper object it references.
            val fnPattern = Pattern.compile(
                """(?:function\s+""" + Pattern.quote(name) + """\s*\(a\)\s*\{[^}]*\}|""" +
                Pattern.quote(name) + """\s*=\s*function\s*\(a\)\s*\{[^}]*\})""",
            )
            val m = fnPattern.matcher(playerJs)
            if (!m.find()) null else {
                val fnBody = m.group()
                // helper object: first call inside body like `Aa.XX(a,1)` → object name `Aa`
                val helperName = Regex("""([a-zA-Z0-9${'$'}_]{2,})\.[a-zA-Z0-9${'$'}_]{2,}\(a,\d+\)""")
                    .find(fnBody)?.groupValues?.getOrNull(1)
                val helperSource = helperName?.let {
                    Regex("""var\s+""" + Regex.escape(it) + """=\{[\s\S]*?\};""").find(playerJs)?.value
                }
                buildString {
                    if (helperSource != null) { append(helperSource); append('\n') }
                    append("var ").append(name).append(";")
                    append(fnBody)
                    if (!fnBody.trim().endsWith(";")) append(";")
                }
            }
        }

        // 4. n-param throttling function.
        val nFnRefName = listOf(
            """\.get\("n"\)\)&&\(b=([a-zA-Z0-9${'$'}_]+)(?:\[(\d+)\])?\([a-zA-Z]\)""",
            """&&\(b=([a-zA-Z0-9${'$'}_]+)(?:\[(\d+)\])?\(""",
        ).firstNotNullOfOrNull { Regex(it).find(playerJs)?.groupValues?.getOrNull(1) }

        val nFnName: String?
        val nFnSource: String?
        if (nFnRefName == null) {
            nFnName = null; nFnSource = null
        } else {
            // The ref might be an array, e.g. `var Bpa=[Vpa];` so resolve it.
            val resolved = Regex("""var\s+""" + Regex.escape(nFnRefName) + """\s*=\s*\[([a-zA-Z0-9${'$'}_]+)\]""")
                .find(playerJs)?.groupValues?.getOrNull(1) ?: nFnRefName
            nFnName = resolved
            val nPattern = Pattern.compile(
                """(?:function\s+""" + Pattern.quote(resolved) + """\s*\(\s*[a-zA-Z]\s*\)\s*\{[\s\S]*?return\s+[a-zA-Z](?:\.join\(""\))?\s*\}|""" +
                Pattern.quote(resolved) + """\s*=\s*function\s*\(\s*[a-zA-Z]\s*\)\s*\{[\s\S]*?return\s+[a-zA-Z](?:\.join\(""\))?\s*\})""",
            )
            val m = nPattern.matcher(playerJs)
            nFnSource = if (m.find()) {
                val body = m.group()
                "var $resolved;" + body + if (body.trim().endsWith(";")) "" else ";"
            } else null
        }

        epochCounter += 1
        Log.d(TAG, "player.js loaded id=$playerId sts=$sts sigFn=$sigFnName nFn=$nFnName")
        return PlayerBundle(playerId, sts, sigFnSource, sigFnName, nFnSource, nFnName, System.currentTimeMillis(), epochCounter)

    }

    private fun evalFn(src: String, fnName: String, arg: String): String? {
        val cx = Context.enter()
        return try {
            cx.optimizationLevel = -1
            cx.languageVersion = Context.VERSION_ES6
            val scope: Scriptable = cx.initStandardObjects()
            cx.evaluateString(scope, src, "player.js", 1, null)
            val fn = scope.get(fnName, scope)
            if (fn !is Function) return null
            val result = fn.call(cx, scope, scope, arrayOf<Any>(arg))
            Context.toString(result)
        } finally {
            Context.exit()
        }
    }

    private fun httpGet(url: String): String? = try {
        http.newCall(
            Request.Builder()
                .url(url)
                .header("User-Agent", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36")
                .build(),
        ).execute().use { r ->
            if (!r.isSuccessful) null else r.body?.string()
        }
    } catch (t: Throwable) {
        Log.w(TAG, "httpGet $url failed: ${t.message}")
        null
    }
}
