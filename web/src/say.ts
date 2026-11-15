/** BUG-0011: Say-Gate — genau ein /say-Lauf zugleich. */
export interface SayGate {
  inFlight: boolean;
}

/** Tap erlaubt? Setzt inFlight; false, wenn bereits ein Vorlesen läuft. */
export function sayTap(g: SayGate): boolean {
  if (g.inFlight) return false;
  g.inFlight = true;
  return true;
}

/** Vorlesen beendet (Erfolg oder Fehler) — Gate freigeben. */
export function sayDone(g: SayGate): void {
  g.inFlight = false;
}
