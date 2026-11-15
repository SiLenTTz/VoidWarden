/**
 * Bridge (EPIC-P1 T1.4): hält den ESP32-Zustand aktuell.
 *  - `hello`/`resync` vom Gerät → voller `snapshot` (K7: alles rekonstruierbar)
 *  - `seq` steigt pro Link-Sitzung monoton, Reset bei `hello`
 *  - Heartbeat alle 5 s mit `hub`-Feld (Link-weg vs. Hub-weg, spec §4.3)
 *  - Coalescing: nur Änderungen, ≤ 10 Frames/s (W2/K2)
 *  - Sanitizing von Titel/Body (Prompt-Injection-Grenze, ADR-0004)
 * Fail loud: Dekodierfehler zählen und loggen, nie still.
 */
import type { Link } from "./link.ts";
import type { Clock } from "./clock.ts";
import { decodeLine, encodeFrame, splitLinePrefix, type Frame, type SeqFrame } from "./frames.ts";
import { sanitizePayload, type RawPayload } from "./sanitize.ts";
import type { AggregateResult, PendingApproval } from "./aggregate.ts";
import type { FocusView } from "./focus.ts";

export type BridgeLog = (msg: string, fields?: Record<string, string | number | boolean>) => void;

/** Wartezeit auf hello, bevor die Bridge von sich aus einen snapshot schickt (BUG-0008). */
const BOOT_SNAPSHOT_MS = 1500;

export interface BridgeOptions {
  link: Link;
  clock: Clock;
  /** Aktueller aggregierter Zustand (von der Hub-Poll-Schicht gesetzt). */
  getAggregate: () => AggregateResult | null;
  /** Hub-Erreichbarkeit aus Sicht der Poll-Schicht (W6: ehrlich vor erstem Poll). */
  getHubState?: () => "up" | "down";
  /** Frames vom Gerät, die die Bridge nicht selbst behandelt (P3: action_response). */
  onDeviceFrame?: (frame: Frame) => void;
  /** hello weiterreichen (Metrics: last_hello_ts). */
  onHello?: (fw: string, resetReason: string) => void;
  /** Jeder gesendete Frame (Metrics: frames_tx). */
  onSend?: (type: string) => void;
  log?: BridgeLog;
  /** Minuten Ost von UTC zum Zeitpunkt `isoTs` (T4.7); fehlt die Funktion, wird das Feld weggelassen. */
  utcOffsetMin?: (isoTs: string) => number;
  heartbeatMs?: number;
  coalesceMs?: number;
  /** Maximale gestapelte Notifications; darüber wird sichtbar verworfen. */
  notificationQueueMax?: number;
}

export interface BridgeCounters {
  tx: number;
  rx: number;
  parse_err: number;
  oversize: number;
  encode_err: number;
  /** Verworfene Notifications (Queue voll) — sichtbar, nie still (Fail loud). */
  dropped: number;
  /** Additive Protokollfelder: erlaubt, aber gezählt und gemeldet (ADR-0002). */
  unknown_fields: number;
  /** Frames, die bei geschlossenem Link nicht rausgingen (Start vor Port-open): kein Fehler, der snapshot nach dem Öffnen holt nach. */
  deferred: number;
  /** Bytes vor dem ersten `{` (ROM-Loader beim Boot, EPIC-P2 T2.9): abgetrennt, gezählt, gemeldet. */
  line_prefix: number;
}

type SnapshotApproval = Extract<Frame, { type: "snapshot" }>["approval"];

function approvalToSnapshotField(approval: PendingApproval | null): SnapshotApproval {
  if (approval === null) return null;
  return {
    action_id: approval.action_id,
    ...(approval.kind === "question" ? { kind: "question" as const } : {}),
    agent_id: approval.agent_id,
    class: approval.class,
    payload: sanitizePayload(approval.payload),
    timeout_s: Math.round(approval.timeout_s),
    decidable: approval.decidable,
  };
}

/** Blase aus dem Composer (T8.1/T8.2); Text wird hier ein letztes Mal bereinigt und gekürzt. */
export interface BubbleSpec {
  id: string;
  level: "info" | "success" | "error" | "critical";
  title: string;
  body: string;
  holdS: number;
  ackRequired: boolean;
}

export class Bridge {
  private seq = 0;
  private lastSentState: string | null = null;
  /** Freigabe, die das Gerät zuletzt per snapshot bekam (BUG-0007): state_change trägt keine. */
  private lastSentApprovalId: string | null = null;
  /** Fokus, den das Gerät zuletzt bekam: nach hello/resync erneut senden (K7, ADR-0009). */
  private lastFocus: FocusView | null = null;
  private heartbeatHandle: unknown = null;
  private coalesceHandle: unknown = null;
  private coalescePending: SeqFrame | null = null;
  private notificationQueue: SeqFrame[] = [];
  /** Jüngste Meldung: nach snapshot erneut gesendet, das Gerät hält den letzten Report nicht selbst (K7). */
  private lastNotification: SeqFrame | null = null;
  /** Aktive kritische Blase (wartet auf Ack): nach hello/resync erneut senden (K7, AC-P8-3). */
  private activeCritical: BubbleSpec | null = null;
  /** hello/resync kam, aber es gab noch keinen Zustand → Snapshot nachziehen (K7). */
  private snapshotPending = false;
  private deviceGreeted = false; // hello oder resync gesehen: das Gerät fordert selbst an
  private bootSnapshotHandle: unknown = null;
  private stopped = false;
  private readonly opts: BridgeOptions;
  readonly counters: BridgeCounters = { tx: 0, rx: 0, parse_err: 0, oversize: 0, encode_err: 0, dropped: 0, unknown_fields: 0, line_prefix: 0, deferred: 0 };

  constructor(opts: BridgeOptions) {
    this.opts = opts;
  }

  start(): void {
    this.opts.link.onLine((line) => this.handleLine(line));
    this.scheduleHeartbeat();
    // Das Board sagt hello nur beim Boot. Läuft es schon, wenn der Port aufgeht, kommt keins: dann
    // einmal von uns aus den Zustand liefern (K7, BUG-0008).
    this.bootSnapshotHandle = this.opts.clock.after(BOOT_SNAPSHOT_MS, () => {
      this.bootSnapshotHandle = null;
      if (!this.stopped && !this.deviceGreeted) this.sendSnapshot();
    });
  }

  stop(): void {
    this.stopped = true;
    if (this.heartbeatHandle !== null) this.opts.clock.cancel(this.heartbeatHandle);
    if (this.bootSnapshotHandle !== null) this.opts.clock.cancel(this.bootSnapshotHandle);
    if (this.coalesceHandle !== null) this.opts.clock.cancel(this.coalesceHandle);
  }

  /** Vom Poller bei jedem Hub-Ergebnis gerufen; sendet nur Änderungen. */
  onAggregate(result: AggregateResult): void {
    if (this.stopped) return;
    if (this.snapshotPending) {
      this.sendSnapshot(result);
      return;
    }
    // Eine Freigabe erreicht das Gerät nur im snapshot; erscheint, wechselt oder endet sie, geht
    // sofort einer raus (BUG-0007). Er trägt auch den Zustand, ein wartendes state_change entfällt.
    if ((result.approval?.action_id ?? null) !== this.lastSentApprovalId) {
      this.sendSnapshot(result);
      return;
    }
    if (result.state === this.lastSentState) return;
    const frame: SeqFrame = {
      v: 1,
      type: "state_change",
      seq: 0, // wird beim Senden gesetzt
      state: result.state,
    };
    this.coalesce(frame);
  }

  /**
   * Ticker-Eintrag (Quelle /api/notifications). Notifications sind Einzeldaten,
   * kein Zustand: sie gehen in einen FIFO und werden pro Coalesce-Tick mit
   * ausgesendet (Budget 2/Tick, W2 ≤ 10 Frames/s). Bei Überlauf wird sichtbar
   * verworfen: Zähler + Log, nie still (Fail loud).
   */
  onNotification(agentId: string, level: "info" | "success" | "warning" | "error", payload: RawPayload): void {
    if (this.stopped) return;
    const max = this.opts.notificationQueueMax ?? 50;
    while (this.notificationQueue.length >= max) {
      const droppedFrame = this.notificationQueue.shift();
      this.counters.dropped += 1;
      this.opts.log?.("bridge:notification_dropped", {
        agent_id: droppedFrame?.type === "notification" ? droppedFrame.agent_id : "?",
        queue_max: max,
      });
    }
    const note: SeqFrame = {
      v: 1,
      type: "notification",
      seq: 0,
      agent_id: agentId,
      level,
      payload: sanitizePayload(payload),
    };
    this.notificationQueue.push(note);
    this.lastNotification = { ...note };
    this.ensureCoalesceTimer();
  }

  /** action_result nur aus Hub-Wahrheit (spec §4.4): ruft der Decide-Pfad. */
  sendActionResult(actionId: string, status: "approved" | "rejected" | "timed_out" | "stale" | "error"): void {
    this.send({
      v: 1,
      type: "action_result",
      seq: this.nextSeq(),
      action_id: actionId,
      status,
    });
  }

  /** Sendet eine Blase sofort (die Policy hat entschieden, nicht der Bridge-Takt). */
  showBubble(spec: BubbleSpec): void {
    if (this.stopped) return;
    if (spec.ackRequired) this.activeCritical = spec;
    this.sendBubble(spec);
  }

  /**
   * Fokussierte Session (ADR-0009). Sendet nur bei Änderung. Entfällt der Fokus ganz (keine
   * Sessions mehr), kennt das Protokoll keinen leeren Fokus: ein snapshot mit sessions.total=0
   * löscht ihn am Gerät, und nach resync kommt kein veralteter Fokus zurück.
   */
  setFocus(view: FocusView | null): void {
    if (this.stopped) return;
    const prev = this.lastFocus;
    if (view === null) {
      this.lastFocus = null;
      if (prev !== null) this.sendSnapshot();
      return;
    }
    const same =
      prev !== null && prev.idx === view.idx && prev.total === view.total && prev.ref === view.ref && prev.status === view.status;
    this.lastFocus = view;
    if (!same) this.sendFocus(view);
  }

  private sendFocus(view: FocusView): void {
    this.send({
      v: 1,
      type: "session_focus",
      seq: this.nextSeq(),
      idx: view.idx,
      total: view.total,
      ref: view.ref,
      name: view.name,
      status: view.status,
    });
  }

  /** Eine kritische Blase wartet auf Ack (ADR-0009: nichts Niedrigeres darf sie verdecken). */
  hasCriticalBubble(): boolean {
    return this.activeCritical !== null;
  }

  /** Nutzer hat quittiert (ui_action bubble_ack folgt mit T6.6): kein Wiederholen mehr. */
  ackBubble(id: string): void {
    if (this.activeCritical?.id === id) this.activeCritical = null;
  }

  private sendBubble(spec: BubbleSpec): void {
    this.send({
      v: 1,
      type: "bubble",
      seq: this.nextSeq(),
      bubble_id: spec.id.slice(0, 36),
      level: spec.level,
      payload: sanitizePayload({ title: spec.title, body: spec.body }),
      hold_s: Math.min(255, Math.max(0, Math.round(spec.holdS))),
      ack_required: spec.ackRequired,
    });
  }

  /** Sendet sofort (antwortet auf hello/resync) — Recovery hat Vorrang (K7/W5). */
  sendSnapshot(latest?: AggregateResult): void {
    const agg = latest ?? this.opts.getAggregate();
    if (agg === null) {
      // Noch kein Hub-Poll gelaufen: Auftrag merken und beim ersten Zustand
      // nachziehen — das Gerät wartet sonst stumm (K7, Review-Fund aus dem
      // companion_restart-Messlauf).
      this.snapshotPending = true;
      return;
    }
    this.snapshotPending = false;
    this.coalescePending = null; // ein älteres state_change würde den Snapshot-Zustand überschreiben
    const frame: Frame = {
      v: 1,
      type: "snapshot",
      seq: this.nextSeq(),
      state: agg.state,
      sessions: agg.sessions,
      approval: approvalToSnapshotField(agg.approval),
      hub: agg.state === "offline" ? "down" : "up",
      ts: this.opts.clock.now(),
      ...this.offsetField(),
    };
    this.send(frame);
    this.lastSentState = agg.state;
    this.lastSentApprovalId = agg.approval?.action_id ?? null;
    if (this.lastNotification !== null && this.notificationQueue.length === 0) {
      this.notificationQueue.push({ ...this.lastNotification });
      this.ensureCoalesceTimer();
    }
    if (this.lastFocus !== null) this.sendFocus(this.lastFocus);
    if (this.activeCritical !== null) this.sendBubble(this.activeCritical);
  }

  private offsetField(): { utc_offset_min?: number } {
    return this.opts.utcOffsetMin ? { utc_offset_min: this.opts.utcOffsetMin(this.opts.clock.now()) } : {};
  }

  private nextSeq(): number {
    this.seq += 1;
    return this.seq;
  }

  private coalesce(frame: SeqFrame): void {
    // W2/K2: nur das jeweils letzte anstehende state_change pro Taktfenster.
    this.coalescePending = frame;
    this.ensureCoalesceTimer();
  }

  private ensureCoalesceTimer(): void {
    if (this.coalesceHandle !== null || this.stopped) return;
    const ms = this.opts.coalesceMs ?? 100;
    this.coalesceHandle = this.opts.clock.after(ms, () => {
      this.coalesceHandle = null;
      const pending = this.coalescePending;
      this.coalescePending = null;
      if (this.stopped) return;
      if (pending !== null) {
        pending.seq = this.nextSeq();
        this.send(pending);
        if (pending.type === "state_change") this.lastSentState = pending.state;
      }
      // Notifications: bis zu 2 pro Tick (Rate-Budget innerhalb W2); bei
      // Rest-Queue sofort nachziehen, sonst wartet die letzte auf ein neues Ereignis.
      for (let i = 0; i < 2 && this.notificationQueue.length > 0; i++) {
        const note = this.notificationQueue.shift();
        if (note !== undefined) {
          note.seq = this.nextSeq();
          this.send(note);
        }
      }
      if (this.notificationQueue.length > 0) this.ensureCoalesceTimer();
    });
  }

  private scheduleHeartbeat(): void {
    const ms = this.opts.heartbeatMs ?? 5000;
    this.heartbeatHandle = this.opts.clock.after(ms, () => {
      this.heartbeatHandle = null;
      if (this.stopped) return;
      const agg = this.opts.getAggregate();
      const hubDown = this.opts.getHubState ? this.opts.getHubState() === "down" : agg === null || agg.state === "offline";
      this.send({
        v: 1,
        type: "heartbeat",
        seq: this.nextSeq(),
        ts: this.opts.clock.now(),
        hub: hubDown ? "down" : "up",
        ...this.offsetField(),
      });
      this.scheduleHeartbeat();
    });
  }

  private send(frame: Frame): void {
    if (!this.opts.link.isOpen) {
      this.counters.deferred += 1;
      return;
    }
    try {
      this.opts.link.writeLine(encodeFrame(frame));
      this.counters.tx += 1;
      this.opts.onSend?.(frame.type);
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes("K5)")) this.counters.oversize += 1;
      else this.counters.encode_err += 1;
      this.opts.log?.("bridge:frame_rejected", { type: frame.type, error: msg.slice(0, 120) });
    }
  }

  private handleLine(rawLine: string): void {
    this.counters.rx += 1;
    const { prefix, body } = splitLinePrefix(rawLine);
    if (prefix.length > 0) {
      // Nur die ersten Bytes als Hex: das Präfix ist Gerätedaten, kein Klartext-Log.
      this.counters.line_prefix += 1;
      this.opts.log?.("bridge:line_prefix", {
        bytes: Buffer.byteLength(prefix, "utf8"),
        head_hex: Buffer.from(prefix, "utf8").subarray(0, 8).toString("hex"),
      });
    }
    const res = decodeLine(body);
    if (res.ok && res.unknownFields.length > 0) {
      this.counters.unknown_fields += res.unknownFields.length;
      this.opts.log?.("bridge:unknown_fields", {
        type: res.frame.type,
        fields: res.unknownFields.join(",").slice(0, 80),
      });
    }
    if (!res.ok) {
      this.counters.parse_err += 1;
      this.opts.log?.("bridge:parse_error", {
        kind: res.failure.kind,
        bytes: res.failure.bytes,
        message: res.failure.message.slice(0, 120),
      });
      return;
    }
    const frame = res.frame;
    switch (frame.type) {
      case "hello":
        // Neue Link-Sitzung: seq zurücksetzen und vollständigen Zustand liefern.
        this.seq = 0;
        this.deviceGreeted = true;
        this.opts.log?.("bridge:hello", { fw: frame.fw, reset_reason: frame.reset_reason });
        this.opts.onHello?.(frame.fw, frame.reset_reason);
        this.sendSnapshot();
        break;
      case "resync":
        this.deviceGreeted = true;
        this.opts.log?.("bridge:resync", { last_seq: frame.last_seq });
        this.sendSnapshot();
        break;
      default:
        this.opts.onDeviceFrame?.(frame);
        break;
    }
  }
}
