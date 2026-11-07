/**
 * App-styled replacement for window.confirm(). Call `confirmAction(message)`
 * and await the boolean; <ConfirmDialogHost /> (mounted once in the root)
 * renders the request as a branded bottom sheet instead of the system popup.
 */
export interface ConfirmOptions {
  title?: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

export interface ConfirmRequest extends Required<Omit<ConfirmOptions, 'body'>> {
  id: number;
  body?: string;
  resolve: (ok: boolean) => void;
}

type Listener = (req: ConfirmRequest | null) => void;

let current: ConfirmRequest | null = null;
let nextId = 1;
const listeners = new Set<Listener>();

const emit = () => listeners.forEach((l) => l(current));

export function subscribeConfirm(listener: Listener) {
  listeners.add(listener);
  listener(current);
  return () => { listeners.delete(listener); };
}

const DESTRUCTIVE = /^(delete|remove|permanently|revoke|clear|sign .* out|ban|suspend|disable)/i;

/** Split "Delete "X"? This cannot be undone." into a title and a body line. */
export function parseConfirmMessage(message: string): { title: string; body?: string; verb?: string } {
  const text = message.trim();
  const breakAt = text.search(/[?!.](\s|\n|$)/);
  const title = breakAt >= 0 ? text.slice(0, breakAt + 1).trim() : text;
  const body = breakAt >= 0 ? text.slice(breakAt + 1).trim() || undefined : undefined;
  const first = title.split(/\s+/)[0]?.replace(/[^a-z]/gi, '') || '';
  const verb = /^(delete|remove|revoke|clear|ban|suspend|disable|set)$/i.test(first)
    ? first.charAt(0).toUpperCase() + first.slice(1).toLowerCase()
    : undefined;
  return { title, body, verb };
}

export function confirmAction(message: string, options: ConfirmOptions = {}): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false);
  const parsed = parseConfirmMessage(message);
  // A newer request replaces an open one; the old one counts as cancelled.
  current?.resolve(false);
  return new Promise<boolean>((resolve) => {
    const id = nextId++;
    current = {
      id,
      title: options.title ?? parsed.title,
      body: options.body ?? parsed.body,
      confirmLabel: options.confirmLabel ?? (parsed.verb === 'Permanently' ? 'Delete' : parsed.verb ?? 'Confirm'),
      cancelLabel: options.cancelLabel ?? 'Cancel',
      destructive: options.destructive ?? DESTRUCTIVE.test(message.trim()),
      resolve: (ok) => {
        if (current?.id === id) { current = null; emit(); }
        resolve(ok);
      },
    };
    emit();
  });
}
