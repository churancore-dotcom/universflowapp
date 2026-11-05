import { useSplashActive } from './splash-context';

// One wavelength is 30 user units, so translating by exactly 30 loops seamlessly.
const WAVE_MAIN =
  'M -30 20 Q -22.5 0 -15 20 T 0 20 T 15 20 T 30 20 T 45 20 T 60 20 T 75 20 T 90 20 T 105 20 T 120 20 T 135 20 T 150 20';
const WAVE_ECHO =
  'M -30 20 Q -22.5 32 -15 20 T 0 20 T 15 20 T 30 20 T 45 20 T 60 20 T 75 20 T 90 20 T 105 20 T 120 20 T 135 20 T 150 20';

/** Shared by router pending state, lazy pages and account/access gates. */
export default function PageLoader() {
  // Never stack under the opening splash — the fade would reveal a second loader.
  if (useSplashActive()) return null;
  return (
    <div className="uf-page-loading" role="status" aria-label="Loading page" aria-live="polite">
      <div className="uf-loader" aria-hidden="true">
        <svg className="uf-loader-wave" viewBox="0 0 120 40" preserveAspectRatio="xMidYMid meet" fill="none">
          <g className="uf-wave-group">
            <path className="uf-wave uf-wave--echo" d={WAVE_ECHO} />
            <path className="uf-wave uf-wave--main" d={WAVE_MAIN} />
          </g>
        </svg>
      </div>
      <p className="uf-loading-name">Univers Flow</p>
    </div>
  );
}
