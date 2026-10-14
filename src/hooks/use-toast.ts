// Compatibility shim: the old toast API now shows messages through the mounted sonner Toaster.
import { toast as sonner } from 'sonner';
import type { ReactNode } from 'react';

type ToastInput = { title?: ReactNode; description?: ReactNode; variant?: 'default' | 'destructive' | string; duration?: number; [k: string]: unknown };

function toast({ title, description, variant, duration }: ToastInput) {
  const opts = { description: description as ReactNode, duration };
  const id = variant === 'destructive' ? sonner.error(title as ReactNode, opts) : sonner(title as ReactNode, opts);
  return { id: String(id), dismiss: () => sonner.dismiss(id), update: (n: ToastInput) => toast(n) };
}

function useToast() {
  return { toast, toasts: [] as unknown[], dismiss: (id?: string | number) => sonner.dismiss(id) };
}

export { toast, useToast };
