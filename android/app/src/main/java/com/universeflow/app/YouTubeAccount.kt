package com.universeflow.app

import android.content.Context
import android.util.Log
import okhttp3.FormBody
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * Optional "Connect your YouTube account" support — the TV/limited-input
 * device OAuth flow (the same youtube.com/activate pairing that living-room
 * YouTube apps use).
 *
 * Why this exists: anonymous InnerTube `/player` calls are increasingly
 * refused with LOGIN_REQUIRED (age-gated tracks, region locks, and edges that
 * simply distrust token-less callers). A real account fixes that class of
 * failure outright, costs nothing, and stays entirely on the user's device —
 * the tokens never leave the phone and no server of ours ever sees them.
 *
 * Only the `youtube` read scope is requested. We never write to the account
 * (no likes, no subscriptions, no history mutations).
 *
 * Flow:
 *  1. [startDeviceAuth] → show `userCode` + `verificationUrl` to the user.
 *  2. Poll [pollDeviceAuth] every `interval` seconds until it reports done.
 *  3. Refresh token is persisted; [accessToken] silently refreshes when stale.
 */
object YouTubeAccount {
    private const val TAG = "YouTubeAccount"

    // Public YouTube-on-TV OAuth client. These identifiers ship inside every
    // TV/console YouTube app and are not secrets in any meaningful sense; the
    // device flow cannot be used to impersonate anyone without the user typing
    // the pairing code on youtube.com/activate themselves.
    private const val CLIENT_ID = "861556708454-d6dlm3lh05idd8npek18k6be8ba3oc68.apps.googleusercontent.com"
    // The TV OAuth client is a *confidential* client: Google's token endpoint
    // answers `invalid_client` to a device-code exchange that omits the secret,
    // which is why pairing used to fail the instant the user approved it. This
    // value ships inside every YouTube TV/console app and grants nothing on its
    // own — the user still has to type the pairing code on youtube.com/activate.
    private const val CLIENT_SECRET = "SboVhoG9s0rNafixCSGGKXAT"
    private const val SCOPE = "https://www.googleapis.com/auth/youtube"


    private const val DEVICE_CODE_URL = "https://oauth2.googleapis.com/device/code"
    private const val TOKEN_URL = "https://oauth2.googleapis.com/token"

    private const val PREFS = "uf_yt_account"
    private const val K_REFRESH = "refresh_token"
    private const val K_ACCESS = "access_token"
    private const val K_EXPIRES = "expires_at"

    private val http: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(5, TimeUnit.SECONDS)
            .readTimeout(10, TimeUnit.SECONDS)
            .callTimeout(12, TimeUnit.SECONDS)
            .build()
    }

    @Volatile private var appContext: Context? = null
    @Volatile private var refreshToken: String? = null
    @Volatile private var accessToken: String? = null
    @Volatile private var expiresAt: Long = 0L

    fun attach(ctx: Context) {
        if (appContext != null) return
        appContext = ctx.applicationContext
        try {
            val p = prefs() ?: return
            refreshToken = p.getString(K_REFRESH, null)
            accessToken = p.getString(K_ACCESS, null)
            expiresAt = p.getLong(K_EXPIRES, 0L)
            if (refreshToken != null) Log.d(TAG, "restored YouTube account session")
        } catch (_: Throwable) { /* best effort */ }
    }

    private fun prefs() = appContext?.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun isSignedIn(): Boolean = refreshToken != null

    fun signOut() {
        refreshToken = null
        accessToken = null
        expiresAt = 0L
        try { prefs()?.edit()?.clear()?.apply() } catch (_: Throwable) {}
        NativeYouTubeResolver.clearCache()
    }

    /** Device-code request. Returns null when the network call fails. */
    fun startDeviceAuth(): JSONObject? {
        val body = FormBody.Builder()
            .add("client_id", CLIENT_ID)
            .add("scope", SCOPE)
            .build()
        val json = post(DEVICE_CODE_URL, body) ?: return null
        val deviceCode = json.optString("device_code").takeIf { it.isNotBlank() } ?: return null
        return JSONObject().apply {
            put("deviceCode", deviceCode)
            put("userCode", json.optString("user_code"))
            put(
                "verificationUrl",
                json.optString("verification_url").takeIf { it.isNotBlank() }
                    ?: json.optString("verification_uri", "https://www.google.com/device"),
            )
            put("interval", json.optInt("interval", 5))
            put("expiresIn", json.optInt("expires_in", 1800))
        }
    }

    /**
     * One poll tick. Result shape:
     *  - `{ status: "pending" }`  → keep polling
     *  - `{ status: "slow_down" }`→ keep polling, widen interval
     *  - `{ status: "connected" }`→ done, tokens stored
     *  - `{ status: "error", error }` → stop
     */
    fun pollDeviceAuth(deviceCode: String): JSONObject {
        val body = FormBody.Builder()
            .add("client_id", CLIENT_ID)
            .add("device_code", deviceCode)
            .add("grant_type", "urn:ietf:params:oauth:grant-type:device_code")
            .build()
        val json = post(TOKEN_URL, body)
            ?: return JSONObject().apply { put("status", "error"); put("error", "network") }

        val err = json.optString("error").takeIf { it.isNotBlank() }
        if (err != null) {
            return when (err) {
                "authorization_pending" -> JSONObject().apply { put("status", "pending") }
                "slow_down" -> JSONObject().apply { put("status", "slow_down") }
                "server_error", "temporarily_unavailable" -> JSONObject().apply { put("status", "pending") }
                "invalid_client", "unauthorized_client" -> JSONObject().apply {
                    put("status", "error")
                    put("error", "secure_exchange_required")
                }
                else -> JSONObject().apply { put("status", "error"); put("error", err) }
            }
        }
        val refresh = json.optString("refresh_token").takeIf { it.isNotBlank() }
            ?: return JSONObject().apply { put("status", "error"); put("error", "no_refresh_token") }
        store(refresh, json.optString("access_token"), json.optInt("expires_in", 3600))
        // Anonymous failures are cached as absences, not as errors, but stale
        // successful entries were resolved without a session — drop them so the
        // very next play benefits from the account.
        NativeYouTubeResolver.clearCache()
        return JSONObject().apply { put("status", "connected") }
    }

    /**
     * Valid bearer token, refreshing when within 60s of expiry.
     * Returns null when the user is not connected (or the grant was revoked).
     */
    fun accessToken(): String? {
        val refresh = refreshToken ?: return null
        val cached = accessToken
        if (cached != null && System.currentTimeMillis() < expiresAt - 60_000L) return cached
        return synchronized(this) {
            val again = accessToken
            if (again != null && System.currentTimeMillis() < expiresAt - 60_000L) return@synchronized again
            val body = FormBody.Builder()
                .add("client_id", CLIENT_ID)
                .add("refresh_token", refresh)
                .add("grant_type", "refresh_token")
                .build()
            val json = post(TOKEN_URL, body)
            val fresh = json?.optString("access_token")?.takeIf { it.isNotBlank() }
            if (fresh == null) {
                // `invalid_grant` means the user revoked access on their Google
                // account. Forget it so the UI can offer reconnecting instead of
                // retrying a dead token on every single play.
                if (json?.optString("error") == "invalid_grant") {
                    Log.w(TAG, "refresh token revoked; signing out")
                    signOut()
                }
                null
            } else {
                store(refresh, fresh, json.optInt("expires_in", 3600))
                fresh
            }
        }
    }

    private fun store(refresh: String, access: String?, expiresIn: Int) {
        refreshToken = refresh
        accessToken = access?.takeIf { it.isNotBlank() }
        expiresAt = System.currentTimeMillis() + expiresIn * 1000L
        try {
            prefs()?.edit()
                ?.putString(K_REFRESH, refresh)
                ?.putString(K_ACCESS, accessToken)
                ?.putLong(K_EXPIRES, expiresAt)
                ?.apply()
        } catch (_: Throwable) { /* best effort */ }
    }

    private fun post(url: String, body: FormBody): JSONObject? = try {
        http.newCall(
            Request.Builder()
                .url(url)
                .header("User-Agent", "Mozilla/5.0")
                .post(body)
                .build(),
        ).execute().use { r ->
            val raw = r.body?.string() ?: return null
            JSONObject(raw)
        }
    } catch (t: Throwable) {
        Log.w(TAG, "POST $url failed: ${t.message}")
        null
    }
}
