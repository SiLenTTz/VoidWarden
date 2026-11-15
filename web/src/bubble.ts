/**
 * Sprechblasen-Queue + Fokus-Session (EPIC-P11 T11.2/T11.3, ADR-0008-Vorbild):
 * reine Funktionen mit injizierter Zeit — max 1 Blase sichtbar, Rest queued,
 * auto-hide nach konfigurierbarer Zeit. Nyx-Bindung: focusSession wählt die
 * zuletzt aktive Session (max updatedAt), statusToNyxState mappt ihren Status
 * auf die Sprite-States des Atlas; die Bühne spiegelt damit immer die
 * jüngste Aktivität, nicht den globalen Aggregat-Zustand.
 */
import type { NyxState, WebSessionItem } from "./types.ts";

export const BUBBLE_HIDE_MS = 8000;
export const BUBBLE_QUEUE_MAX = 4;

export type BubbleKind = "status" | "ticker" | "voice" | "hint";

export interface BubbleItem {
  kind: BubbleKind;
  title: string;
  body: string;
  atMs: number;
}

export interface BubbleState {
  visible: BubbleItem | null;
  hiddenAtMs: number | null;
  queue: BubbleItem[];
  /** dropped: überzählige Blasen (Queue voll) — sichtbar im UI-Zustand, nie still. */
  dropped: number;
}

export function initialBubbleState(): BubbleState {
  return { visible: null, hiddenAtMs: null, queue: [], dropped: 0 };
}

/** Blase einreihen: sofort sichtbar wenn frei, sonst Queue (begrenzt). */
export function pushBubble(state: BubbleState, item: BubbleItem): BubbleState {
  if (state.visible === null) {
    return { ...state, visible: item, hiddenAtMs: item.atMs + BUBBLE_HIDE_MS };
  }
  if (state.queue.length >= BUBBLE_QUEUE_MAX) {
    return { ...state, dropped: state.dropped + 1 };
  }
  return { ...state, queue: [...state.queue, item] };
}

/** Zeit-Tick: sichtbare Blase ausblenden wenn fällig, nächste nachziehen. */
export function tickBubble(state: BubbleState, nowMs: number): BubbleState {
  if (state.visible !== null && state.hiddenAtMs !== null && nowMs >= state.hiddenAtMs) {
    const [next, ...rest] = state.queue;
    if (next === undefined) {
      return { ...state, visible: null, hiddenAtMs: null, queue: [] };
    }
    return { ...state, visible: next, hiddenAtMs: next.atMs + BUBBLE_HIDE_MS, queue: rest };
  }
  return state;
}

/** Tap auf eine sichtbare Blase: sofort ausblenden (Queue rückt nach). */
export function dismissBubble(state: BubbleState): BubbleState {
  const [next, ...rest] = state.queue;
  if (next === undefined) return { ...state, visible: null, hiddenAtMs: null, queue: [] };
  return { ...state, visible: next, hiddenAtMs: next.atMs + BUBBLE_HIDE_MS, queue: rest };
}

/** Zuletzt aktive Session (T11.2): neuestes updatedAt gewinnt, Stabilität bei Gleichstand. */
export function focusSession(sessions: WebSessionItem[]): WebSessionItem | null {
  let best: WebSessionItem | null = null;
  let bestTs = Number.NEGATIVE_INFINITY;
  for (const s of sessions) {
    const ts = Date.parse(s.updatedAt);
    if (Number.isNaN(ts)) continue;
    if (ts > bestTs) {
      bestTs = ts;
      best = s;
    }
  }
  return best;
}

/** Session-Status (Hub-Sprache) → Sprite-State (Atlas). Unbekannt → idle. */
export function statusToNyxState(status: string): NyxState {
  switch (status) {
    case "working":
    case "executing":
      return "executing";
    case "waiting":
    case "approval_pending":
      return "approval_pending";
    case "error":
      return "error";
    case "success":
      return "success";
    case "listening":
      return "listening";
    default:
      return "idle";
  }
}

/** Deutsche Status-Labels für Blase/Bühne (UI-Sprache Deutsch, AGENTS.md). */
export const STATUS_LABEL: Record<string, string> = {
  idle: "wartet im Zwielicht",
  listening: "horcht",
  working: "arbeitet",
  executing: "vollbringt",
  waiting: "wartet auf ein Wort",
  approval_pending: "verlangt dein Urteil",
  success: "ist zufrieden",
  error: "stolpert",
  offline: "schweigt",
};

/** Status-Blase für die Fokus-Session (Tap auf Nyx, T11.2). */
export function statusBubbleFor(s: WebSessionItem, nowMs: number): BubbleItem {
  const label = STATUS_LABEL[s.status] ?? s.status;
  const dt = Math.max(0, Math.floor((nowMs - Date.parse(s.updatedAt)) / 1000));
  const dtText = dt < 60 ? `${dt} s` : dt < 3600 ? `${Math.floor(dt / 60)} min` : `${Math.floor(dt / 3600)} h`;
  return {
    kind: "status",
    title: `${s.name} · ${label}`,
    body: s.lastAssistantMessage !== null && s.lastAssistantMessage !== "" ? s.lastAssistantMessage : `seit ${dtText}`,
    atMs: nowMs,
  };
}
