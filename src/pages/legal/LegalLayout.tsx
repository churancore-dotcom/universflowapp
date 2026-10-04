import { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useNavigate } from '@/lib/router-compat';
import SEOHead from '@/components/SEOHead';
import { FadeTransition } from '@/components/PageTransition';

export default function LegalLayout({
  title,
  updated,
  path,
  description,
  children,
}: {
  title: string;
  updated: string;
  path: string;
  description: string;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  return (
    <FadeTransition>
      <SEOHead title={`${title} — Universflow`} description={description} path={path} />
      <div className="min-h-[100dvh] bg-background text-foreground">
        <header className="sticky top-0 z-20 bg-background/85 backdrop-blur-xl border-b border-border/60">
          <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
            <button
              onClick={() => navigate(-1)}
              aria-label="Back"
              className="w-9 h-9 rounded-full flex items-center justify-center active:scale-95 transition bg-white/[0.04]"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <h1 className="text-[15px] font-semibold tracking-tight">{title}</h1>
          </div>
        </header>

        <main className="max-w-2xl mx-auto px-6 pb-32 pt-8">
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground/70 mb-8">
            Last updated · {updated}
          </p>
          <article className="legal-article max-w-none">{children}</article>
        </main>
      </div>
    </FadeTransition>
  );
}
