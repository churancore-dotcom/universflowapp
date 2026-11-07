import { useState } from 'react';
import { Download, RefreshCw, CheckCircle2 } from 'lucide-react';
import { useAppUpdate } from '@/hooks/useAppUpdate';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { isMedianApp } from '@/lib/median';
import { toast } from 'sonner';

/**
 * Settings-only "Check for updates" row.
 * - On native: shows installed version, opens a dialog with release notes + download
 *   when a newer version is available.
 * - On web: hidden (nothing to update).
 */
export function SettingsUpdateButton() {
  const { needsUpdate, latest, installedName, loading } = useAppUpdate();
  const [open, setOpen] = useState(false);

  // Hide entirely on the web — only meaningful inside the installed APK
  if (!isMedianApp) return null;

  const handleClick = () => {
    if (loading) return;
    if (needsUpdate) {
      setOpen(true);
    } else {
      toast.success("You're on the latest version");
    }
  };

  const handleDownload = () => {
    if (!latest) return;
    window.open(latest.apk_url, '_blank', 'noopener,noreferrer');
  };

  return (
    <>
      <button
        onClick={handleClick}
        className="w-full px-4 py-3 flex items-center justify-between active:bg-white/5 border-b border-white/5"
      >
        <div className="flex items-center gap-2.5">
          {needsUpdate ? (
            <Download className="w-4 h-4 text-[#FF2D55]" />
          ) : (
            <RefreshCw className="w-4 h-4 text-muted-foreground" />
          )}
          <span className="text-sm font-medium">
            {needsUpdate ? 'Update available' : 'Check for updates'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {needsUpdate && latest ? (
            <span className="text-[11px] font-semibold text-[#FF6B9D]">
              v{latest.version_name}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" />
              v{installedName ?? '1.0.0'}
            </span>
          )}
        </div>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm rounded-3xl border-border bg-background">
          <DialogHeader>
            <div className="mx-auto mb-2 size-14 rounded-2xl bg-gradient-to-br from-[#FF2D55] to-[#FF6B9D] grid place-items-center shadow-lg shadow-[#FF2D55]/40">
              <Download className="size-7 text-white" />
            </div>
            <DialogTitle className="text-center text-white text-lg">
              Update available
            </DialogTitle>
          </DialogHeader>

          {latest && (
            <div className="space-y-3 px-1">
              <div className="flex items-center justify-center gap-2 text-sm text-white/70">
                <span className="px-2 py-0.5 rounded-full bg-white/5">v{installedName ?? '?'}</span>
                <span>→</span>
                <span className="px-2 py-0.5 rounded-full bg-[#FF2D55]/20 text-[#FF6B9D] font-semibold">
                  v{latest.version_name}
                </span>
              </div>

              {latest.release_notes && (
                <div className="rounded-xl bg-white/5 p-3 max-h-40 overflow-auto">
                  <p className="text-xs text-white/80 whitespace-pre-wrap leading-relaxed">
                    {latest.release_notes}
                  </p>
                </div>
              )}

              <Button
                onClick={handleDownload}
                className="w-full h-11 rounded-xl bg-gradient-to-r from-[#FF2D55] to-[#FF6B9D] hover:opacity-90 text-white font-semibold"
              >
                <Download className="size-4 mr-2" />
                Download update
              </Button>

              <p className="text-[10px] text-center text-white/40 pt-1">
                Android will install over your current app. Your data stays safe.
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
