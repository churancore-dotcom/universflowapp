package com.universeflow.app

import android.annotation.SuppressLint
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap

/**
 * Proof-of-Origin token (poToken) provider.
 *
 * YouTube now attaches a "service integrity" requirement to its web clients:
 * without a poToken the WEB/WEB_REMIX players answer LOGIN_REQUIRED, and the
 * stream URLs they do hand out get 403'd by googlevideo. The token is produced
 * by Google's BotGuard VM, which is JavaScript — it cannot be reimplemented in
 * Kotlin, it has to be *run*. So we run it in an off-screen [WebView] with the
 * youtube.com origin, exactly the environment BotGuard expects.
 *
 * Flow (the same one youtube-po-token-generator performs under Puppeteer):
 *   1. an off-screen WebView is created with base URL https://www.youtube.com
 *   2. bgutils-js is loaded inside it and asks Google's WAA service for a
 *      BotGuard challenge + interpreter program
 *   3. the interpreter runs and mints a poToken bound to `visitorData`
 *   4. the token is handed back to Kotlin and cached per identifier
 *
 * Everything here is best-effort and non-blocking: [tokenFor] returns null
 * until a token exists, and the resolver simply keeps racing its PoToken-free
 * clients (ANDROID_VR / IOS / ANDROID_MUSIC …) in the meantime. Nothing
 * regresses if Google changes the challenge protocol — we just never gain the
 * extra client.
 */
object WebViewPoTokenProvider : PoTokenProvider {

    private const val TAG = "PoToken"

    /** Public InnerTube constant: the WAA request key used by the web player. */
    private const val REQUEST_KEY = "O43z0dpjhgX20SCx4KAo"

    /** Tokens are session-scoped; Google's own web player rotates ~hourly. */
    private const val TOKEN_TTL_MS = 45L * 60L * 1000L

    private data class Entry(val token: String, val at: Long)

    private val tokens = ConcurrentHashMap<String, Entry>()
    private val inFlight = ConcurrentHashMap<String, Long>()

    @Volatile private var appContext: Context? = null

    fun attach(ctx: Context) {
        if (appContext == null) appContext = ctx.applicationContext
        YouTubeProtocolProviders.poTokenProvider = this
    }

    /**
     * Cached token for this session identifier, or null while one is being
     * minted. Callers must treat null as "skip the poToken clients this time".
     */
    override fun tokenFor(visitorData: String?, videoId: String): String? {
        val ident = visitorData?.takeIf { it.isNotBlank() } ?: return null
        val hit = tokens[ident]
        if (hit != null && System.currentTimeMillis() - hit.at < TOKEN_TTL_MS) return hit.token
        if (hit != null) tokens.remove(ident)
        mint(ident)
        return null
    }

    /** Kick off generation early (app warm-up) so the first tap can use it. */
    fun prewarm(visitorData: String?) {
        val ident = visitorData?.takeIf { it.isNotBlank() } ?: return
        val hit = tokens[ident]
        if (hit != null && System.currentTimeMillis() - hit.at < TOKEN_TTL_MS) return
        mint(ident)
    }

    private fun mint(ident: String) {
        val ctx = appContext ?: return
        val now = System.currentTimeMillis()
        val started = inFlight[ident] ?: 0L
        // One generation at a time per identifier; a stuck WebView unblocks
        // after 60s rather than wedging the feature for the whole session.
        if (now - started < 60_000L) return
        inFlight[ident] = now

        Handler(Looper.getMainLooper()).post {
            try {
                runWebView(ctx, ident)
            } catch (t: Throwable) {
                Log.w(TAG, "mint failed: ${t.message}")
                inFlight.remove(ident)
            }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun runWebView(ctx: Context, ident: String) {
        val web = WebView(ctx)
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.settings.userAgentString =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
                "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"

        var finished = false
        val cleanup = {
            if (!finished) {
                finished = true
                inFlight.remove(ident)
                try {
                    web.removeJavascriptInterface("UFPoToken")
                    web.loadUrl("about:blank")
                    web.destroy()
                } catch (_: Throwable) { /* best effort */ }
            }
        }

        web.addJavascriptInterface(
            object {
                @JavascriptInterface
                fun onResult(json: String) {
                    val token = try {
                        JSONObject(json).optString("poToken", "")
                    } catch (_: Throwable) { "" }
                    val err = try {
                        JSONObject(json).optString("error", "")
                    } catch (_: Throwable) { "" }
                    Handler(Looper.getMainLooper()).post {
                        if (token.length >= 16) {
                            tokens[ident] = Entry(token, System.currentTimeMillis())
                            Log.d(TAG, "minted poToken (${token.length} chars)")
                        } else {
                            Log.w(TAG, "poToken generation failed: $err")
                        }
                        cleanup()
                    }
                }
            },
            "UFPoToken",
        )

        // Hard timeout: never leave an invisible WebView alive.
        Handler(Looper.getMainLooper()).postDelayed({ cleanup() }, 25_000L)

        web.loadDataWithBaseURL(
            "https://www.youtube.com/",
            page(ident),
            "text/html",
            "utf-8",
            null,
        )
    }

    /**
     * The page runs on the youtube.com origin (via loadDataWithBaseURL), which
     * is what lets the challenge/integrity calls to Google's WAA endpoint pass
     * its origin check.
     */
    private fun page(ident: String): String {
        val safeIdent = ident.replace("\\", "\\\\").replace("'", "\\'")
        return """
<!doctype html>
<html><head><meta charset="utf-8"></head><body>
<script src="https://cdn.jsdelivr.net/npm/bgutils-js@3.1.2/dist/index.min.js"></script>
<script>
(async function () {
  function done(o) {
    try { UFPoToken.onResult(JSON.stringify(o)); } catch (e) {}
  }
  try {
    var BG = (window.BgUtils && window.BgUtils.BG) || window.BG;
    if (!BG) { done({ error: 'bgutils unavailable' }); return; }
    var bgConfig = {
      fetch: function (u, o) { return fetch(u, o); },
      globalObj: window,
      identifier: '$safeIdent',
      requestKey: '$REQUEST_KEY'
    };
    var challenge = await BG.Challenge.create(bgConfig);
    if (!challenge) { done({ error: 'no challenge' }); return; }
    var interpreter = challenge.interpreterJavascript &&
      challenge.interpreterJavascript.privateDoNotAccessOrElseSafeScriptWrappedValue;
    if (interpreter) new Function(interpreter)();
    var res = await BG.PoToken.generate({
      program: challenge.program,
      globalName: challenge.globalName,
      bgConfig: bgConfig
    });
    done({ poToken: (res && res.poToken) || '' });
  } catch (e) {
    done({ error: String((e && e.message) || e) });
  }
})();
</script>
</body></html>
        """.trimIndent()
    }
}
