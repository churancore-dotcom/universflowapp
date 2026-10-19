package com.universeflow.app

import kotlin.math.cos
import kotlin.math.sin

object TransitionEnvelope {
    fun gains(curve: String, progress: Double): Pair<Float, Float> {
        val p = progress.coerceIn(0.0, 1.0)
        return when (curve) {
            "equal-power" -> Pair(cos(p * Math.PI / 2).toFloat(), sin(p * Math.PI / 2).toFloat())
            "smooth" -> { val s = p * p * (3 - 2 * p); Pair((1 - s).toFloat(), s.toFloat()) }
            "exponential" -> Pair(((1 - p) * (1 - p)).toFloat(), (p * p).toFloat())
            else -> Pair((1 - p).toFloat(), p.toFloat())
        }
    }

    fun window(crossfade: Boolean, duration: Double, pro: Boolean, repeatOne: Boolean): Double =
        if (repeatOne) 0.0 else if (crossfade) duration.coerceIn(1.0, 12.0) else if (pro) 0.45 else 0.0
}