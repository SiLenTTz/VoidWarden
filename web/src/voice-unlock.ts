/**
 * Autoplay-Freigabe für die Nyx-Stimme (BUG-0017).
 * Browser erlauben Audio erst nach einer Nutzer-Geste; ohne sichtbares Relock
 * nach NotAllowedError bleibt der Kiosk dauerhaft stumm.
 */

export interface VoiceUnlockState {
  unlocked: boolean;
}

export function createVoiceUnlock(): VoiceUnlockState {
  return { unlocked: false };
}

/** Erste Geste gibt frei; weitere sind no-op. true = gerade freigegeben. */
export function unlockFromGesture(state: VoiceUnlockState): boolean {
  if (state.unlocked) return false;
  state.unlocked = true;
  return true;
}

/** play() mit NotAllowedError → wieder sperren, damit der nächste Tap greift. */
export function relockAfterBlocked(state: VoiceUnlockState): void {
  state.unlocked = false;
}

export function isAudioLocked(state: VoiceUnlockState): boolean {
  return !state.unlocked;
}
