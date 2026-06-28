package com.universeflow.app

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.os.Build
import android.provider.Settings
import android.speech.RecognizerIntent
import com.getcapacitor.ActivityResult
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import com.getcapacitor.PermissionState
import java.util.Locale

@CapacitorPlugin(
    name = "VoiceSearch",
    permissions = [Permission(alias = "microphone", strings = [Manifest.permission.RECORD_AUDIO])]
)
class VoiceSearchPlugin : Plugin() {

    @PluginMethod
    fun listen(call: PluginCall) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            requestPermissionForAlias("microphone", call, "microphonePermissionCallback")
            return
        }
        startVoiceIntent(call)
    }

    @PermissionCallback
    private fun microphonePermissionCallback(call: PluginCall) {
        if (getPermissionState("microphone") == PermissionState.GRANTED) {
            startVoiceIntent(call)
        } else {
            call.reject("Microphone permission denied")
        }
    }

    private fun startVoiceIntent(call: PluginCall) {
        try {
            val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault())
                putExtra(RecognizerIntent.EXTRA_PROMPT, "Say song name")
                putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
                putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false)
            }
            startActivityForResult(call, intent, "voiceResultCallback")
        } catch (e: Exception) {
            call.reject("Voice search is not available on this device", e)
        }
    }

    @ActivityCallback
    private fun voiceResultCallback(call: PluginCall, result: ActivityResult) {
        if (result.resultCode != Activity.RESULT_OK) {
            val ret = JSObject()
            ret.put("cancelled", true)
            call.resolve(ret)
            return
        }

        val data = result.data
        val matches = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)
        } else {
            @Suppress("DEPRECATION")
            data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)
        }
        val transcript = matches?.firstOrNull().orEmpty()
        val ret = JSObject()
        ret.put("transcript", transcript)
        call.resolve(ret)
    }
}
