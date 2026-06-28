package com.universeflow.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

@CapacitorPlugin(name = "AudioFocus")
class AudioFocusPlugin : Plugin() {

    private val receiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            val action = intent?.getStringExtra("action") ?: return
            val data = JSObject().put("action", action)
            notifyListeners("audioFocus", data)
        }
    }

    override fun load() {
        super.load()
        val filter = IntentFilter("com.universeflow.AUDIO_ACTION")
        val ctx = context.applicationContext
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            ctx.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            @Suppress("UnspecifiedRegisterReceiverFlag")
            ctx.registerReceiver(receiver, filter)
        }
    }

    override fun handleOnDestroy() {
        try { context.applicationContext.unregisterReceiver(receiver) } catch (_: Throwable) {}
        super.handleOnDestroy()
    }

    @PluginMethod
    fun keepAlive(call: PluginCall) {
        call.resolve()
    }
}
