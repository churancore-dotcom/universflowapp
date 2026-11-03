package com.universeflow.app

import kotlin.math.cos
import kotlin.math.sin

object TransitionEnvelope {
    fun gains(curve: String, progress: Double): Pair<Float, Float> {
        val p = progress.coerceIn(0.0, 1.0)
        val raw = when (curve) {
            // DJ: constant loudness, no mid-fade dip.
            "equal-power" -> Pair(cos(p * Math.PI / 2).toFloat(), sin(p * Math.PI / 2).toFloat())
            // Smooth: quintic smootherstep — very gradual, long gentle blend.
            // Constant-power too, so the blend never dips in loudness mid-way.
            "smooth" -> { val s = p * p * p * (p * (6 * p - 15) + 10); Pair(cos(s * Math.PI / 2).toFloat(), sin(s * Math.PI / 2).toFloat()) }
            // Punch: outgoing holds loud then drops, incoming swells late and slams in.
            // (The old cubic pair dropped BOTH songs to ~-18 dB mid-fade: a hole.)
            "exponential" -> { val s = p * p * (3 - 2 * p); val t = s * s; Pair(cos(t * Math.PI / 2).toFloat(), sin(t * Math.PI / 2).toFloat()) }
            // Linear: classic even swap with an audible mid-fade dip.
            else -> Pair((1 - p).toFloat(), p.toFloat())
        }
        // Do not normalize by the sum: it destroys the equal-power curve and
        // makes its midpoint identical to linear. Each player stays <= unity.
        return raw
    }

    fun window(crossfade: Boolean, duration: Double, pro: Boolean, repeatOne: Boolean): Double =
        if (repeatOne) 0.0 else if (crossfade) duration.coerceIn(1.0, 12.0) else if (pro) 0.45 else 0.0
}