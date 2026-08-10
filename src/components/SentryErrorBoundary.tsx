import { Sentry } from '@/lib/sentry';
import { AlertTriangle, RefreshCw } from 'lucide-react';

const Fallback = ({ resetError }: { resetError: () => void }) => (
  <div className="min-h-dvh bg-background flex flex-col items-center justify-center px-6 text-center">
    <div className="w-16 h-16 rounded-2xl bg-destructive/10 flex items-center justify-center mb-4">
      <AlertTriangle className="w-8 h-8 text-destructive" />
    </div>
    <h1 className="text-xl font-bold mb-2">Something went wrong</h1>
    <p className="text-sm text-muted-foreground max-w-xs mb-6">
      We've been notified and are working on a fix. Try reloading the app.
    </p>
    <button
      onClick={resetError}
      className="flex items-center gap-2 px-5 py-3 rounded-2xl bg-primary text-primary-foreground font-semibold"
    >
      <RefreshCw className="w-4 h-4" />
      Reload app
    </button>
  </div>
);

export const SentryErrorBoundary = ({ children }: { children: React.ReactNode }) => (
  <Sentry.ErrorBoundary
    fallback={({ resetError }) => <Fallback resetError={resetError} />}
    onReset={() => window.location.reload()}
  >
    {children}
  </Sentry.ErrorBoundary>
);
