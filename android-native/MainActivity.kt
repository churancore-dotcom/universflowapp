package com.universeflow.app

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.webkit.PermissionRequest
import android.webkit.WebView
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.getcapacitor.BridgeActivity
import com.getcapacitor.BridgeWebChromeClient
import com.universeflow.app.media.MediaNotificationPlugin

class MainActivity : BridgeActivity() {

    private val cameraReqCode = 4711
    private var pendingPermissionRequest: PermissionRequest? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(AudioFocusPlugin::class.java)
        registerPlugin(MediaNotificationPlugin::class.java)
        super.onCreate(savedInstanceState)

        // IMPORTANT: We do NOT request CAMERA up-front. The runtime prompt is
        // deferred until the WebView's face-liveness step actually calls
        // getUserMedia(); see onPermissionRequest below.
        bridge.webView?.let { web: WebView ->
            web.settings.javaScriptEnabled = true
            web.settings.mediaPlaybackRequiresUserGesture = false
            web.settings.allowFileAccess = true
            web.settings.allowContentAccess = true
            web.webChromeClient = object : BridgeWebChromeClient(bridge) {
                override fun onPermissionRequest(request: PermissionRequest) {
                    runOnUiThread {
                        val needsCamera = request.resources.any {
                            it == PermissionRequest.RESOURCE_VIDEO_CAPTURE
                        }
                        if (needsCamera
                            && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
                            && ContextCompat.checkSelfPermission(
                                this@MainActivity, Manifest.permission.CAMERA
                            ) != PackageManager.PERMISSION_GRANTED
                        ) {
                            pendingPermissionRequest = request
                            ActivityCompat.requestPermissions(
                                this@MainActivity,
                                arrayOf(Manifest.permission.CAMERA),
                                cameraReqCode
                            )
                        } else {
                            try { request.grant(request.resources) }
                            catch (_: Throwable) { request.deny() }
                        }
                    }
                }
            }
        }
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == cameraReqCode) {
            val req = pendingPermissionRequest
            pendingPermissionRequest = null
            if (req != null) {
                val granted = grantResults.isNotEmpty()
                    && grantResults[0] == PackageManager.PERMISSION_GRANTED
                runOnUiThread {
                    try {
                        if (granted) req.grant(req.resources) else req.deny()
                    } catch (_: Throwable) { /* noop */ }
                }
            }
        }
    }
}
