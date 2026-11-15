/**
 * Sprechende Kacheln (EPIC-P13 T13.4, Umsetzungsspezifikation §4.3): reine
 * Abbildung von Session-Einträgen auf Zustandspunkt (Farbe/Form/Bewegung als
 * CSS-Klasse), Titelzeile mit Rückfall auf den Projektnamen, Aktivitätszeile
 * und die Sortierung „braucht dich zuerst". Kein DOM, keine Uhr außer
 * übergebenen Millisekunden. Die Formensprache (gefüllt / Hof / offener Ring /
 * Quadrat, Atmen nur bei „arbeitet") ist dieselbe wie in AncientVoid P43 —
 * lesbar auch ohne Farbe.
 */
import type { WebSessionItem } from "./types.ts";

/** „fertig" gilt nur für idle jünger als 45 min (Spezifikation O2). */
export const TILE_DONE_WINDOW_MS = 45 * 60 * 1000;

export type TileDot = "err" | "ask" | "call" | "work" | "done" | "calm";

const WORKING = new Set(["working", "starting", "stopping"]);

/** Zustandspunkt: erste zutreffende Zeile der Tabelle aus §4.3 gewinnt. */
export function tileDot(item: WebSessionItem, nowMs: number): TileDot {
  if (item.status === "error") return "err";
  if (item.needs === "question") return "ask";
  if (item.needs === "approval" || item.attention) return "call";
  if (WORKING.has(item.status)) return "work";
  if (item.status === "idle") {
    const updated = Date.parse(item.updatedAt);
    if (!Number.isNaN(updated) && nowMs - updated < TILE_DONE_WINDOW_MS) return "done";
  }
  return "calm";
}

/** Titel, wenn nicht leer; sonst der Projektname wie bisher. */
export function tileName(item: WebSessionItem): string {
  return item.title !== undefined && item.title !== "" ? item.title : item.name;
}

/** Zweite Kachelzeile: Aktivität · relative Zeit, ohne Aktivität nur die Zeit. */
export function tileSecondLine(item: WebSessionItem, agoText: string): string {
  return item.activity !== undefined && item.activity !== "" ? `${item.activity} · ${agoText}` : agoText;
}

/**
 * Reihenfolge der Kacheln: zuerst alles mit `needs` (älteste zuerst — am
 * längsten wartende zuoberst), dann `error` (älteste zuerst), dann der Rest
 * nach updatedAt absteigend. Eingabe bleibt unverändert.
 */
export function sortTiles(list: WebSessionItem[]): WebSessionItem[] {
  const updated = (s: WebSessionItem): number => {
    const t = Date.parse(s.updatedAt);
    return Number.isNaN(t) ? 0 : t;
  };
  const group = (s: WebSessionItem): number => (s.needs !== undefined ? 0 : s.status === "error" ? 1 : 2);
  return [...list].sort((a, b) => {
    const g = group(a) - group(b);
    if (g !== 0) return g;
    return group(a) === 2 ? updated(b) - updated(a) : updated(a) - updated(b);
  });
}
