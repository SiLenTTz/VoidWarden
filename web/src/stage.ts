/**
 * Anzeigezustand der Bühne (EPIC-P13 T13.1, Umsetzungsspezifikation §3):
 * reine Abbildung von Verbindungs-/Hub-/Freigabe-/Fokus-Eingängen auf genau
 * eine Darstellung (Sprite, Zustandsfarbe, Aura, Zeile, Satz). Kein DOM, keine
 * Uhr außer übergebenen Millisekunden — die Auswahl folgt „Dringendes schlägt
 * Fokus" (ADR-0009 Punkt 2), sonst bleibt die Bühne wie seit P11 bei der
 * zuletzt aktiven Session.
 */
import type { NyxState, PendingApproval, SessionSummary, WebSessionItem } from "./types.ts";
import { statusToNyxState } from "./bubble.ts";

export type DisplayState =
  | "ws_offline" | "offline" | "approval" | "question" | "error"
  | "executing" | "success" | "listening" | "idle" | "asleep";

export interface StageInput {
  /** WS zum Companion getrennt. */
  wsOffline: boolean;
  /** 45-min-Verfall (idle.ts). */
  decayed: boolean;
  /** Gesamtzustand aus dem Frame. */
  frameState: NyxState;
  hub: "up" | "down";
  approval: PendingApproval | null;
  /** focusSession(sessionList), wie heute. */
  focus: WebSessionItem | null;
  sessions: SessionSummary;
  /** Vom Aufrufer gemerkt, sobald hub "down" wird. */
  hubDownSinceMs: number | null;
}

export interface StageView {
  display: DisplayState;
  /** Animation im Atlas. */
  sprite: NyxState;
  /** CSS-Variable der Zustandsfarbe, z. B. "--st-approval". */
  colorVar: string;
  aura: "breathe" | "still" | "off";
  /** Zustandszeile, GROSS. */
  line: string;
  /** Satz darunter. */
  sentence: string;
}

/** Auswahl des Anzeigezustands: erste zutreffende Zeile gewinnt. */
function displayOf(input: StageInput): DisplayState {
  if (input.wsOffline) return "ws_offline";
  if (input.hub === "down" || input.frameState === "offline") return "offline";
  if (input.approval !== null && input.approval.kind === "question") return "question";
  if (input.approval !== null) return "approval";
  if (input.frameState === "error") return "error";
  if (input.decayed) return "asleep";
  if (input.focus !== null) {
    const s = statusToNyxState(input.focus.status);
    // approval_pending hätte Zeile 3/4 gefangen — ohne projiziertes Approval
    // gibt es keine Freigabe-Anzeige (W10).
    return s === "approval_pending" ? "idle" : s;
  }
  switch (input.frameState) {
    case "executing":
      return "executing";
    case "success":
      return "success";
    case "listening":
      return "listening";
    default:
      return "idle";
  }
}

interface Row {
  sprite: NyxState;
  colorVar: string;
  aura: StageView["aura"];
  line: string;
  sentence: string;
}

const TABLE: Record<DisplayState, Row> = {
  ws_offline: { sprite: "offline", colorVar: "--st-offline", aura: "off", line: "GETRENNT", sentence: "Keine Verbindung zum Companion." },
  offline: { sprite: "offline", colorVar: "--st-offline", aura: "off", line: "SCHLÄFT", sentence: "Hub nicht erreichbar." },
  approval: { sprite: "approval_pending", colorVar: "--st-approval", aura: "still", line: "FREIGABE", sentence: "Dein Wort wird verlangt." },
  question: { sprite: "listening", colorVar: "--st-question", aura: "still", line: "FRAGE", sentence: "Eine Wahl steht aus." },
  error: { sprite: "error", colorVar: "--st-error", aura: "still", line: "FEHLER", sentence: "Etwas ist zerbrochen." },
  executing: { sprite: "executing", colorVar: "--st-executing", aura: "breathe", line: "ARBEITET", sentence: "Die Fäden ziehen sich." },
  success: { sprite: "success", colorVar: "--st-success", aura: "breathe", line: "ERLEDIGT", sentence: "So sei es." },
  listening: { sprite: "listening", colorVar: "--st-listening", aura: "breathe", line: "HORCHT", sentence: "Ich höre." },
  idle: { sprite: "idle", colorVar: "--st-idle", aura: "breathe", line: "RUHE", sentence: "Stille im Void." },
  asleep: { sprite: "idle", colorVar: "--st-idle", aura: "off", line: "RUHT", sentence: "Tippe für den letzten Status." },
};

/** Lokale Uhrzeit HH:MM (Anzeige „seit HH:MM"); reine Formatierung eines übergebenen Zeitpunkts. */
export function formatClockLocal(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Zähler-Suffix nur aus sessions des Frames (W10: kein Status ohne Hub-Beleg). */
function lineWithCounter(display: DisplayState, row: Row, sessions: SessionSummary): string {
  switch (display) {
    case "approval":
      return sessions.waiting > 1 ? `${row.line} · +${sessions.waiting - 1}` : row.line;
    case "question":
      return sessions.waiting > 1 ? `${row.line} · +${sessions.waiting - 1}` : row.line;
    case "error":
      return sessions.error > 1 ? `${row.line} · ${sessions.error}` : row.line;
    case "executing":
      return sessions.working > 1 ? `${row.line} · ${sessions.working}` : row.line;
    default:
      return row.line;
  }
}

export function stageView(input: StageInput): StageView {
  const display = displayOf(input);
  const row = TABLE[display];
  return {
    display,
    sprite: row.sprite,
    colorVar: row.colorVar,
    aura: row.aura,
    line: lineWithCounter(display, row, input.sessions),
    sentence:
      display === "offline" && input.hubDownSinceMs !== null
        ? `Hub nicht erreichbar seit ${formatClockLocal(input.hubDownSinceMs)}`
        : row.sentence,
  };
}

/**
 * Voice-Regel (§3): Ein voice-Frame ohne Fehler, dessen state dem aktuellen
 * sprite entspricht, ersetzt den Satz — sonst gilt die Tabelle. Der Satz ist
 * nie Agenten-Text aus freien Stücken, sondern die P11-Stimme (Textpool).
 */
export function applyVoiceSentence(current: StageView, voice: { state: string; phrase: string; error: boolean }): StageView {
  if (!voice.error && voice.state === current.sprite) return { ...current, sentence: voice.phrase };
  return current;
}
