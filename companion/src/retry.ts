/**
 * Reconnect/Backoff (EPIC-P1 T1.5): 250 ms → 5 s, exponentiell, mit Jitter
 * (architecture.md §4). Die Delay-Berechnung ist pure und mit injiziertem
 * Zufall deterministisch testbar (docs/testing.md §2.2).
 */
import type { Clock } from "./clock.ts";

export interface BackoffOptions {
  minMs: number;
  maxMs: number;
  factor: number;
  /** 0..1 — relative Streuung um den Soll-Delay (Default 0,2). */
  jitterRatio: number;
}

export const DEFAULT_BACKOFF: BackoffOptions = {
  minMs: 250,
  maxMs: 5000,
  factor: 2,
  jitterRatio: 0.2,
};

/** Delay für den n-ten Wiederholungsversuch (attempt ab 0). rand ∈ [0,1). */
export function nextDelay(attempt: number, opts: BackoffOptions = DEFAULT_BACKOFF, rand = 0.5): number {
  const base = Math.min(opts.maxMs, opts.minMs * Math.pow(opts.factor, attempt));
  const jitter = 1 + (rand * 2 - 1) * opts.jitterRatio;
  return Math.round(base * jitter);
}

export type ConnectionState = "connected" | "reconnecting" | "stopped";

/** Ressource, die der Reconnector am Leben hält. */
export interface ManagedConnection {
  close(): void;
  onClose(cb: () => void): void;
}

export interface ReconnectorEvents {
  onState?: (state: ConnectionState, attempt: number) => void;
}

export class Reconnector {
  private state: ConnectionState = "reconnecting";
  private attempt = 0;
  private timer: unknown = null;
  private stopped = false;
  private readonly connect: () => Promise<ManagedConnection>;
  private readonly clock: Clock;
  private readonly events: ReconnectorEvents;
  private readonly backoff: BackoffOptions;
  private readonly rand: () => number;
  reconnects = 0;

  constructor(
    connect: () => Promise<ManagedConnection>,
    clock: Clock,
    events: ReconnectorEvents = {},
    backoff: BackoffOptions = DEFAULT_BACKOFF,
    rand: () => number = () => 0.5,
  ) {
    this.connect = connect;
    this.clock = clock;
    this.events = events;
    this.backoff = backoff;
    this.rand = rand;
  }

  start(): void {
    void this.tryConnect();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== null) this.clock.cancel(this.timer);
    this.setState("stopped");
  }

  get currentState(): ConnectionState {
    return this.state;
  }

  private async tryConnect(): Promise<void> {
    if (this.stopped) return;
    try {
      const conn = await this.connect();
      if (this.stopped) {
        conn.close();
        return;
      }
      this.attempt = 0;
      this.setState("connected");
      conn.onClose(() => {
        if (this.stopped) return;
        this.reconnects += 1;
        this.setState("reconnecting");
        this.scheduleRetry();
      });
    } catch {
      this.scheduleRetry();
    }
  }

  private scheduleRetry(): void {
    const delay = nextDelay(this.attempt, this.backoff, this.rand());
    this.attempt += 1;
    this.timer = this.clock.after(delay, () => {
      void this.tryConnect();
    });
  }

  private setState(s: ConnectionState): void {
    this.state = s;
    this.events.onState?.(s, this.attempt);
  }
}

/**
 * Poll-Loop mit Fehler-Backoff (Hub): Erfolg → intervalMs, Fehler →
 * exponentiell bis maxMs, bei Erfolg Reset. Zähler für Log/Ticker (W6).
 */
export interface PollerEvents<T> {
  onResult?: (result: T) => void;
  onError?: (error: Error, consecutiveErrors: number) => void;
}

export class Poller<T> {
  private timer: unknown = null;
  private attempt = 0;
  private stopped = false;
  private readonly fetchNow: () => Promise<T>;
  private readonly clock: Clock;
  private readonly intervalMs: number;
  private readonly events: PollerEvents<T>;
  private readonly backoff: BackoffOptions;
  private readonly rand: () => number;
  consecutiveErrors = 0;
  runs = 0;

  constructor(
    fetchNow: () => Promise<T>,
    clock: Clock,
    intervalMs: number,
    events: PollerEvents<T> = {},
    backoff: BackoffOptions = DEFAULT_BACKOFF,
    rand: () => number = () => 0.5,
  ) {
    this.fetchNow = fetchNow;
    this.clock = clock;
    this.intervalMs = intervalMs;
    this.events = events;
    this.backoff = backoff;
    this.rand = rand;
  }

  start(): void {
    void this.tick();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer !== null) this.clock.cancel(this.timer);
  }

  private async tick(): Promise<void> {
    if (this.stopped) return;
    let delay = this.intervalMs;
    try {
      const result = await this.fetchNow();
      this.runs += 1;
      this.consecutiveErrors = 0;
      this.attempt = 0;
      this.events.onResult?.(result);
    } catch (err) {
      this.consecutiveErrors += 1;
      delay = nextDelay(this.attempt, this.backoff, this.rand());
      this.attempt += 1;
      this.events.onError?.(err as Error, this.consecutiveErrors);
    }
    if (this.stopped) return;
    this.timer = this.clock.after(delay, () => {
      void this.tick();
    });
  }
}
