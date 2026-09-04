package com.universeflow.app

import android.annotation.SuppressLint
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.webkit.WebViewClient
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap

/**
 * On-device Web Proof-of-Origin provider for APK playback.
 *
 * BotGuard is initialized once in a hidden YouTube-origin WebView. Its minter is
 * kept alive and produces a distinct token bound to each video ID. Playback
 * only reads this provider's cache: token creation never blocks ExoPlayer.
 */
object WebViewPoTokenProvider : PoTokenProvider {
    private const val TAG = "PoToken"
    private const val REQUEST_KEY = "O43z0dpjhgX20SCx4KAo"
    private const val TOKEN_TTL_MS = 45L * 60L * 1000L

    private data class Entry(val token: String, val at: Long)

    private val tokens = ConcurrentHashMap<String, Entry>()
    private val inFlight = ConcurrentHashMap.newKeySet<String>()
    @Volatile private var appContext: Context? = null
    @Volatile private var webView: WebView? = null
    @Volatile private var minterReady = false
    @Volatile private var initializing = false

    fun attach(ctx: Context) {
        if (appContext == null) appContext = ctx.applicationContext
        YouTubeProtocolProviders.poTokenProvider = this
    }

    /** Return only a cached video-bound token; never wait on the playback path. */
    override fun tokenFor(visitorData: String?, videoId: String): String? {
        if (videoId.length != 11) return null
        val hit = tokens[videoId]
        if (hit != null && System.currentTimeMillis() - hit.at < TOKEN_TTL_MS) return hit.token
        if (hit != null) tokens.remove(videoId)
        request(videoId)
        return null
    }

    /** Initialize the persistent BotGuard VM at app startup. */
    fun warmSession() {
        ensureWebView()
    }

    /** Queue a video token early, for example when its track enters the queue. */
    override fun prewarm(videoId: String) {
        if (videoId.length == 11) request(videoId)
    }

    private fun request(videoId: String) {
        if (!inFlight.add(videoId)) return
        ensureWebView()
        Handler(Looper.getMainLooper()).post {
            val web = webView
            if (!minterReady || web == null) return@post
            web.evaluateJavascript("window.UFMint(${JSONObject.quote(videoId)})", null)
        }
    }

    private fun ensureWebView() {
        val ctx = appContext ?: return
        if (webView != null || initializing) return
        initializing = true
        Handler(Looper.getMainLooper()).post {
            try {
                runWebView(ctx)
            } catch (t: Throwable) {
                Log.w(TAG, "minter startup failed: ${t.message}")
                initializing = false
                inFlight.clear()
            }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun runWebView(ctx: Context) {
        val web = WebView(ctx)
        webView = web
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.settings.userAgentString =
            "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 " +
                "(KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36"

        web.addJavascriptInterface(object {
            @JavascriptInterface
            fun onResult(json: String) {
                val result = try { JSONObject(json) } catch (_: Throwable) { JSONObject() }
                val videoId = result.optString("videoId", "")
                val token = result.optString("poToken", "")
                val error = result.optString("error", "")
                if (videoId.length == 11 && token.length >= 16) {
                    tokens[videoId] = Entry(token, System.currentTimeMillis())
                    Log.d(TAG, "minted video-bound token for $videoId (${token.length} chars)")
                } else {
                    Log.w(TAG, "token mint failed for $videoId: $error")
                }
                if (videoId.isNotBlank()) inFlight.remove(videoId)
            }

            @JavascriptInterface
            fun onReady() {
                Handler(Looper.getMainLooper()).post {
                    minterReady = true
                    initializing = false
                    Log.d(TAG, "persistent WebPO minter ready")
                    inFlight.toList().forEach { videoId ->
                        web.evaluateJavascript("window.UFMint(${JSONObject.quote(videoId)})", null)
                    }
                }
            }

            @JavascriptInterface
            fun onStartupError(error: String) {
                Log.w(TAG, "WebPO minter unavailable: $error")
                Handler(Looper.getMainLooper()).post {
                    initializing = false
                    minterReady = false
                    inFlight.clear()
                    webView = null
                    try { web.destroy() } catch (_: Throwable) {}
                }
            }
        }, "UFPoToken")

        web.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView, url: String) {
                val bundle = try {
                    ctx.assets.open("bgutils-webpo.js").bufferedReader().use { it.readText() }
                } catch (t: Throwable) {
                    view.evaluateJavascript(
                        "UFPoToken.onStartupError(${JSONObject.quote("asset: ${t.message}")})",
                        null,
                    )
                    return
                }
                view.evaluateJavascript(bundle) {
                    view.evaluateJavascript(initializer(), null)
                }
            }
        }
        web.loadDataWithBaseURL(
            "https://www.youtube.com/",
            "<!doctype html><html><body></body></html>",
            "text/html",
            "utf-8",
            null,
        )
    }

    /** Initialize one BotGuard snapshot/minter, then expose cheap per-video minting. */
    private fun initializer(): String = """
(async function () {
  try {
    var BG = window.BgUtils;
    if (!BG) throw new Error('bgutils unavailable');
    var config = { fetch: fetch.bind(window), globalObj: window, requestKey: '$REQUEST_KEY' };
    var challenge = await BG.Challenge.create(config);
    if (!challenge || !challenge.program) throw new Error('no challenge program');
    var interpreter = challenge.interpreterJavascript &&
      challenge.interpreterJavascript.privateDoNotAccessOrElseSafeScriptWrappedValue;
    if (!interpreter) throw new Error('no interpreter');
    new Function(interpreter)();
    var botguard = await BG.BotGuardClient.create({
      program: challenge.program, globalName: challenge.globalName, globalObj: window
    });
    var signals = [];
    var snapshot = await botguard.snapshot({ webPoSignalOutput: signals });
    var integrity = await fetch('https://jnn-pa.googleapis.com/${'$'}rpc/google.internal.waa.v1.Waa/GenerateIT', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json+protobuf',
        'x-goog-api-key': BG.GOOG_API_KEY,
        'x-user-agent': 'grpc-web-javascript/0.1'
      },
      body: JSON.stringify(['$REQUEST_KEY', snapshot])
    });
    if (!integrity.ok) throw new Error('GenerateIT HTTP ' + integrity.status);
    var raw = await integrity.json();
    var minter = await BG.WebPoMinter.create({
      integrityToken: raw[0], estimatedTtlSecs: raw[1],
      mintRefreshThreshold: raw[2], websafeFallbackToken: raw[3]
    }, signals);
    window.UFMint = async function (videoId) {
      try {
        var token = await minter.mintAsWebsafeString(videoId);
        UFPoToken.onResult(JSON.stringify({ videoId: videoId, poToken: token }));
      } catch (e) {
        UFPoToken.onResult(JSON.stringify({
          videoId: videoId, error: String((e && e.message) || e)
        }));
      }
    };
    UFPoToken.onReady();
  } catch (e) {
    UFPoToken.onStartupError(String((e && e.message) || e));
  }
})();
    """.trimIndent()
}
