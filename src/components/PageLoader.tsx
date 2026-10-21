/** Shown while a page's code or data loads — never a blank screen. */
export default function PageLoader() {
  return (
    <div className="min-h-dvh w-full bg-background flex flex-col items-center justify-center gap-5" role="status" aria-label="Loading">
      <div className="flex items-end gap-1.5 h-10">
        {[0, 1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className="w-1.5 rounded-full bg-primary uf-eq-bar"
            style={{ animationDelay: `${i * 0.12}s` }}
          />
        ))}
      </div>
      <p className="text-[11px] uppercase tracking-[0.3em] text-muted-foreground">Univers Flow</p>
    </div>
  );
}
