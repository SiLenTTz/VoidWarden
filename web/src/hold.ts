/**
 * Halte-Zone (EPIC-P13 T13.5, Umsetzungsspezifikation §6): reine Zustands-
 * maschine für „Halten = Freigeben". fire genau einmal, beim ersten Tick mit
 * nowMs − startedAtMs ≥ 800 ms ununterbrochenen Haltens desselben Zeigers;
 * up/leave/cancel brechen ohne Senden ab; nach dem Auslösen bleibt der Zustand
 * locked, bis der Aufrufer unlock() setzt (Sperre bis decide_result/Frame).
 * Ein zweiter Zeiger während holding wird ignoriert, release mit fremder
 * pointerId ebenfalls. Kein DOM, keine Uhr — Zeit wird übergeben; die
 * Tastatur-Alternative nutzt pointerId −1.
 */
export const HOLD_MS = 800;

export type HoldState =
  | { phase: "idle" }
  | { phase: "holding"; startedAtMs: number; pointerId: number }
  | { phase: "locked" };

/** down (Zeiger oder Taste): startet das Halten nur aus idle. */
export function holdDown(s: HoldState, nowMs: number, pointerId: number): HoldState {
  return s.phase === "idle" ? { phase: "holding", startedAtMs: nowMs, pointerId } : s;
}

/** up/leave/cancel/key/versteckt: nur der haltende Zeiger bricht ab (⇒ idle). */
export function holdRelease(s: HoldState, pointerId: number): HoldState {
  return s.phase === "holding" && s.pointerId === pointerId ? { phase: "idle" } : s;
}

/** Takt (z. B. requestAnimationFrame): feuert genau einmal bei erreichter Haltezeit. */
export function holdTick(s: HoldState, nowMs: number): { state: HoldState; fire: boolean } {
  if (s.phase !== "holding") return { state: s, fire: false };
  if (nowMs - s.startedAtMs >= HOLD_MS) return { state: { phase: "locked" }, fire: true };
  return { state: s, fire: false };
}

/** Füllbalken 0..1 — Anzeige und Auslösung laufen auf derselben Uhr (§4.4). */
export function holdProgress(s: HoldState, nowMs: number): number {
  if (s.phase === "idle") return 0;
  if (s.phase === "locked") return 1;
  return Math.min(1, Math.max(0, (nowMs - s.startedAtMs) / HOLD_MS));
}

/** locked ⇒ idle (neue Freigabe/Frame-Wechsel; nicht durch Loslassen). */
export function holdUnlock(s: HoldState): HoldState {
  return s.phase === "locked" ? { phase: "idle" } : s;
}
