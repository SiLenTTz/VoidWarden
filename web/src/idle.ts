/**
 * Idle-Logik (EPIC-P10 T10.5, ADR-0011 §5): reine Funktionen mit injizierter
 * Uhr — kein Date.now()/setTimeout im Modul. Getestet in test/idle.test.ts.
 *
 * Regeln aus dem Epic:
 * - Ticker alle 5–15 min (zufällig, pro Tag deterministisch geseedet —
 *   Displays ticken nicht synchron).
 * - Nur Sessions mit Aktivität (updatedAt) seit dem letzten Tick — kein
 *   Recycling alter Nachrichten.
 * - Nach 45 min ohne Event (global: jüngste Aktivität irgendeiner Session)
 *   nur noch Idle-Nyx; Tap zeigt letzten Status read-only und reaktiviert
 *   den Ticker NICHT; neue Events heben den Verfall auf.
 */

export const TICK_MIN_S = 5 * 60;
export const TICK_MAX_S = 15 * 60;
export const DECAY_S = 45 * 60;

/** Deterministischer Tages-Seed (UTC-Jahrestag) → Ticker-Offsets pro Tag stabil. */
export function daySeed(nowMs: number): number {
  const day = Math.floor(nowMs / 86_400_000);
  return day % 100_000;
}

/** Pseudozufall 0..1 aus Seed + Schritt (mulberry32-Kern, deterministisch). */
export function seededRandom(seed: number, step: number): number {
  let t = (seed * 2654435761 + step * 40503) >>> 0;
  t = (t ^ (t >>> 15)) >>> 0;
  t = Math.imul(t, 2246822519) >>> 0;
  t = (t ^ (t >>> 13)) >>> 0;
  t = Math.imul(t, 3266489917) >>> 0;
  t = (t ^ (t >>> 16)) >>> 0;
  return t / 4294967296;
}

/** Nächstes Ticker-Intervall in ms: 5–15 min, tag-geseedet + Schritt. */
export function nextTickDelayMs(nowMs: number, tickIndex: number): number {
  const r = seededRandom(daySeed(nowMs), tickIndex);
  const s = TICK_MIN_S + r * (TICK_MAX_S - TICK_MIN_S);
  return Math.round(s * 1000);
}

export interface IdleInput {
  nowMs: number;
  /** Jüngstes Aktivitäts-Event (max updatedAt aller Sessions) in ms; null = nichts bekannt. */
  lastActivityMs: number | null;
  lastTickMs: number | null;
  /**Geplanter nächster Tick in ms (aus nextTickDelayMs berechnet); null = keiner geplant. */
  nextTickAtMs: number | null;
}

export type IdlePhase = "fresh" | "decayed";

/** Verfallen? 45 min ohne Event — Ticker stoppt, nur Idle-Nyx. */
export function isDecayed(input: IdleInput): boolean {
  if (input.lastActivityMs === null) return false; // nichts bekannt: kein Verfall erzwingen
  return input.nowMs - input.lastActivityMs >= DECAY_S * 1000;
}

/** Tick fällig? Nur im nicht verfallenen Zustand und nur wenn geplant. */
export function tickDue(input: IdleInput): boolean {
  if (isDecayed(input)) return false;
  if (input.nextTickAtMs === null) return false;
  return input.nowMs >= input.nextTickAtMs;
}

export interface TickerCandidate {
  id: string;
  name: string;
  updatedAt: string;
  lastAssistantMessage: string | null;
}

export interface TickerPick {
  session: TickerCandidate;
  /** Zeitstempel der Nachricht für die Anzeige. */
  shownAtMs: number;
}

/**
 * Wählt die Session für den nächsten Tick: nur Sessions mit Aktivität seit
 * dem letzten Tick (kein Recycling), bevorzugt die zuletzt aktive mit einer
 * Nachricht. Null, wenn keine qualifiziert ist — dann kein Tick-Inhalt.
 */
export function pickTickerSession(
  sessions: TickerCandidate[],
  lastTickMs: number | null,
): TickerPick | null {
  const sinceMs = lastTickMs ?? 0;
  const qualified = sessions
    .filter((s) => Date.parse(s.updatedAt) > sinceMs)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  const withMessage = qualified.find((s) => s.lastAssistantMessage !== null && s.lastAssistantMessage !== "");
  const chosen = withMessage ?? qualified[0];
  if (chosen === undefined) return null;
  return { session: chosen, shownAtMs: Date.parse(chosen.updatedAt) };
}

/** Zustandsübergang nach einem Tap auf Nyx im Verfall: read-only, kein Ticker-Revive. */
export function tapOnDecayedNyx(input: IdleInput): { phase: IdlePhase; showStatus: boolean; reviveTicker: boolean } {
  return {
    phase: isDecayed(input) ? "decayed" : "fresh",
    showStatus: true,
    reviveTicker: false,
  };
}
