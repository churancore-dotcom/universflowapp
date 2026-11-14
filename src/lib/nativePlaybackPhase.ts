export type NativePhase = 'playing' | 'starting' | 'paused' | 'buffering' | 'stopped' | 'ended' | 'unknown';

/** Only a real 'playing' event confirms that native audio has started. */
export function confirmsNativeStart(state: NativePhase): boolean {
  return state === 'playing';
}

/** States that reflect the user's play intent (button shows pause). */
export function showsPlayIntent(state: NativePhase): boolean {
  return state === 'playing' || state === 'starting' || state === 'buffering';
}
