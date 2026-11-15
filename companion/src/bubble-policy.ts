/**
 * Blasen-Policy (EPIC-P8 T8.2, W12): entscheidet, ob ein Kandidat eine Blase wird — pure, Uhr
 * injiziert (kein Timer). Regeln aus EPIC-P8 §3: Dedupe über `messageHash`, Rate-Limit gegen
 * Fluten, Haltezeiten (Fehler ≥ 12 s, Erfolg 4 s, Info 6 s), kritische Blasen (error/Freigabe)
 * verlangen Ack und verdrängen nur Niedrigeres, periodisch nur bei neuem Zustand. Nichts wird
 * still verworfen: jede Entscheidung trägt einen Grund, Kritisches wartet in der Warteschlange.
 */
export type BubbleLevel = "info" | "success" | "error" | "critical";

export interface BubbleCandidate {
  level: BubbleLevel;
  text: string;
}

export interface PolicyOptions {
  periodicS: number;
  holdS: Record<BubbleLevel, number>;
  dedupeWindowS: number;
  /** Höchstens so viele nichtkritische Blasen je 60 s. */
  maxPerMinute: number;
}

export const DEFAULT_POLICY: PolicyOptions = {
  periodicS: 60,
  holdS: { info: 6, success: 4, error: 12, critical: 0 },
  dedupeWindowS: 30,
  maxPerMinute: 6,
};

export type Reason =
  | "shown"
  | "dedupe"
  | "rate_limit"
  | "blocked_by_critical"
  | "blocked_by_error"
  | "queued"
  | "no_new_state"
  | "periodic_too_early";

export interface Decision {
  show: boolean;
  reason: Reason;
  holdS: number;
  ackRequired: boolean;
}

/** FNV-1a 32 Bit: stabil, ohne Crypto — Dedupe-Schlüssel, kein Sicherheitsmerkmal. */
export function messageHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export class BubblePolicy {
  private readonly seen = new Map<string, number>();
  private shownAt: number[] = [];
  private active: { level: BubbleLevel; until: number } | null = null;
  private criticalActive = false;
  private queue: BubbleCandidate[] = [];
  private lastPeriodicMs = Number.NEGATIVE_INFINITY;
  private lastStateKey: string | null = null;

  private readonly opts: PolicyOptions;

  constructor(opts: PolicyOptions = DEFAULT_POLICY) {
    this.opts = opts;
  }

  private deny(reason: Reason): Decision {
    return { show: false, reason, holdS: 0, ackRequired: false };
  }

  private activate(c: BubbleCandidate, nowMs: number): Decision {
    const holdS = this.opts.holdS[c.level];
    this.active = { level: c.level, until: nowMs + holdS * 1000 };
    this.seen.set(messageHash(c.text), nowMs);
    this.shownAt.push(nowMs);
    this.criticalActive = c.level === "critical";
    return { show: true, reason: "shown", holdS, ackRequired: c.level === "critical" };
  }

  offer(c: BubbleCandidate, nowMs: number): Decision {
    this.shownAt = this.shownAt.filter((t) => nowMs - t < 60_000);
    const hash = messageHash(c.text);
    const last = this.seen.get(hash);
    if (last !== undefined && nowMs - last < this.opts.dedupeWindowS * 1000) {
      return this.deny("dedupe");
    }
    if (this.criticalActive) {
      if (c.level === "critical") {
        this.queue.push(c);
        return this.deny("queued");
      }
      return this.deny("blocked_by_critical");
    }
    const active = this.active !== null && nowMs < this.active.until ? this.active : null;
    // Ein gehaltener Fehler wird von nichts Niedrigerem oder Gleichrangigem verdrängt
    // (kein Aufschaukeln); nur kritisch geht vorbei.
    if (active?.level === "error" && c.level !== "critical") return this.deny("blocked_by_error");
    if (c.level !== "critical" && this.shownAt.length >= this.opts.maxPerMinute) {
      return this.deny("rate_limit");
    }
    return this.activate(c, nowMs);
  }

  /** Nutzer quittiert die kritische Blase; liefert die nächste wartende, falls vorhanden. */
  ack(nowMs: number): BubbleCandidate | null {
    this.criticalActive = false;
    this.active = null;
    const next = this.queue.shift();
    if (next === undefined) return null;
    this.activate(next, nowMs);
    return next;
  }

  /** Fehler gilt als gelöst (`resolved` oder neuerer Zustand): Haltezeit endet. */
  resolveError(): void {
    if (this.active?.level === "error") this.active = null;
  }

  /** Periodische Statusblase: nur nach `periodicS` und nur, wenn sich der Zustand geändert hat. */
  periodic(stateKey: string, nowMs: number): Decision {
    if (nowMs - this.lastPeriodicMs < this.opts.periodicS * 1000) return this.deny("periodic_too_early");
    this.lastPeriodicMs = nowMs;
    if (stateKey === this.lastStateKey) return this.deny("no_new_state");
    this.lastStateKey = stateKey;
    return { show: true, reason: "shown", holdS: this.opts.holdS.info, ackRequired: false };
  }

  get pendingCritical(): number {
    return this.queue.length;
  }
}
