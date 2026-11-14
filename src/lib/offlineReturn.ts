// Remembers the page the app auto-redirected away from when connectivity
// dropped, so reconnecting can return there. Manual visits to the offline
// player never set it.
let pending: string | null = null;
export function rememberOfflineReturn(path: string) {
  if (path && !path.startsWith('/offline-player') && !path.startsWith('/auth')) pending = path;
}
export function takeOfflineReturn(): string | null {
  const p = pending; pending = null; return p;
}
export function forgetOfflineReturn() { pending = null; }
