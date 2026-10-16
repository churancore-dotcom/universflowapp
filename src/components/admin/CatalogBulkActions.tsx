import { useState } from 'react';
import { Eye, EyeOff, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';

export default function CatalogBulkActions({ count, busy, clear, apply }: { count: number; busy: boolean; clear: () => void; apply: (visible: boolean) => Promise<void> }) {
  const [intent, setIntent] = useState<boolean | null>(null);
  if (!count) return null;
  return <>
    <div className="flex flex-wrap items-center gap-2 py-3 border-y border-border mb-4">
      <span className="text-sm font-medium mr-auto">{count} selected</span>
      <Button variant="outline" disabled={busy} onClick={() => setIntent(false)}><EyeOff /> Hide selected</Button>
      <Button variant="outline" disabled={busy} onClick={() => setIntent(true)}><Eye /> Show selected</Button>
      <Button variant="ghost" size="icon" disabled={busy} onClick={clear} title="Clear selection" aria-label="Clear selection"><X /></Button>
    </div>
    <Dialog open={intent !== null} onOpenChange={open => { if (!open && !busy) setIntent(null); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>{intent ? 'Show' : 'Hide'} selected songs?</DialogTitle><DialogDescription>{count} selected songs. Audio files and listening counts will remain unchanged.</DialogDescription></DialogHeader>
        <div className="flex justify-end gap-2"><Button variant="outline" disabled={busy} onClick={() => setIntent(null)}>Cancel</Button><Button disabled={busy} onClick={async () => { if (intent === null) return; await apply(intent); setIntent(null); }}>{busy ? 'Saving…' : 'Confirm visibility change'}</Button></div>
      </DialogContent>
    </Dialog>
  </>;
}