/** Shared by router pending state, lazy pages and account/access gates. */
export default function PageLoader() {
  return (
    <div className="uf-page-loading" role="status" aria-label="Loading page" aria-live="polite">
      <div className="uf-loading-stage" aria-hidden="true">
        <div className="uf-loading-record">
          <div className="uf-loading-label"><span /></div>
          <div className="uf-loading-reflection" />
        </div>
        <div className="uf-loading-needle"><span /></div>
      </div>
      <p className="uf-loading-name">Univers Flow</p>
      <div className="uf-loading-track" aria-hidden="true"><span /></div>
    </div>
  );
}
