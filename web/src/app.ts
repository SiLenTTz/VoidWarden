/**
 * WS-Client + App-Logik (EPIC-P10 T10.4/T10.5): verbindet sich zum Companion
 * (gleicher Host, Port 8791; im LAN über die Companion-URL). Reconnect mit
 * Backoff (W5/W6: sichtbares Offline, Nachziehen ohne Duplikate über seq).
 * Idle-Ticker/Verfall über die reinen Funktionen aus idle.ts; die Uhr ist
 * injizierbar (Tests), Produktion nutzt Date.now.
 */
import type { WebServerFrame, WebSnapshotFrame, WebSessionItem } from "./types.ts";
import { isDecayed, tickDue, nextTickDelayMs, pickTickerSession, tapOnDecayedNyx } from "./idle.ts";

export interface AppDeps {
  now(): number;
  connectWs(): WebSocket;
  setTimeoutFn: (fn: () => void, ms?: number) => unknown;
  clearTimeoutFn: (handle: unknown) => void;
  notify?(title: string, body: string): void;
}

export interface AppCallbacks {
  onFrame(frame: WebServerFrame): void;
  onOfflineChange(offline: boolean): void;
  onTicker(sessionName: string, text: string, shownAtMs: number): void;
  onDecayChange(decayed: boolean): void;
  onAttention(approvalTitle: string): void;
}

const RECONNECT_MIN_MS = 1000;
const RECONNECT_MAX_MS = 30_000;

export class App {
  private ws: WebSocket | null = null;
  private reconnectHandle: unknown = null;
  private reconnectAttempt = 0;
  private tickHandle: unknown = null;
  private tickIndex = 0;
  private lastTickMs: number | null = null;
  private nextTickAtMs: number | null = null;
  private lastActivityMs: number | null = null;
  private decayed = false;
  /** P10-Retro: web.idleTickerEnabled=false kommt additiv im snapshot.ui an. */
  private tickerEnabled = true;
  private latestSessionList: WebSessionItem[] = [];
  private lastSeq = -1;
  private lastApproval: WebSnapshotFrame["approval"] = null;
  private lastSessions: WebSnapshotFrame["sessions"] = { total: 0, working: 0, waiting: 0, error: 0 };
  private readonly deps: AppDeps;
  private readonly cb: AppCallbacks;

  constructor(deps: AppDeps, cb: AppCallbacks) {
    this.deps = deps;
    this.cb = cb;
  }

  start(): void {
    this.connect();
    this.scheduleTick();
  }

  stop(): void {
    if (this.reconnectHandle !== null) this.deps.clearTimeoutFn(this.reconnectHandle);
    if (this.tickHandle !== null) this.deps.clearTimeoutFn(this.tickHandle);
    this.ws?.close();
  }

  private connect(): void {
    const ws = this.deps.connectWs();
    this.ws = ws;
    ws.onopen = () => {
      this.reconnectAttempt = 0;
      this.cb.onOfflineChange(false);
    };
    ws.onmessage = (ev: MessageEvent) => {
      try {
        const frame = JSON.parse(String(ev.data)) as WebServerFrame;
        this.handleFrame(frame);
      } catch {
        // unbekanntes Format: ignorieren wäre still — Konsolen-Fehler (fail loud light)
        console.error("ws: unlesbare Nachricht");
      }
    };
    ws.onclose = () => this.scheduleReconnect();
    ws.onerror = () => this.cb.onOfflineChange(true);
  }

  private scheduleReconnect(): void {
    this.cb.onOfflineChange(true);
    if (this.reconnectHandle !== null) return;
    const backoff = Math.min(RECONNECT_MAX_MS, RECONNECT_MIN_MS * 2 ** this.reconnectAttempt);
    this.reconnectAttempt += 1;
    this.reconnectHandle = this.deps.setTimeoutFn(() => {
      this.reconnectHandle = null;
      this.connect();
    }, backoff);
  }

  private handleFrame(frame: WebServerFrame): void {
    if (frame.type === "snapshot") {
      // W6: nach Reconnect kommt der volle snapshot — seq-Check verhindert Duplikat-Verarbeitung
      if (frame.seq < this.lastSeq) return;
      this.lastSeq = frame.seq;
      this.cb.onFrame(frame);
      this.applyState(frame);
    } else if (frame.type === "state_change") {
      if (frame.seq < this.lastSeq) return;
      this.lastSeq = frame.seq;
      this.cb.onFrame(frame);
      this.applyState({
        type: "snapshot",
        seq: frame.seq,
        ts: frame.ts,
        state: frame.state,
        sessions: frame.sessions ?? this.lastSessions,
        sessionList: frame.sessionList ?? this.latestSessionList,
        approval: frame.approval ?? this.lastApproval,
        hub: frame.hub ?? "up",
      });
    } else if (frame.type === "heartbeat") {
      this.cb.onFrame(frame);
      this.cb.onOfflineChange(false);
    } else if (frame.type === "decide_result") {
      // T10.6: Ausnahme-Zustände sichtbar — Ergebnis darf nicht still versickern
      this.cb.onFrame(frame);
    } else if (frame.type === "voice") {
      // T11.5: Nyx-Stimme — Cue-Ankündigung an die UI (Playback + Blase)
      this.cb.onFrame(frame);
    }
  }

  private applyState(snap: WebSnapshotFrame): void {
    this.latestSessionList = snap.sessionList;
    this.lastSessions = snap.sessions;
    if (snap.ui?.idleTicker !== undefined) this.tickerEnabled = snap.ui.idleTicker;
    const times = snap.sessionList
      .map((s) => Date.parse(s.updatedAt))
      .filter((t) => !Number.isNaN(t));
    const newest = times.length > 0 ? Math.max(...times) : null;
    if (newest !== null && (this.lastActivityMs === null || newest > this.lastActivityMs)) {
      this.lastActivityMs = newest;
    }
    const input = { nowMs: this.deps.now(), lastActivityMs: this.lastActivityMs, lastTickMs: this.lastTickMs, nextTickAtMs: this.nextTickAtMs };
    const nowDecayed = isDecayed(input);
    if (nowDecayed !== this.decayed) {
      this.decayed = nowDecayed;
      this.cb.onDecayChange(nowDecayed);
    }
    // Attention: neue Approval (action_id-Vergleich, Objekt-Identität gilt nicht) → Notification
    const approval = snap.approval;
    const isNew =
      approval !== null && (this.lastApproval === null || this.lastApproval.action_id !== approval.action_id);
    if (isNew) this.cb.onAttention(approval.payload.title);
    this.lastApproval = approval;
  }

  /** Ticker-Takt: prüft fällige Ticks und plant den nächsten (Idle-Modell T10.5). */
  private scheduleTick(): void {
    const step = (): void => {
      const nowMs = this.deps.now();
      const input = { nowMs, lastActivityMs: this.lastActivityMs, lastTickMs: this.lastTickMs, nextTickAtMs: this.nextTickAtMs };
      if (this.tickerEnabled && tickDue(input)) {
        const pick = pickTickerSession(this.latestSessionList, this.lastTickMs);
        if (pick !== null) {
          const text = pick.session.lastAssistantMessage ?? "";
          this.cb.onTicker(pick.session.name, text, pick.shownAtMs);
        }
        this.lastTickMs = nowMs;
        this.tickIndex += 1;
        this.nextTickAtMs = nowMs + nextTickDelayMs(nowMs, this.tickIndex);
      }
      this.tickHandle = this.deps.setTimeoutFn(step, 1000);
    };
    const nowMs = this.deps.now();
    this.nextTickAtMs = nowMs + nextTickDelayMs(nowMs, this.tickIndex);
    this.tickHandle = this.deps.setTimeoutFn(step, 1000);
  }

  /** Tap auf Nyx (verfallen): read-only Status, kein Ticker-Revive (T10.5). */
  tapNyx(): { showStatus: boolean; reviveTicker: boolean } {
    const input = { nowMs: this.deps.now(), lastActivityMs: this.lastActivityMs, lastTickMs: this.lastTickMs, nextTickAtMs: this.nextTickAtMs };
    const res = tapOnDecayedNyx(input);
    return { showStatus: res.showStatus, reviveTicker: res.reviveTicker };
  }

  decide(actionId: string, decision: "approve" | "decline"): void {
    this.ws?.send(JSON.stringify({ type: "decide", action_id: actionId, decision }));
  }

  /** Diktat → Hub-Session-Entwurf (Composer), nie Prompt/Steer. */
  draft(sessionId: string, text: string): void {
    this.ws?.send(JSON.stringify({ type: "draft", session_id: sessionId, text }));
  }
}
