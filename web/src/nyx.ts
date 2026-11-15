/**
 * Nyx-Sprite (EPIC-P10 T10.8): Frame-Auswahl aus dem Nyx-Atlas
 * (assets/nyx/nyx-atlas.{png,json} → web/public/nyx/) als reine Funktionen —
 * Animation ist ohne DOM testbar. Der Web-Client zeigt damit echtes Nyx-
 * Artwork statt des Platzhalter-Smileys, State-abhängig (snapshot.state);
 * im Verfall schläft Nyx (idle), bei WS-Abbruch läuft die offline-Animation.
 */
import type { NyxState } from "./types.ts";

export interface NyxAtlasStateSpec {
  state: NyxState;
  frames: number;
  duration_ms: number;
}

export interface NyxAtlasFrameEntry {
  state: NyxState;
  index: number;
  frame: number;
}

export interface NyxAtlasMeta {
  fw: number;
  fh: number;
  states: NyxAtlasStateSpec[];
  frames: NyxAtlasFrameEntry[];
}

/** Angezeigter Animations-State: WS-down → offline, Verfall → schlafendes Nyx. */
export function spriteState(wsState: NyxState, decayed: boolean, wsOffline: boolean): NyxState {
  if (wsOffline) return "offline";
  if (decayed) return "idle";
  return wsState;
}

/**
 * Absolute Frame-Spalte im Atlas nach verstrichener Zeit (zyklisch).
 * -1 bei unbekanntem State/kaputtem Atlas — Aufrufer muss fail loud reagieren.
 */
export function frameColumnAt(meta: NyxAtlasMeta, state: NyxState, elapsedMs: number): number {
  const spec = meta.states.find((s) => s.state === state);
  if (spec === undefined || spec.frames <= 0 || spec.duration_ms <= 0) return -1;
  const idx = Math.floor(Math.max(0, elapsedMs) / spec.duration_ms) % spec.frames;
  const entry = meta.frames.find((f) => f.state === state && f.index === idx);
  return entry === undefined ? -1 : entry.frame;
}

/** Atlas-Sanity: alle NyxStates abgedeckt, Dauern positiv, Frame-Tabelle vollständig. */
export function validateAtlas(meta: NyxAtlasMeta): string[] {
  const problems: string[] = [];
  if (!Number.isFinite(meta.fw) || meta.fw <= 0 || !Number.isFinite(meta.fh) || meta.fh <= 0) {
    problems.push("fw/fh nicht positiv");
  }
  const known: NyxState[] = ["idle", "listening", "approval_pending", "executing", "success", "error", "offline"];
  for (const k of known) {
    if (!meta.states.some((s) => s.state === k)) problems.push(`state ${k} fehlt im Atlas`);
  }
  for (const s of meta.states) {
    if (s.frames <= 0) problems.push(`state ${s.state}: frames <= 0`);
    if (s.duration_ms <= 0) problems.push(`state ${s.state}: duration_ms <= 0`);
    for (let i = 0; i < s.frames; i++) {
      if (!meta.frames.some((f) => f.state === s.state && f.index === i)) {
        problems.push(`state ${s.state}: index ${i} fehlt in Frame-Tabelle`);
      }
    }
  }
  return problems;
}
