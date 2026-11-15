/**
 * Interaktion (ADR-0009): führt Session-Fokus, Tap-Status, Session-Wechsel, Blasen-Ack und Idle-Chatter
 * zusammen. Pure bis auf die Senke: Zeit und Zufall werden injiziert, ausgeführt wird nichts außer
 * Anzeige-Frames (PRD §8.5). Kein Pfad führt zu `decide`; `ui_action` kennt den DecideClient nicht.
 */
import type { AggregateResult, ApprovalInput, SessionInput } from "./aggregate.ts";
import type { BubbleSpec } from "./bridge.ts";
import { BubblePolicy } from "./bubble-policy.ts";
import { IdleChatter, type ChatterOptions } from "./chatter.ts";
import { composeSessionStatus } from "./composer.ts";
import { sanitizeText } from "./sanitize.ts";
import { FocusController, toFocusSessions, type FocusSession, type FocusView } from "./focus.ts";

export interface InteractionSink {
  setFocus(view: FocusView | null): void;
  showBubble(spec: BubbleSpec): void;
  ackBubble(id: string): void;
  /** Eine kritische Blase wartet auf Ack: nichts Niedrigeres darf sie verdecken (W12). */
  hasCriticalBubble(): boolean;
  /** Dauerhaftes Tickerband unter Nyx: letzte Agent-Nachricht der fokussierten Session (ADR-0010). */
  setReport(report: { sessionId: string; title: string; body: string }): void;
}

/** Haltezeit der Tap-Blase, wenn sie die letzte Nachricht trägt (länger zu lesen). */
const TAP_HOLD_WITH_MESSAGE_S = 14;

export interface InteractionOptions {
  focusHoldS: number;
  /** Haltezeit der Tap-Status-Blase in Sekunden. */
  tapHoldS: number;
  /** Ab diesem Alter des Hub-Stands nennt der Tap-Status ihn veraltet. */
  staleAfterS: number;
  chatter: ChatterOptions & { enabled: boolean };
}

export interface HubView {
  sessions: SessionInput[];
  approvals: ApprovalInput[];
  agg: AggregateResult;
  hubUp: boolean;
}

/** Aktion aus `ui_action` (ohne Entscheidungsfelder, W9). */
export interface UiActionInput {
  action: "status_tap" | "focus_next" | "bubble_ack";
  ref?: string | undefined;
}

export class Interaction {
  private readonly sink: InteractionSink;
  private readonly opts: InteractionOptions;
  private readonly focus: FocusController;
  private readonly chatter: IdleChatter;
  private readonly policy = new BubblePolicy();
  private sessions: FocusSession[] = [];
  private latest: HubView | null = null;
  private lastGoodMs: number;
  private current: FocusView | null = null;
  private bubbleUntilMs = 0;
  private bubbleSeq = 0;
  private readonly messages = new Map<string, string>();
  private lastReportKey = "";

  constructor(sink: InteractionSink, opts: InteractionOptions, rng: () => number, startMs: number) {
    this.sink = sink;
    this.opts = opts;
    this.focus = new FocusController({ holdS: opts.focusHoldS });
    this.chatter = new IdleChatter(opts.chatter, rng, startMs);
    this.lastGoodMs = startMs;
  }

  /** Bei jedem Hub-Poll (auch bei Fehlschlag mit hubUp=false): Fokus aktualisieren. */
  onHub(view: HubView, nowMs: number): void {
    this.latest = view;
    if (view.hubUp) this.lastGoodMs = nowMs;
    this.sessions = toFocusSessions(view.sessions, view.approvals, nowMs);
    this.publish(this.focus.update(this.sessions, nowMs));
  }

  onUiAction(input: UiActionInput, nowMs: number): void {
    switch (input.action) {
      case "focus_next":
        this.publish(this.focus.next(nowMs));
        break;
      case "bubble_ack":
        if (input.ref !== undefined) this.sink.ackBubble(input.ref);
        break;
      case "status_tap":
        this.statusTap(nowMs);
        break;
    }
  }

  /** ID der fokussierten Session, damit der Aufrufer deren letzte Nachricht nachladen kann. */
  focusedSessionId(): string | null {
    const ref = this.current?.ref;
    return this.sessions.find((s) => s.ref === ref)?.id ?? null;
  }

  /** Letzte Agent-Nachricht einer Session (nur Anzeige, ADR-0004); Markdown-Zeichen fallen weg. */
  setLastMessage(sessionId: string, text: string): void {
    const clean = sanitizeText(text.replace(/[*#`_>]+/g, " "), 160);
    if (clean === "") return;
    this.messages.set(sessionId, clean);
    this.syncReport();
  }

  /** Periodisch (z. B. alle 5 s) aufrufen; spricht höchstens, wenn nichts Wichtiges sichtbar ist. */
  tick(nowMs: number): void {
    if (!this.opts.chatter.enabled || this.latest === null) return;
    const { agg } = this.latest;
    const phrase = this.chatter.tick(
      {
        state: agg.state,
        approvalOpen: agg.approval !== null,
        questionOpen: agg.approval?.kind === "question",
        bubbleActive: nowMs < this.bubbleUntilMs,
        criticalPending: this.sink.hasCriticalBubble(),
      },
      nowMs,
    );
    if (phrase === null) return;
    const decision = this.policy.offer({ level: "info", text: phrase }, nowMs);
    if (!decision.show) return;
    this.emit({ level: "info", title: "Nyx", body: phrase, holdS: decision.holdS, prefix: "chat" }, nowMs);
  }

  private publish(view: FocusView | null): void {
    this.current = view;
    this.sink.setFocus(view);
    this.syncReport();
  }

  // Sendet den Report nur bei geänderter Session/Text; das Gerät hält ihn nicht selbst (K7).
  private syncReport(): void {
    const id = this.focusedSessionId();
    const text = id === null ? undefined : this.messages.get(id);
    if (id === null || text === undefined || this.current === null) return;
    const key = `${id}\u0000${this.current.name}\u0000${text}`;
    if (key === this.lastReportKey) return;
    this.lastReportKey = key;
    this.sink.setReport({ sessionId: id, title: this.current.name, body: text });
  }

  private statusTap(nowMs: number): void {
    const view = this.latest;
    if (view === null) return;
    // Das Freigabe-Modal bleibt über allem, und eine kritische Blase wird nie verdeckt.
    if (view.agg.state === "approval_pending" || view.agg.approval !== null || this.sink.hasCriticalBubble()) return;
    const focused = this.current;
    const found = focused === null ? undefined : this.sessions.find((s) => s.ref === focused.ref);
    const focusId = this.focusedSessionId();
    const lastMessage = focusId === null ? undefined : this.messages.get(focusId);
    const { title, body } = composeSessionStatus(
      {
        focus:
          focused === null
            ? null
            : { idx: focused.idx, total: focused.total, ref: focused.ref, status: focused.status, name: focused.name },
        ...(lastMessage === undefined ? {} : { lastMessage }),
        working: view.agg.sessions.working,
        blocked: view.agg.sessions.waiting,
        error: view.agg.sessions.error,
        hubUp: view.hubUp,
        dataAgeS: Math.max(0, (nowMs - this.lastGoodMs) / 1000),
        ...(found?.summary === undefined ? {} : { pendingSummary: found.summary }),
      },
      { staleAfterS: this.opts.staleAfterS, lineChars: 40, compactLines: 2 },
    );
    const holdS = lastMessage === undefined ? this.opts.tapHoldS : Math.max(this.opts.tapHoldS, TAP_HOLD_WITH_MESSAGE_S);
    this.emit({ level: "info", title, body, holdS, prefix: "tap" }, nowMs);
  }

  private emit(b: { level: BubbleSpec["level"]; title: string; body: string; holdS: number; prefix: string }, nowMs: number): void {
    this.bubbleSeq += 1;
    this.bubbleUntilMs = nowMs + b.holdS * 1000;
    this.sink.showBubble({
      id: `${b.prefix}-${this.bubbleSeq}`,
      level: b.level,
      title: b.title,
      body: b.body,
      holdS: b.holdS,
      ackRequired: false,
    });
  }
}
