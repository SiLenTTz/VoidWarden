/**
 * Simulator (EPIC-P1 T1.7): Fake-ESP32 über MemoryLink — sendet `hello`,
 * `stats`, `action_response` und kann Lücken, Müll, Überlänge und Stille
 * injizieren. Abnahmewerkzeug für den Companion ohne Board (docs/testing.md §4).
 */
import type { Link } from "./link.ts";
import { encodeFrame } from "./frames.ts";

export interface DeviceFrameLog {
  dir: "rx" | "tx"; // aus Sicht des Geräts
  line: string;
  ts: string;
}

export interface FakeDeviceOptions {
  link: Link; // Geräte-Ende des MemoryLink-Paars
  monitor?: (entry: DeviceFrameLog) => void;
  now?: () => string;
  fw?: string;
}

export class FakeDevice {
  private readonly opts: FakeDeviceOptions;
  readonly received: string[] = [];
  readonly sent: string[] = [];

  constructor(opts: FakeDeviceOptions) {
    this.opts = opts;
  }

  async start(): Promise<void> {
    await this.opts.link.open();
    this.opts.link.onLine((line) => {
      this.received.push(line);
      this.opts.monitor?.({ dir: "rx", line, ts: (this.opts.now ?? (() => new Date().toISOString()))() });
    });
  }

  private send(line: string): void {
    this.sent.push(line);
    this.opts.link.writeLine(line);
    this.opts.monitor?.({ dir: "tx", line, ts: (this.opts.now ?? (() => new Date().toISOString()))() });
  }

  hello(resetReason = "POWERON_RESET"): void {
    this.send(
      encodeFrame({
        v: 1,
        type: "hello",
        fw: this.opts.fw ?? "0.1.0",
        proto: 1,
        screen: { w: 480, h: 320 },
        reset_reason: resetReason,
        heap_free: 280_000,
      }),
    );
  }

  stats(): void {
    this.send(
      encodeFrame({
        v: 1,
        type: "stats",
        fps: 29.9,
        heap_free: 190_000,
        heap_min: 180_000,
        uptime_s: 120,
        rx_overrun: 0,
        parse_err: 0,
      }),
    );
  }

  actionResponse(actionId: string, decision: "approve" | "decline", ms: number): void {
    this.send(encodeFrame({ v: 1, type: "action_response", action_id: actionId, decision, ms }));
  }

  /** Tap-Wunsch des Geräts (ADR-0009): nie eine Entscheidung, nur Anzeige. */
  uiAction(action: "status_tap" | "focus_next" | "bubble_ack", ref?: string): void {
    this.send(encodeFrame({ v: 1, type: "ui_action", action, ...(ref === undefined ? {} : { ref }), ms: 12 }));
  }

  /** Frames eines Typs, die das Gerät bisher empfangen hat (für Trockenlauf-Belege). */
  receivedOfType(type: string): Record<string, unknown>[] {
    const out: Record<string, unknown>[] = [];
    for (const line of this.received) {
      try {
        const o = JSON.parse(line) as Record<string, unknown>;
        if (o.type === type) out.push(o);
      } catch {
        /* Müll bleibt in received; hier nur Typfilter */
      }
    }
    return out;
  }

  resync(lastSeq: number): void {
    this.send(encodeFrame({ v: 1, type: "resync", last_seq: lastSeq }));
  }

  // --- Fehlerinjektion -----------------------------------------------------

  injectGarbage(): void {
    this.send("das ist kein json");
  }

  /** ROM-Bytes vor dem ersten hello, ohne Zeilenende davor (EPIC-P2 T2.9). */
  injectRomPrefixThenHello(): void {
    this.send("\u001b[0m\u0000" + encodeFrame({ v: 1, type: "hello", fw: this.opts.fw ?? "0.1.0", proto: 1, screen: { w: 320, h: 240 }, reset_reason: "POWERON_RESET", heap_free: 244160 }));
  }

  injectOversize(): void {
    this.send('{"v":1,"type":"log","level":"info","msg":"' + "x".repeat(600) + '"}');
  }

  injectUnknownType(): void {
    this.send('{"v":1,"type":"mystery","payload":1}');
  }

  /** Stille: tut nichts für ms Millisekunden (Heartbeat-Timeout testen, W6). */
  async silence(ms: number): Promise<void> {
    await new Promise((r) => setTimeout(r, ms));
  }

  stop(): void {
    void this.opts.link.close();
  }
}
