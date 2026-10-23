import { useSplashActive } from './splash-context';

/** Shared by router pending state, lazy pages and account/access gates. */
export default function PageLoader() {
  // Never stack under the opening splash — the fade would reveal a second loader.
  if (useSplashActive()) return null;
  return (
    <div className="uf-page-loading" role="status" aria-label="Loading page" aria-live="polite">
      <div className="uf-loading-bars" aria-hidden="true">
        <span /><span /><span /><span /><span />
      </div>
      <p className="uf-loading-name">Univers Flow</p>
    </div>
  );
}
