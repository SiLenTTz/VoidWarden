/**
 * Zähler und Gesundheit (EPIC-P1 T1.6, observability.md §4): In-Memory-Metriken
 * für `voidwarden status`; Histogramm für Entscheidungs-Latenz (W1 p95),
 * Reconnect-Fenster (Warn ab > 5 / 10 min).
 */

export interface DecisionSample {
  actionId: string;
  ms: number;
}

export interface StatusSnapshot {
  link_state: string;
  hub_state: "up" | "down";
  counters: {
    frames_tx: number;
    frames_rx: number;
    frames_dropped: number;
    parse_err: number;
    reconnects: number;
    hub_errors: number;
    hub_polls: number;
    decisions_sent: number;
    decisions_deduped: number;
  };
  decision_latency_ms: { p50: number | null; p95: number | null; n: number };
  last_hello_ts: string | null;
  version: string;
}

export class Metrics {
  frames_tx = 0;
  frames_rx = 0;
  frames_dropped = 0;
  parse_err = 0;
  reconnects = 0;
  hub_errors = 0;
  hub_polls = 0;
  decisions_sent = 0;
  decisions_deduped = 0;

  link_state: "connected" | "reconnecting" | "stopped" = "stopped";
  hub_state: "up" | "down" = "down";
  last_hello_ts: string | null = null;

  private latency: number[] = [];
  private reconnectTimes: number[] = [];
  private readonly version: string;
  private readonly nowMs: () => number;

  constructor(version = "0.1.0", nowMs: () => number = () => Date.now()) {
    this.version = version;
    this.nowMs = nowMs;
  }

  noteDecisionLatency(ms: number): void {
    this.latency.push(ms);
    if (this.latency.length > 1000) this.latency.shift();
  }

  noteReconnect(): { warn: boolean; inWindow: number } {
    const now = this.nowMs();
    this.reconnects += 1;
    this.reconnectTimes.push(now);
    this.reconnectTimes = this.reconnectTimes.filter((t) => now - t <= 10 * 60 * 1000);
    const inWindow = this.reconnectTimes.length;
    return { warn: inWindow > 5, inWindow }; // Schwelle: > 5 / 10 min
  }

  percentile(q: number): number | null {
    if (this.latency.length === 0) return null;
    const sorted = [...this.latency].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.ceil((q / 100) * sorted.length) - 1);
    return sorted[Math.max(0, idx)] as number;
  }

  snapshot(): StatusSnapshot {
    return {
      link_state: this.link_state,
      hub_state: this.hub_state,
      counters: {
        frames_tx: this.frames_tx,
        frames_rx: this.frames_rx,
        frames_dropped: this.frames_dropped,
        parse_err: this.parse_err,
        reconnects: this.reconnects,
        hub_errors: this.hub_errors,
        hub_polls: this.hub_polls,
        decisions_sent: this.decisions_sent,
        decisions_deduped: this.decisions_deduped,
      },
      decision_latency_ms: { p50: this.percentile(50), p95: this.percentile(95), n: this.latency.length },
      last_hello_ts: this.last_hello_ts,
      version: this.version,
    };
  }
}
