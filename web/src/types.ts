/**
 * Gemeinsame Typen des Web-Clients (EPIC-P10, ADR-0011). Spiegeln die
 * Companion-WS-Frames (protocol/schema/ws/) — bewusst ohne Import aus
 * protocol/ (kein Build-Schritt-Shared-Folder); das Fixture in
 * protocol/fixtures/ws/ hält beide Seiten ehr (check:protocol).
 */

export type NyxState =
  | "idle"
  | "listening"
  | "approval_pending"
  | "executing"
  | "success"
  | "error"
  | "offline";

export interface SessionSummary {
  total: number;
  working: number;
  waiting: number;
  error: number;
}

export interface WebSessionItem {
  id: string;
  name: string;
  status: string;
  updatedAt: string;
  lastActivityAt: string | null;
  lastAssistantMessage: string | null;
  attention: boolean;
  /** T13.3/ADR-0012 Punkt 9: Session-Titel (≤ 40), bereinigt; leer/fehlend erlaubt. */
  title?: string;
  /** T13.3: Aktivitätszeile aus lastActivity (Vorlage, ≤ 40, nur Anzeige). */
  activity?: string;
  /** T13.3: "approval" | "question", wenn eine wartende Freigabe diese Session betrifft. */
  needs?: "approval" | "question";
}

export interface PendingApproval {
  action_id: string;
  kind: "approval" | "question";
  agent_id: string;
  class: "read" | "write" | "destructive";
  payload: { title: string; body: string };
  timeout_s: number;
  decidable: boolean;
}

export interface WebSnapshotFrame {
  type: "snapshot";
  seq: number;
  ts: string;
  state: NyxState;
  sessions: SessionSummary;
  sessionList: WebSessionItem[];
  approval: PendingApproval | null;
  hub: "up" | "down";
  /** T13.5/P10-Retro: nur gesetzt, wenn die Config-Schlüssel stehen (additiv). */
  ui?: { approveGesture?: "tap" | "hold"; idleTicker?: boolean };
}

export interface WebStateChangeFrame {
  type: "state_change";
  seq: number;
  ts: string;
  state: NyxState;
  sessions?: SessionSummary;
  sessionList?: WebSessionItem[];
  approval?: PendingApproval | null;
  hub?: "up" | "down";
}

export interface WebHeartbeatFrame {
  type: "heartbeat";
  ts: string;
}

export interface WebDecideResultFrame {
  type: "decide_result";
  ts: string;
  action_id: string;
  outcome: "decided" | "conflict" | "rejected_by_policy" | "not_decidable" | "already_decided" | "error";
  hub_status: string | null;
}

/**
 * Nyx-Stimme (EPIC-P11 T11.5): Cue-Ankündigung; WAV liegt unter /voice/<id>
 * (gleicher Origin). error=true = Synthese fehlgeschlagen — sichtbarer Fehler.
 */
export interface WebVoiceFrame {
  type: "voice";
  ts: string;
  id: string;
  state: string;
  phrase: string;
  error: boolean;
}

/** Voice → Session-Entwurf im Hub-Composer (nie Steer). */
export interface WebDraftResultFrame {
  type: "draft_result";
  ts: string;
  session_id: string;
  outcome: "saved" | "conflict" | "not_available" | "error";
  revision: number | null;
}

export type WebServerFrame =
  | WebSnapshotFrame
  | WebStateChangeFrame
  | WebHeartbeatFrame
  | WebDecideResultFrame
  | WebVoiceFrame
  | WebDraftResultFrame;
