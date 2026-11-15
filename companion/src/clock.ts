/**
 * Injizierbare Uhr/Timer (EPIC-P1, docs/testing.md §2.2: kein Test gegen
 * reale Zeit). FakeClock steuert Zeit deterministisch von Hand.
 */

export interface Clock {
  /** ISO-8601 UTC der aktuellen Zeit. */
  now(): string;
  after(ms: number, cb: () => void): unknown;
  cancel(handle: unknown): void;
}

export class RealClock implements Clock {
  now(): string {
    return new Date().toISOString();
  }
  after(ms: number, cb: () => void): unknown {
    return setTimeout(cb, ms);
  }
  cancel(handle: unknown): void {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  }
}

/** Manuell weiterstellbare Zeit; Timer feuern bei advance(). */
export class FakeClock implements Clock {
  private nowMs: number;
  private nextId = 1;
  private timers = new Map<number, { at: number; cb: () => void }>();

  constructor(startMs = Date.parse("2026-11-03T12:00:00.000Z")) {
    this.nowMs = startMs;
  }

  now(): string {
    return new Date(this.nowMs).toISOString();
  }

  after(ms: number, cb: () => void): unknown {
    const id = this.nextId++;
    this.timers.set(id, { at: this.nowMs + ms, cb });
    return id;
  }

  cancel(handle: unknown): void {
    this.timers.delete(handle as number);
  }

  /** Zeit um ms Millisekunden weiterstellen; fällige Timer feuern in Ordnung. */
  advance(ms: number): void {
    const target = this.nowMs + ms;
    for (;;) {
      let dueId: number | null = null;
      let dueAt = Infinity;
      for (const [id, t] of this.timers) {
        if (t.at <= target && t.at < dueAt) {
          dueAt = t.at;
          dueId = id;
        }
      }
      if (dueId === null) break;
      const t = this.timers.get(dueId) as { at: number; cb: () => void };
      this.timers.delete(dueId);
      this.nowMs = t.at;
      t.cb();
    }
    this.nowMs = target;
  }
}
