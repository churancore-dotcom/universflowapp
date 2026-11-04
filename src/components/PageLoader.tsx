import { useSplashActive } from './splash-context';

/** Shared by router pending state, lazy pages and account/access gates. */
export default function PageLoader() {
  // Never stack under the opening splash — the fade would reveal a second loader.
  if (useSplashActive()) return null;
  return (
    <div className="uf-page-loading" role="status" aria-label="Loading page" aria-live="polite">
      <div className="uf-loader" aria-hidden="true">
        <div className="uf-loader-ring" />
        <div className="uf-loader-core"><span /><span /><span /><span /></div>
      </div>
      <p className="uf-loading-name">Univers Flow</p>
    </div>
  );
}
