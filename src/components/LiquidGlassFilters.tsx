/**
 * Real refraction primitives for the Liquid Glass surface language.
 *
 * `backdrop-filter: url(#…)` lets a Chromium-based engine (which is what the
 * Android WebView shell runs) push the *content behind* a surface through an
 * SVG filter graph. We use a fractal-noise displacement map so the glass edge
 * genuinely bends what's underneath it — instead of only blurring it — plus a
 * chromatic variant that splits R/B slightly at the rim like thick glass does.
 *
 * Rendered once, zero-sized, behind everything. Engines without url() support
 * simply ignore the filter and keep the blur-only look.
 */
const LiquidGlassFilters = () => (
  <svg
    aria-hidden
    focusable="false"
    width="0"
    height="0"
    style={{ position: 'fixed', width: 0, height: 0, pointerEvents: 'none' }}
  >
    <defs>
      {/* Edge refraction — the lens band around every glass surface. */}
      <filter id="uf-liquid-warp" x="-20%" y="-20%" width="140%" height="140%" colorInterpolationFilters="sRGB">
        <feTurbulence
          type="fractalNoise"
          baseFrequency="0.006 0.012"
          numOctaves={2}
          seed={7}
          result="noise"
        >
          <animate
            attributeName="baseFrequency"
            dur="18s"
            values="0.006 0.012; 0.010 0.007; 0.006 0.012"
            repeatCount="indefinite"
          />
        </feTurbulence>
        <feGaussianBlur in="noise" stdDeviation="1.4" result="softNoise" />
        <feDisplacementMap
          in="SourceGraphic"
          in2="softNoise"
          scale={34}
          xChannelSelector="R"
          yChannelSelector="G"
        />
      </filter>

      {/* Thicker, chromatic version used on hero / player surfaces. */}
      <filter id="uf-liquid-prism" x="-25%" y="-25%" width="150%" height="150%" colorInterpolationFilters="sRGB">
        <feTurbulence type="fractalNoise" baseFrequency="0.004 0.009" numOctaves={3} seed={19} result="n" />
        <feGaussianBlur in="n" stdDeviation="2" result="sn" />
        <feDisplacementMap in="SourceGraphic" in2="sn" scale={26} xChannelSelector="R" yChannelSelector="G" result="warp" />
        <feOffset in="warp" dx="1.1" dy="0" result="rShift" />
        <feOffset in="warp" dx="-1.1" dy="0" result="bShift" />
        <feColorMatrix
          in="rShift"
          type="matrix"
          values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"
          result="rOnly"
        />
        <feColorMatrix
          in="warp"
          type="matrix"
          values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0"
          result="gOnly"
        />
        <feColorMatrix
          in="bShift"
          type="matrix"
          values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0"
          result="bOnly"
        />
        <feBlend in="rOnly" in2="gOnly" mode="screen" result="rg" />
        <feBlend in="rg" in2="bOnly" mode="screen" />
      </filter>
    </defs>
  </svg>
);

export default LiquidGlassFilters;
