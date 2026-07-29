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
        <header className="sticky top-0 z-20 bg-background/85 backdrop-blur-xl border-b border-white/5">
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

        <main className="max-w-2xl mx-auto px-5 pb-32 pt-6">
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground/70 mb-6">
            Last updated · {updated}
          </p>
          <article
            className="prose prose-invert prose-sm max-w-none
              prose-headings:text-foreground prose-headings:font-semibold prose-headings:tracking-tight
              prose-h2:text-[17px] prose-h2:mt-7 prose-h2:mb-2
              prose-p:text-[14px] prose-p:leading-relaxed prose-p:text-muted-foreground
              prose-li:text-[14px] prose-li:text-muted-foreground
              prose-strong:text-foreground"
          >
            {children}
          </article>
        </main>
      </div>
    </FadeTransition>
  );
}
