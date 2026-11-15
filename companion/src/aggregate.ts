/**
 * Aggregation (EPIC-P1 T1.2): aus Hub-Sessions und -Approvals wird genau ein
 * Display-Zustand — pure, ohne IO, tabellengetestet (docs/testing.md §3).
 * Priorität (spec.md §5.1): offline > approval_pending > error > executing >
 * success (transient) > listening > idle. `executing`/`success` sind
 * geräte-/ereignisgetrieben (P3) und entstehen nicht aus Hub-Polls.
 */
import { QUESTION_TOOLS, SESSION_STATUSES } from "@ancientvoid/contracts";

export type NyxState =
  | "idle"
  | "listening"
  | "approval_pending"
  | "executing"
  | "success"
  | "error"
  | "offline";

export const NYX_PRIORITY: readonly NyxState[] = [
  "offline",
  "approval_pending",
  "error",
  "executing",
  "success",
  "listening",
  "idle",
];

/** Relevanter Ausschnitt eines Hub-Sessions (SessionStatus aus contracts). */
export interface SessionInput {
  /** Hub-Session-ID (für den Fokus-Alias; fehlt in alten Fake-Hubs). */
  id?: string;
  status: string; // bewusst string: Unbekannte müssen fail-loud durchgehen
  archived?: boolean;
  /** Adapter-Kennung (z. B. "claude"), Teil des Anzeige-Alias (ADR-0008 §6). */
  adapter?: string;
  /** Hub-Titel: nur bei `titleSource === "manual"` anzeigbar, sonst Prompt-Auszug (ADR-0008 §6). */
  title?: string | null;
  titleSource?: string;
  /** Projektpfad der Session (Hub-Feld `project`); angezeigt wird nur der Verzeichnisname (ADR-0010). */
  project?: string;
  /** Hub-Sequenz des letzten Events; steuert, wann die letzte Nachricht neu geholt wird. */
  lastSeq?: number;
  /** EPIC-P10 T10.3: ISO-8601 UTC des letzten Events (SessionRecord.updatedAt) — Idle-Ticker/Verfall. */
  updatedAt?: string;
  /** EPIC-P10 T10.3: ISO-8601 UTC aus lastActivity.at, wenn der Hub es liefert. */
  lastActivityAt?: string | null;
  /** EPIC-P13 T13.3: lastActivity.text des Hubs — Kachel-Aktivität (nur Anzeige, ADR-0012 Punkt 9). */
  lastActivityText?: string;
  /** EPIC-P13 T13.3: lastActivity.type des Hubs — wählt die Vorlage der Aktivitätszeile. */
  lastActivityType?: string;
}

/** Relevanter Ausschnitt eines Hub-Approvals (ApprovalRequest aus contracts). */
export interface ApprovalInput {
  id: string;
  sessionId: string;
  status: string; // ApprovalStatus aus contracts ("pending" | ...)
  class: "read" | "write" | "destructive"; // vom HubClient enum-validiert
  summary: string;
  action: string;
  tool: string | null;
  reasonRequired: boolean;
  /** ISO-8601 UTC (T1.1 belegt: mit Millisekunden). */
  timeoutAt: string;
}

export interface SessionSummary {
  total: number;
  working: number;
  waiting: number;
  error: number;
}

export interface PendingApproval {
  action_id: string;
  /** Frage des Agents (AskUserQuestion): nur Anzeige, am Display nie entscheidbar (ADR-0001). */
  kind: "approval" | "question";
  agent_id: string;
  class: "read" | "write" | "destructive";
  payload: { title: string; body: string };
  /** Restzeit in Sekunden bis timeoutAt (spec.md §4.1). */
  timeout_s: number;
  /** ADR-0001: nur `write` ohne reasonRequired ist am Gerät entscheidbar. */
  decidable: boolean;
}

export interface AggregateInput {
  sessions: SessionInput[];
  approvals: ApprovalInput[];
  /** ISO-8601; injizierbar für Tests (docs/testing.md §2.2). */
  now: string;
  hubUp: boolean;
}

export interface AggregateResult {
  state: NyxState;
  sessions: SessionSummary;
  /** Älteste offene Freigabe (kürzeste Restzeit), null wenn keine offen. */
  approval: PendingApproval | null;
  /** Anzahl offener Freigaben („+N" im Ticker, spec.md §5.1). */
  pendingCount: number;
  /** Nicht abbildbare Session-Status: Protokollfehler, nie still (K9/Fail loud). */
  unknownStatuses: string[];
}

const SESSION_STATUS_SET = new Set<string>(SESSION_STATUSES);

function isoToEpochMs(iso: string): number {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) {
    throw new Error(`invalid ISO-8601 timestamp: ${iso}`);
  }
  return ms;
}

function pickApproval(a: ApprovalInput, nowMs: number): PendingApproval {
  const timeout_s = Math.max(0, (isoToEpochMs(a.timeoutAt) - nowMs) / 1000);
  // Titel/Body sind Rohwerte; Kürzen und Steuerzeichen-Entfernung macht die
  // Bridge (T1.4, sanitize) — hier bleibt der Originaltext sichtbar.
  const body = [a.action, a.tool ?? null].filter(Boolean).join(" · ");
  const isQuestion = a.tool !== null && (QUESTION_TOOLS as readonly string[]).includes(a.tool);
  return {
    action_id: a.id,
    kind: isQuestion ? "question" : "approval",
    agent_id: a.sessionId,
    class: a.class,
    payload: { title: a.summary, body },
    timeout_s,
    decidable: a.class === "write" && !a.reasonRequired && !isQuestion,
  };
}

export function aggregate(input: AggregateInput): AggregateResult {
  const nowMs = isoToEpochMs(input.now);

  const active = input.sessions.filter((s) => s.archived !== true);
  const summary: SessionSummary = { total: active.length, working: 0, waiting: 0, error: 0 };
  const unknownStatuses: string[] = [];
  let anyError = false;
  let anyWorking = false;

  for (const s of active) {
    if (!SESSION_STATUS_SET.has(s.status)) {
      unknownStatuses.push(s.status);
      anyError = true; // unbekannter Status ist ein Protokollfehler, nie idle
      continue;
    }
    switch (s.status) {
      case "starting":
      case "working":
      case "stopping":
        summary.working += 1;
        anyWorking = true;
        break;
      case "waiting_approval":
        summary.waiting += 1;
        break;
      case "error":
        summary.error += 1;
        anyError = true;
        break;
      // idle, parked, stopped: zählen nur in total (spec.md §5.1)
      default:
        break;
    }
  }

  const pending = input.approvals
    .filter((a) => a.status === "pending" && isoToEpochMs(a.timeoutAt) > nowMs)
    .sort((a, b) => isoToEpochMs(a.timeoutAt) - isoToEpochMs(b.timeoutAt));
  const oldest =
    pending[0] !== undefined ? pickApproval(pending[0] as ApprovalInput, nowMs) : null;

  let state: NyxState;
  if (!input.hubUp) {
    state = "offline";
  } else if (oldest !== null || summary.waiting > 0) {
    // offene Freigabe schlägt alles außer offline — auch error (spec.md §5.1).
    state = "approval_pending";
  } else if (anyError) {
    state = "error";
  } else if (anyWorking) {
    state = "listening";
  } else {
    state = "idle";
  }

  return { state, sessions: summary, approval: oldest, pendingCount: pending.length, unknownStatuses };
}
