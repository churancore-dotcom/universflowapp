package com.universeflow.app

import java.util.Random
import java.util.concurrent.Executors
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.ln
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * Studio Space room engine for the ExoPlayer PCM path: real convolution with
 * physically modelled room impulse responses.
 *
 * Why the previous engines sounded "dead": an algorithmic delay network can
 * only approximate a room, and calibrated for safety it sat 10-22 dB under
 * the song (measured on real music), so phones played back a nearly dry
 * track. Real rooms are not subtle: in a concert hall the reverberant energy
 * is close to the direct sound, in a cathedral it exceeds it.
 *
 * How each space is built (the same way acoustic simulators build them):
 *  1. A geometric model of the place: dimensions, where the band stands and
 *     where you stand, which surfaces exist (an open-air stadium has no roof,
 *     a canyon only has two rock walls) and what they are made of.
 *  2. Image-source method: every wall bounce up to the room's order becomes
 *     an exact reflection with its true arrival time, 1/distance loss,
 *     per-octave surface absorption and air absorption (ISO 9613 values), so
 *     a stadium's back stand slaps back after half a second and a canyon's
 *     walls answer each other left and right.
 *  3. A diffuse late tail per octave band, decaying with that band's measured
 *     RT60 (wood halls keep their bass, stone keeps treble, crowds and open
 *     air swallow highs), with the statistical energy a room of that volume
 *     really has relative to its reflections.
 *  4. Two spaced, angled microphones (ORTF-style) at the listening seat give
 *     natural interaural delays and a wide, decorrelated stereo field.
 *
 * The resulting stereo impulse response is convolved with the song in real
 * time using a non-uniform partitioned FFT convolution (64 / 1024 / 8192
 * blocks), so the dry path has zero added latency and the cost stays a few
 * percent of one core. Impulse responses are synthesised once per space on a
 * background thread and cached; rooms only swap while faded out.
 *
 * Clean-but-audible rules: the dry track is never EQ'd (only a gentle level
 * trim so total loudness stays constant), the room send is band-limited so
 * the low end stays tight, the room is ducked a little by the dry envelope
 * (normalised from 16-bit scale) and the downstream look-ahead limiter
 * catches peaks.
 */
class RoomReverb {

    /** Physical description of one Studio Space. */
    class Character(
        val id: String,
        /** Width (x, lateral), depth (y), height (z) in metres. */
        val dims: FloatArray,
        /** Sound source (the band / PA) position in metres. */
        val src: FloatArray,
        /** Listening seat position in metres. */
        val lis: FloatArray,
        /** Reverberation time per octave band 125 Hz .. 8 kHz, seconds. */
        val rt: FloatArray,
        /** Highest image-source reflection order. */
        val maxOrder: Int,
        /**
         * Broadband reflectivity multiplier per surface: x0, x1, y0, y1,
         * floor, ceiling. 0 = no surface there (open air).
         */
        val surfaces: FloatArray = floatArrayOf(1f, 1f, 1f, 1f, 1f, 1f),
        /** Per-octave absorption override (open-air spaces); else Sabine. */
        val alpha: FloatArray? = null,
        /** Diffuse tail energy multiplier (scattering for open-air spaces). */
        val tailFactor: Float = 1f,
        /** 0..1 stereo decorrelation of the diffuse tail. */
        val width: Float = 1f,
        /** Room energy vs dry (dB, white-noise) at the reference wet value. */
        val roomDb: Float,
        /** Wet value the app sends for this space (maps to roomDb). */
        val refWet: Int,
        val sendHpHz: Float,
        val maxLenSec: Float,
    )

    // ------------------------------------------------------------ settings
    private var sampleRate = 44100
    @Volatile private var targetWet = 0f
    @Volatile private var wanted: Character = PLAIN_DEFAULT
    @Volatile private var requestedKey: String = ""
    @Volatile private var ready: ConvState? = null
    @Volatile private var clearOnNextProcess = false

    // ------------------------------------------------------- audio thread
    private var state: ConvState? = null
    private var currentWet = 0f
    private var fade = 1f
    private var fadeTarget = 1f
    private var fadeStep = 0.001f
    private var smoothing = 0.0008f
    private var env = 0f
    private var envAttack = 0.01f
    private var envRelease = 0.0005f
    // Send filter state (2nd-order high-pass + one-pole low-pass).
    private var hx1 = 0f; private var hx2 = 0f; private var hy1 = 0f; private var hy2 = 0f
    private var lpState = 0f
    private val tmp = FloatArray(2)

    val isActive: Boolean
        get() = targetWet > 0.0005f || currentWet > 0.0005f

    /** Id of the room currently audible (for tests/diagnostics). */
    val activeId: String? get() = state?.kernel?.id

    fun configure(rate: Int) {
        sampleRate = if (rate > 0) rate else 44100
        val sr = sampleRate.toFloat()
        envAttack = 1f - kotlin.math.exp(-1f / (sr * 0.03f))
        envRelease = 1f - kotlin.math.exp(-1f / (sr * 0.35f))
        smoothing = 1f - kotlin.math.exp(-1f / (sr * 0.035f))
        fadeStep = 64f / (sr * 0.04f) // applied once per 64-sample block
        if (state?.kernel?.sr != sampleRate) state = null
        resetSend()
        requestBuild(wanted)
    }

    /**
     * @param kind          Studio Space id (hall, stadium, ...). Null/unknown
     *                      builds a generic room from the numbers below
     *                      (used by the plain reverb slider).
     * @param roomPercent   0..100 tail length
     * @param dampPercent   0..100 high-frequency absorption
     * @param wetPercent    0..100 room level
     * @param widthPercent  0..100 stereo spread
     * @param preDelayMs    0..240 initial gap (generic rooms derive it from size)
     * @param sizePercent   50..240 physical room scaling
     */
    fun setSpace(
        roomPercent: Int,
        dampPercent: Int,
        wetPercent: Int,
        widthPercent: Int,
        preDelayMs: Int,
        sizePercent: Int,
        kind: String? = null,
    ) {
        val wet = wetPercent.coerceIn(0, 100) / 100f
        if (targetWet <= 0.0005f && wet > 0.0005f) clearOnNextProcess = true
        targetWet = wet
        val next = kind?.let { CHARACTERS[it] } ?: genericCharacter(roomPercent, dampPercent, widthPercent, sizePercent)
        if (next.id != wanted.id) {
            wanted = next
            requestBuild(next)
        }
    }

    fun reset() {
        state?.clear()
        currentWet = 0f
        env = 0f
        resetSend()
        val r = ready
        if (r != null && r !== state && r.key == requestedKey) state = r
        fade = 1f
        fadeTarget = 1f
    }

    /** Called once per 64-sample audio block on the audio thread. */
    fun tickBlock() {
        val r = ready
        if (r != null && r !== state && r.key == requestedKey) {
            if (state == null || currentWet <= 0.0005f || fade <= 0.0005f) {
                state = r
                resetSend()
                fade = if (currentWet <= 0.0005f) 1f else 0f
                fadeTarget = 1f
            } else {
                fadeTarget = 0f
            }
        }
        if (fade != fadeTarget) {
            fade = if (fade < fadeTarget) min(fadeTarget, fade + fadeStep) else max(fadeTarget, fade - fadeStep)
        }
    }

    /** Adds the room to a stereo sample pair (16-bit sample scale). */
    fun process(inL: Float, inR: Float, out: FloatArray) {
        currentWet += smoothing * (targetWet - currentWet)
        val st = state
        if (currentWet <= 0.0005f || st == null) {
            out[0] = inL
            out[1] = inR
            return
        }
        if (clearOnNextProcess) {
            clearOnNextProcess = false
            st.clear()
            resetSend()
        }
        val k = st.kernel
        // Mono, band-limited send: tight low end, no sibilant splash.
        val x = (inL + inR) * 0.5f
        val hp = k.hb0 * x + k.hb1 * hx1 + k.hb2 * hx2 - k.ha1 * hy1 - k.ha2 * hy2
        hx2 = hx1; hx1 = x; hy2 = hy1; hy1 = hp + DENORMAL_GUARD
        lpState += k.lpCoeff * (hp - lpState)
        st.process(lpState, tmp)

        val level = max(abs(inL), abs(inR)) * INV_FULL_SCALE
        env += (if (level > env) envAttack else envRelease) * (level - env)
        val dx = (env * 3f).coerceIn(0f, 1f)
        val duck = 1f - 0.22f * (dx * dx * (3f - 2f * dx))

        val amp = (currentWet * 100f / k.refWet).coerceIn(0f, 2f) * fade
        val g = amp * k.gain * duck
        // Keep total loudness constant: the louder the room, the more the
        // direct sound steps back (pure gain, never EQ).
        val roomPower = amp * amp * k.roomPower
        val dry = 1f / sqrt(1f + roomPower)
        out[0] = inL * dry + tmp[0] * g
        out[1] = inR * dry + tmp[1] * g
    }

    private fun resetSend() {
        hx1 = 0f; hx2 = 0f; hy1 = 0f; hy2 = 0f; lpState = 0f
    }

    private fun requestBuild(c: Character) {
        val sr = sampleRate
        val key = "${c.id}@$sr"
        requestedKey = key
        val cachedState = ready
        if (cachedState != null && cachedState.key == key) return
        if (state?.key == key) { ready = state; return }
        BUILDER.execute {
            if (requestedKey != key) return@execute
            try {
                val kernel = kernelFor(c, sr)
                val st = ConvState(kernel, key)
                if (requestedKey == key) ready = st
            } catch (_: Throwable) {
                // Out of memory or similar: stay dry rather than crash playback.
            }
        }
    }

    // ================================================================ FFT
    internal class Fft(val n: Int) {
        private val cosT = FloatArray(n / 2)
        private val sinT = FloatArray(n / 2)
        private val rev = IntArray(n)

        init {
            var bits = 0
            while ((1 shl bits) < n) bits++
            for (i in 0 until n) {
                var r = 0
                var v = i
                for (b in 0 until bits) { r = (r shl 1) or (v and 1); v = v shr 1 }
                rev[i] = r
            }
            for (k in 0 until n / 2) {
                cosT[k] = cos(2.0 * PI * k / n).toFloat()
                sinT[k] = (-sin(2.0 * PI * k / n)).toFloat()
            }
        }

        /** In-place complex FFT on interleaved re/im data. */
        fun transform(a: FloatArray, inverse: Boolean) {
            for (i in 0 until n) {
                val j = rev[i]
                if (j > i) {
                    val ri = 2 * i; val rj = 2 * j
                    var t = a[ri]; a[ri] = a[rj]; a[rj] = t
                    t = a[ri + 1]; a[ri + 1] = a[rj + 1]; a[rj + 1] = t
                }
            }
            var size = 2
            while (size <= n) {
                val half = size shr 1
                val step = n / size
                var start = 0
                while (start < n) {
                    var k = 0
                    for (j in 0 until half) {
                        val wr = cosT[k]
                        val wi = if (inverse) -sinT[k] else sinT[k]
                        val i1 = 2 * (start + j)
                        val i2 = 2 * (start + j + half)
                        val xr = a[i2]; val xi = a[i2 + 1]
                        val tr = xr * wr - xi * wi
                        val ti = xr * wi + xi * wr
                        a[i2] = a[i1] - tr; a[i2 + 1] = a[i1 + 1] - ti
                        a[i1] += tr; a[i1 + 1] += ti
                        k += step
                    }
                    start += size
                }
                size = size shl 1
            }
            if (inverse) {
                val s = 1f / n
                for (i in 0 until 2 * n) a[i] *= s
            }
        }
    }

    // ============================================================ kernels
    /** Immutable, shareable convolution kernel for one space at one rate. */
    internal class Kernel(
        val id: String,
        val sr: Int,
        val directIdx: IntArray,
        val directL: FloatArray,
        val directR: FloatArray,
        val blocks: IntArray,
        /** Per tier: partitions of G = FFT(hL + i*hR), interleaved complex. */
        val parts: Array<Array<FloatArray>>,
        val ffts: Array<Fft>,
        val gain: Float,
        val roomPower: Float,
        val refWet: Int,
        val hb0: Float, val hb1: Float, val hb2: Float, val ha1: Float, val ha2: Float,
        val lpCoeff: Float,
    )

    /** Per-instance convolution state (frequency-domain delay lines). */
    internal class ConvState(val kernel: Kernel, val key: String) {
        private val tiers = Array(kernel.blocks.size) { Tier(kernel.blocks[it], kernel.parts[it], kernel.ffts[it]) }
        private val hist = FloatArray(DIRECT_LEN)
        private var histPos = 0

        fun clear() {
            tiers.forEach { it.clear() }
            hist.fill(0f)
            histPos = 0
        }

        fun process(x: Float, out: FloatArray) {
            var l = 0f
            var r = 0f
            // Sparse direct taps for the first reflections (< 64 samples).
            hist[histPos] = x
            val idx = kernel.directIdx
            for (i in idx.indices) {
                var p = histPos - idx[i]
                if (p < 0) p += DIRECT_LEN
                val v = hist[p]
                l += v * kernel.directL[i]
                r += v * kernel.directR[i]
            }
            if (++histPos >= DIRECT_LEN) histPos = 0
            for (t in tiers) {
                l += t.outL[t.pos]
                r += t.outR[t.pos]
                t.push(x)
            }
            out[0] = l
            out[1] = r
        }
    }

    /**
     * One uniformly partitioned overlap-save convolver. Its partitions start
     * at IR offset == block size, so its one-block latency lines up exactly.
     * Older partitions are multiply-accumulated gradually between block
     * boundaries so large blocks never cause a CPU spike.
     */
    internal class Tier(private val b: Int, private val g: Array<FloatArray>, private val fft: Fft) {
        private val n = 2 * b
        private val p = g.size
        private val inBuf = FloatArray(n)
        private val fdl = Array(p) { FloatArray(2 * n) }
        private var head = 0
        private val acc = FloatArray(2 * n)
        private val work = FloatArray(2 * n)
        val outL = FloatArray(b)
        val outR = FloatArray(b)
        var pos = 0
        private var nextPart = 1

        fun clear() {
            inBuf.fill(0f); fdl.forEach { it.fill(0f) }; acc.fill(0f)
            outL.fill(0f); outR.fill(0f); pos = 0; nextPart = 1; head = 0
        }

        fun push(x: Float) {
            inBuf[b + pos] = x
            pos++
            if (pos == b) {
                boundary()
            } else if (p > 1 && (pos and 63) == 0 && nextPart < p) {
                val left = max(1, (b - pos) shr 6)
                val share = (p - nextPart + left - 1) / left
                macRange(share)
            }
        }

        private fun macRange(count: Int) {
            var c = count
            while (c > 0 && nextPart < p) {
                var slot = head + 1 - nextPart
                while (slot < 0) slot += p
                mac(fdl[slot % p], g[nextPart])
                nextPart++
                c--
            }
        }

        private fun mac(x: FloatArray, h: FloatArray) {
            var i = 0
            val len = 2 * n
            while (i < len) {
                val xr = x[i]; val xi = x[i + 1]
                val hr = h[i]; val hi = h[i + 1]
                acc[i] += xr * hr - xi * hi
                acc[i + 1] += xr * hi + xi * hr
                i += 2
            }
        }

        private fun boundary() {
            macRange(p)
            for (i in 0 until n) { work[2 * i] = inBuf[i]; work[2 * i + 1] = 0f }
            fft.transform(work, false)
            head = (head + 1) % p
            System.arraycopy(work, 0, fdl[head], 0, 2 * n)
            mac(fdl[head], g[0])
            System.arraycopy(acc, 0, work, 0, 2 * n)
            fft.transform(work, true)
            for (i in 0 until b) {
                outL[i] = work[2 * (b + i)]
                outR[i] = work[2 * (b + i) + 1]
            }
            acc.fill(0f)
            nextPart = 1
            System.arraycopy(inBuf, b, inBuf, 0, b)
            pos = 0
        }
    }

    companion object {
        private const val INV_FULL_SCALE = 1f / 32768f
        private const val DENORMAL_GUARD = 1e-20f
        internal const val DIRECT_LEN = 64
        private val TIER_BLOCKS = intArrayOf(64, 1024, 8192)
        private const val SPEED_OF_SOUND = 343f
        private val BAND_HZ = floatArrayOf(125f, 250f, 500f, 1000f, 2000f, 4000f, 8000f)
        /** ISO 9613-1 air absorption, dB per metre (20 C, ~50% RH). */
        private val AIR_DB_PER_M = floatArrayOf(0.0004f, 0.0011f, 0.0024f, 0.0045f, 0.0093f, 0.028f, 0.095f)

        private val BUILDER = Executors.newSingleThreadExecutor { r ->
            Thread(r, "RoomReverbBuild").apply { isDaemon = true; priority = Thread.NORM_PRIORITY - 1 }
        }
        private val CACHE = object : LinkedHashMap<String, Kernel>(8, 0.75f, true) {
            override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Kernel>?): Boolean = size > 3
        }

        internal fun kernelFor(c: Character, sr: Int): Kernel {
            val key = "${c.id}@$sr"
            synchronized(CACHE) { CACHE[key]?.let { return it } }
            val (hl, hr) = synthesize(c, sr)
            val k = buildKernel(c, sr, hl, hr)
            synchronized(CACHE) { CACHE[key] = k }
            return k
        }

        /** Stereo impulse response of a space (direct sound excluded). */
        fun synthesize(c: Character, sr: Int): Pair<FloatArray, FloatArray> {
            val len = (c.maxLenSec * sr).toInt().coerceAtLeast(2 * DIRECT_LEN)
            val hl = FloatArray(len)
            val hr = FloatArray(len)
            val lx = c.dims[0]; val ly = c.dims[1]; val lz = c.dims[2]
            val volume = lx * ly * lz
            val area = 2f * (lx * ly + lx * lz + ly * lz)
            val sx = c.src[0]; val sy = c.src[1]; val sz = c.src[2]
            val dxs = c.src[0] - c.lis[0]; val dys = c.src[1] - c.lis[1]; val dzs = c.src[2] - c.lis[2]
            val r = sqrt(dxs * dxs + dys * dys + dzs * dzs).coerceAtLeast(0.5f)

            // Two ORTF-style microphones at the seat, facing the source.
            val fh = sqrt(dxs * dxs + dys * dys).coerceAtLeast(1e-3f)
            val fx = dxs / fh; val fy = dys / fh
            val leftX = -fy; val leftY = fx
            val micPos = arrayOf(
                floatArrayOf(c.lis[0] + leftX * 0.085f, c.lis[1] + leftY * 0.085f, c.lis[2]),
                floatArrayOf(c.lis[0] - leftX * 0.085f, c.lis[1] - leftY * 0.085f, c.lis[2]),
            )
            val ang = 55.0 * PI / 180.0
            val ca = cos(ang).toFloat(); val sa = sin(ang).toFloat()
            val micAxis = arrayOf(
                floatArrayOf(fx * ca - fy * sa, fx * sa + fy * ca),
                floatArrayOf(fx * ca + fy * sa, -fx * sa + fy * ca),
            )

            // Image sources: (position, surface bounce counts) -> per mic delay/gain.
            class Img(val d: FloatArray, val t: FloatArray, val dir: FloatArray, val surf: Float, val order: Int)
            val images = ArrayList<Img>()
            val m = c.maxOrder
            var firstT = Float.MAX_VALUE
            for (ux in 0..1) for (mx in -m..m) {
                val nx0 = abs(mx - ux); val nx1 = abs(mx)
                if (nx0 + nx1 > m) continue
                val sxx = if (nx0 + nx1 == 0) 1f else c.surfaces[0].pow(nx0) * c.surfaces[1].pow(nx1)
                if (sxx <= 0f) continue
                val ix = (1 - 2 * ux) * sx + 2 * mx * lx
                for (uy in 0..1) for (my in -m..m) {
                    val ny0 = abs(my - uy); val ny1 = abs(my)
                    if (nx0 + nx1 + ny0 + ny1 > m) continue
                    val syy = if (ny0 + ny1 == 0) 1f else c.surfaces[2].pow(ny0) * c.surfaces[3].pow(ny1)
                    if (syy <= 0f) continue
                    val iy = (1 - 2 * uy) * sy + 2 * my * ly
                    for (uz in 0..1) for (mz in -m..m) {
                        val nz0 = abs(mz - uz); val nz1 = abs(mz)
                        val order = nx0 + nx1 + ny0 + ny1 + nz0 + nz1
                        if (order > m || order == 0) continue
                        val szz = if (nz0 + nz1 == 0) 1f else c.surfaces[4].pow(nz0) * c.surfaces[5].pow(nz1)
                        if (szz <= 0f) continue
                        val iz = (1 - 2 * uz) * sz + 2 * mz * lz
                        val d = FloatArray(2); val t = FloatArray(2); val dir = FloatArray(2)
                        var ok = false
                        for (mic in 0..1) {
                            val ex = ix - micPos[mic][0]; val ey = iy - micPos[mic][1]; val ez = iz - micPos[mic][2]
                            val dist = sqrt(ex * ex + ey * ey + ez * ez)
                            val tt = (dist - r) / SPEED_OF_SOUND
                            d[mic] = dist; t[mic] = max(0f, tt)
                            // Sub-cardioid pickup: rear sound is quieter, never gone.
                            val cosA = (ex * micAxis[mic][0] + ey * micAxis[mic][1]) / dist.coerceAtLeast(1e-3f)
                            dir[mic] = 0.62f + 0.38f * cosA
                            if (t[mic] * sr < len - 2) ok = true
                        }
                        if (!ok) continue
                        firstT = min(firstT, min(t[0], t[1]))
                        images.add(Img(d, t, dir, sxx * syy * szz, order))
                    }
                }
            }
            if (firstT == Float.MAX_VALUE) firstT = 0.005f

            val mixT = (sqrt(volume) / 1000f).coerceIn(0.006f, 0.12f)
            val tailStart = max(firstT, (DIRECT_LEN + 4f) / sr)
            val tailVar = r * r * 4f * PI.toFloat() * SPEED_OF_SOUND / (volume * sr) * c.tailFactor
            val sigma = sqrt(tailVar)
            val corr = (1f - c.width).coerceIn(0f, 1f)
            val corrB = sqrt(1f - corr * corr)
            val fade0 = (len * 0.85f).toInt()

            val bl = FloatArray(len)
            val br = FloatArray(len)
            for (b in BAND_HZ.indices) {
                bl.fill(0f); br.fill(0f)
                val rtB = c.rt[b].coerceIn(0.05f, 12f)
                val alphaB = c.alpha?.get(b) ?: (0.161f * volume / (area * rtB)).coerceIn(0.02f, 0.95f)
                val refl = sqrt(1f - alphaB)
                for (img in images) {
                    val bandRefl = refl.pow(img.order) * img.surf
                    for (mic in 0..1) {
                        val pos = img.t[mic] * sr
                        val i0 = pos.toInt()
                        if (i0 >= len - 1) continue
                        val air = 10f.pow(-AIR_DB_PER_M[b] * img.d[mic] / 20f)
                        val gain = (r / img.d[mic]) * bandRefl * air * img.dir[mic]
                        val frac = pos - i0
                        val buf = if (mic == 0) bl else br
                        buf[i0] += gain * (1f - frac)
                        buf[i0 + 1] += gain * frac
                    }
                }
                // Diffuse tail: Gaussian noise under this band's decay.
                val rnd = Random((c.id.hashCode() * 31 + b).toLong())
                val decayPerSample = 10.0.pow(-3.0 / (rtB * sr)).toFloat()
                val startIdx = (tailStart * sr).toInt()
                var envA = sigma * 10.0.pow(-3.0 * tailStart / rtB).toFloat()
                for (i in startIdx until len) {
                    val tt = i.toFloat() / sr
                    val on = ((tt - tailStart) / mixT).coerceIn(0f, 1f)
                    val onset = on * sqrt(on)
                    val a = envA * onset
                    val n1 = rnd.nextGaussian().toFloat()
                    val n2 = rnd.nextGaussian().toFloat()
                    bl[i] += a * n1
                    br[i] += a * (corr * n1 + corrB * n2)
                    envA *= decayPerSample
                }
                bandFilter(bl, b, sr)
                bandFilter(br, b, sr)
                for (i in 0 until len) { hl[i] += bl[i]; hr[i] += br[i] }
            }
            // Smooth end so truncation never clicks.
            for (i in fade0 until len) {
                val w = 0.5f + 0.5f * cos(PI * (i - fade0) / (len - fade0)).toFloat()
                hl[i] *= w; hr[i] *= w
            }
            // Normalise to this space's room level (energy vs dry).
            var e = 0.0
            for (i in 0 until len) e += (hl[i] * hl[i] + hr[i] * hr[i]) * 0.5
            val target = 10.0.pow(c.roomDb / 10.0)
            val s = if (e > 0.0) sqrt(target / e).toFloat() else 0f
            for (i in 0 until len) { hl[i] *= s; hr[i] *= s }
            return hl to hr
        }

        /** Octave band filter: low-pass / band-pass / high-pass (RBJ). */
        private fun bandFilter(x: FloatArray, band: Int, sr: Int) {
            val last = BAND_HZ.size - 1
            when (band) {
                0 -> { biquad(x, 0, 177f, 0.7071f, sr); biquad(x, 0, 177f, 0.7071f, sr) }
                last -> { biquad(x, 2, 5657f, 0.7071f, sr); biquad(x, 2, 5657f, 0.7071f, sr) }
                else -> biquad(x, 1, BAND_HZ[band], 1.414f, sr)
            }
        }

        /** type 0 = low-pass, 1 = band-pass (0 dB peak), 2 = high-pass. */
        private fun biquad(x: FloatArray, type: Int, f0: Float, q: Float, sr: Int) {
            val w = 2.0 * PI * min(f0.toDouble(), sr * 0.45) / sr
            val cw = cos(w); val alpha = sin(w) / (2.0 * q)
            val a0 = 1.0 + alpha
            val (b0, b1, b2) = when (type) {
                0 -> Triple((1 - cw) / 2, 1 - cw, (1 - cw) / 2)
                1 -> Triple(alpha, 0.0, -alpha)
                else -> Triple((1 + cw) / 2, -(1 + cw), (1 + cw) / 2)
            }
            val nb0 = b0 / a0; val nb1 = b1 / a0; val nb2 = b2 / a0
            val na1 = -2 * cw / a0; val na2 = (1 - alpha) / a0
            var x1 = 0.0; var x2 = 0.0; var y1 = 0.0; var y2 = 0.0
            for (i in x.indices) {
                val xi = x[i].toDouble()
                val y = nb0 * xi + nb1 * x1 + nb2 * x2 - na1 * y1 - na2 * y2
                x2 = x1; x1 = xi; y2 = y1; y1 = y
                x[i] = y.toFloat()
            }
        }

        private fun buildKernel(c: Character, sr: Int, hl: FloatArray, hr: FloatArray): Kernel {
            val len = hl.size
            // Direct taps for the first 64 samples (sparse early reflections).
            val di = ArrayList<Int>()
            for (i in 0 until min(DIRECT_LEN, len)) if (abs(hl[i]) > 1e-7f || abs(hr[i]) > 1e-7f) di.add(i)
            val blocks = ArrayList<Int>()
            val parts = ArrayList<Array<FloatArray>>()
            val ffts = ArrayList<Fft>()
            for (t in TIER_BLOCKS.indices) {
                val b = TIER_BLOCKS[t]
                val start = b
                val end = if (t + 1 < TIER_BLOCKS.size) min(len, TIER_BLOCKS[t + 1]) else len
                if (start >= end) break
                val n = 2 * b
                val fft = Fft(n)
                val count = (end - start + b - 1) / b
                val arr = Array(count) { pi ->
                    val buf = FloatArray(2 * n)
                    val off = start + pi * b
                    for (i in 0 until b) {
                        val j = off + i
                        if (j >= end) break
                        buf[2 * i] = hl[j]
                        buf[2 * i + 1] = hr[j]
                    }
                    fft.transform(buf, false)
                    buf
                }
                blocks.add(b); parts.add(arr); ffts.add(fft)
            }
            // Send high-pass (RBJ, Q 0.707).
            val w = 2.0 * PI * c.sendHpHz / sr
            val cw = cos(w); val alpha = sin(w) / (2.0 * 0.7071)
            val a0 = 1.0 + alpha
            val dt = 1f / sr
            val rc = 1f / (2f * PI.toFloat() * min(11000f, sr * 0.45f))
            return Kernel(
                id = c.id, sr = sr,
                directIdx = di.toIntArray(),
                directL = FloatArray(di.size) { hl[di[it]] },
                directR = FloatArray(di.size) { hr[di[it]] },
                blocks = blocks.toIntArray(),
                parts = parts.toTypedArray(),
                ffts = ffts.toTypedArray(),
                gain = 1f,
                roomPower = 10.0.pow(c.roomDb / 10.0).toFloat(),
                refWet = c.refWet.coerceAtLeast(1),
                hb0 = ((1 + cw) / 2 / a0).toFloat(), hb1 = (-(1 + cw) / a0).toFloat(), hb2 = ((1 + cw) / 2 / a0).toFloat(),
                ha1 = (-2 * cw / a0).toFloat(), ha2 = ((1 - alpha) / a0).toFloat(),
                lpCoeff = dt / (rc + dt),
            )
        }

        private fun f(vararg v: Float) = v

        private fun genericCharacter(room: Int, damp: Int, width: Int, size: Int): Character {
            // Quantised so slider drags don't rebuild on every step.
            val rq = (room.coerceIn(0, 100) / 5) * 5
            val dq = (damp.coerceIn(0, 100) / 10) * 10
            val wq = (width.coerceIn(0, 100) / 10) * 10
            val sq = (size.coerceIn(50, 240) / 10) * 10
            val rMid = 0.25f * 12f.pow(rq / 100f)
            val d = dq / 100f
            val s = sq / 100f
            val rt = f(1.15f, 1.1f, 1f, 1f, 1f - 0.3f * d, 1f - 0.5f * d, 1f - 0.7f * d).map { it * rMid }.toFloatArray()
            val lx = 12f * s; val ly = 16f * s; val lz = 5f * s.coerceAtMost(1.6f)
            return Character(
                id = "generic-$rq-$dq-$wq-$sq",
                dims = f(lx, ly, lz), src = f(lx * 0.5f, ly * 0.2f, 1.8f), lis = f(lx * 0.42f, ly * 0.6f, 1.2f),
                rt = rt, maxOrder = 3, width = wq / 100f,
                roomDb = -8f, refWet = 100, sendHpHz = 150f,
                maxLenSec = (rMid * 1.3f + 0.2f).coerceIn(0.3f, 4f),
            )
        }

        private val PLAIN_DEFAULT = genericCharacter(60, 45, 80, 100)

        /** Ids match the app's Studio Space ids. */
        val CHARACTERS: Map<String, Character> = listOf(
            // Vintage lacquer booth: tiny, padded, almost no tail.
            Character(
                id = "vinyl", dims = f(2.6f, 2.0f, 2.3f), src = f(1.3f, 0.5f, 1.4f), lis = f(1.1f, 1.5f, 1.2f),
                rt = f(0.26f, 0.22f, 0.18f, 0.15f, 0.12f, 0.1f, 0.08f), maxOrder = 6, width = 0.5f,
                roomDb = -14f, refWet = 26, sendHpHz = 220f, maxLenSec = 0.4f,
            ),
            // Treated studio live room: short, even, controlled.
            Character(
                id = "studio", dims = f(7f, 5.5f, 3.2f), src = f(3.5f, 1.5f, 1.5f), lis = f(3.2f, 4f, 1.2f),
                rt = f(0.42f, 0.36f, 0.32f, 0.3f, 0.28f, 0.26f, 0.22f), maxOrder = 5, width = 0.75f,
                roomDb = -12.5f, refWet = 32, sendHpHz = 180f, maxLenSec = 0.6f,
            ),
            // Furnished bedroom: close walls, soft furnishings eat the top.
            Character(
                id = "bedroom", dims = f(4.2f, 3.6f, 2.6f), src = f(2.1f, 0.6f, 1.2f), lis = f(1.8f, 2.8f, 1.1f),
                rt = f(0.55f, 0.45f, 0.38f, 0.33f, 0.28f, 0.23f, 0.18f), maxOrder = 5, width = 0.7f,
                roomDb = -11f, refWet = 38, sendHpHz = 180f, maxLenSec = 0.7f,
            ),
            // Concrete club: low ceiling, bass hangs, crowd soaks the highs.
            Character(
                id = "club", dims = f(22f, 16f, 4.5f), src = f(11f, 1.5f, 2.5f), lis = f(9f, 10f, 1.7f),
                rt = f(1.6f, 1.3f, 0.95f, 0.8f, 0.7f, 0.55f, 0.4f), maxOrder = 4, width = 0.85f,
                roomDb = -9f, refWet = 40, sendHpHz = 120f, maxLenSec = 1.8f,
            ),
            // Stone chapel: bright, clear side walls, singing tail.
            Character(
                id = "chapel", dims = f(10f, 24f, 11f), src = f(5f, 3f, 1.8f), lis = f(4f, 15f, 1.2f),
                rt = f(2.6f, 2.8f, 2.7f, 2.6f, 2.3f, 1.8f, 1.2f), maxOrder = 3, width = 0.9f,
                roomDb = -6.5f, refWet = 48, sendHpHz = 160f, maxLenSec = 3.2f,
            ),
            // Shoebox concert hall (Musikverein-class): lateral reflections, warm bloom.
            Character(
                id = "hall", dims = f(19f, 48f, 17f), src = f(9.5f, 5f, 1.8f), lis = f(7.5f, 23f, 1.2f),
                rt = f(2.6f, 2.4f, 2.15f, 2.0f, 1.8f, 1.5f, 1.1f), maxOrder = 3, width = 1f,
                roomDb = -6.5f, refWet = 50, sendHpHz = 120f, maxLenSec = 3f,
            ),
            // Opera house: wood and velvet, warm, wide, drier than a hall.
            Character(
                id = "opera", dims = f(28f, 32f, 22f), src = f(14f, 4f, 1.8f), lis = f(12f, 18f, 1.2f),
                rt = f(1.75f, 1.6f, 1.45f, 1.35f, 1.2f, 1.0f, 0.75f), maxOrder = 3, width = 1f,
                roomDb = -7.5f, refWet = 56, sendHpHz = 120f, maxLenSec = 2.2f,
            ),
            // Indoor arena: huge roof and far walls, long dark tail.
            Character(
                id = "arena", dims = f(85f, 115f, 34f), src = f(42f, 12f, 8f), lis = f(36f, 62f, 1.7f),
                rt = f(3.6f, 3.3f, 2.9f, 2.5f, 2.1f, 1.6f, 1.05f), maxOrder = 3, width = 1f,
                roomDb = -5.5f, refWet = 55, sendHpHz = 130f, maxLenSec = 3.8f,
            ),
            // Open-air stadium: no roof, the PA slaps back off far stands.
            Character(
                id = "stadium", dims = f(200f, 240f, 60f), src = f(100f, 25f, 10f), lis = f(88f, 105f, 1.7f),
                rt = f(2.2f, 2.0f, 1.8f, 1.6f, 1.3f, 1.0f, 0.7f), maxOrder = 3,
                surfaces = f(0.9f, 0.9f, 0.8f, 0.95f, 0.75f, 0f),
                alpha = f(0.2f, 0.25f, 0.3f, 0.35f, 0.4f, 0.45f, 0.5f),
                tailFactor = 6f, width = 1f,
                roomDb = -6.5f, refWet = 56, sendHpHz = 150f, maxLenSec = 2.8f,
            ),
            // Gothic cathedral: long stone nave, very long bright wash.
            Character(
                id = "cathedral", dims = f(32f, 95f, 30f), src = f(16f, 10f, 1.8f), lis = f(13f, 52f, 1.2f),
                rt = f(6.5f, 6.2f, 5.6f, 4.8f, 3.8f, 2.7f, 1.7f), maxOrder = 3, width = 1f,
                roomDb = -4f, refWet = 62, sendHpHz = 140f, maxLenSec = 5f,
            ),
            // Canyon: two far rock walls trading echoes left and right.
            Character(
                id = "canyon", dims = f(140f, 1000f, 200f), src = f(70f, 500f, 1.8f), lis = f(45f, 470f, 1.7f),
                rt = f(3.0f, 3.0f, 2.8f, 2.5f, 2.0f, 1.5f, 1.0f), maxOrder = 8,
                surfaces = f(0.95f, 0.95f, 0f, 0f, 0.5f, 0f),
                alpha = f(0.02f, 0.03f, 0.04f, 0.05f, 0.07f, 0.09f, 0.12f),
                tailFactor = 4f, width = 1f,
                roomDb = -6.5f, refWet = 62, sendHpHz = 160f, maxLenSec = 3.4f,
            ),
        ).associateBy { it.id }
    }
}
