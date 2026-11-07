// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { confirmAction, parseConfirmMessage, subscribeConfirm, type ConfirmRequest } from '@/lib/confirmDialog';

const open = () => {
  let req: ConfirmRequest | null = null;
  const off = subscribeConfirm((r) => { req = r; });
  return { get: () => req, off };
};

describe('confirmAction', () => {
  it('resolves true when the user confirms', async () => {
    const s = open();
    const p = confirmAction('Delete "Ploj"? This cannot be undone.');
    s.get()!.resolve(true);
    await expect(p).resolves.toBe(true);
    expect(s.get()).toBeNull();
    s.off();
  });

  it('resolves false when the user cancels', async () => {
    const s = open();
    const p = confirmAction('Delete "Ploj"? This cannot be undone.');
    s.get()!.resolve(false);
    await expect(p).resolves.toBe(false);
    s.off();
  });

  it('marks delete prompts destructive with a Delete button', () => {
    const s = open();
    void confirmAction('Delete "Ploj"? This cannot be undone.');
    expect(s.get()!.destructive).toBe(true);
    expect(s.get()!.confirmLabel).toBe('Delete');
    s.get()!.resolve(false);
    s.off();
  });

  it('splits the question from the explanation', () => {
    expect(parseConfirmMessage('Delete "Ploj"? This cannot be undone.')).toMatchObject({
      title: 'Delete "Ploj"?',
      body: 'This cannot be undone.',
    });
  });
});
