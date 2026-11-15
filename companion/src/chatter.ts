/**
 * Idle-Chatter (EPIC-P8 T8.12, ADR-0009): Nyx sagt gelegentlich etwas Eigenes. Pure, Uhr und Zufall
 * injiziert. Die Phrasen sind lokale Konstanten ohne Statusbehauptung (W10) und nie Agent-Text
 * (PRD §8.5); der Chatter löst nie eine Aktion aus. Er spricht nur im Zustand `idle` und nie, wenn
 * etwas Wichtiges sichtbar ist oder ansteht. Der Mindestabstand erfüllt W12 (höchstens 1 je 60 s).
 */
import type { NyxState } from "./aggregate.ts";

export const CHATTER_PHRASES: readonly string[] = [
  "Die Leere ist heute ruhig.",
  "Ich halte die Wacht.",
  "Schatten sind auch Gesellschaft.",
  "Kein Wort ist auch ein Wort.",
  "Falls etwas ist: Ich bin hier.",
  "Ich lausche ins Dunkel.",
  "Manchmal blinzle ich einfach so.",
  "Die Kapuze sitzt gut.",
  "Stille hat auch ihren Reiz.",
  "Ich zähle die Sekunden. Zwecklos, aber schön.",
];

export interface ChatterContext {
  state: NyxState;
  approvalOpen: boolean;
  questionOpen: boolean;
  /** Eine Blase ist gerade sichtbar (Haltezeit läuft). */
  bubbleActive: boolean;
  /** Eine kritische Blase wartet auf Ack oder in der Queue. */
  criticalPending: boolean;
}

export interface ChatterOptions {
  /** Mindestabstand in Sekunden (≥ 60 wegen W12). */
  minGapS: number;
  /** Zusätzlicher gleichverteilter Zufallsanteil in Sekunden. */
  jitterS: number;
}

export class IdleChatter {
  private readonly opts: ChatterOptions;
  private readonly rng: () => number;
  private dueMs: number;
  private last: string | null = null;

  /** `rng` liefert [0, 1); im Test deterministisch. */
  constructor(opts: ChatterOptions, rng: () => number, startMs: number) {
    this.opts = opts;
    this.rng = rng;
    this.dueMs = startMs + this.gapMs();
  }

  private gapMs(): number {
    return (this.opts.minGapS + this.rng() * this.opts.jitterS) * 1000;
  }

  private blocked(ctx: ChatterContext): boolean {
    return ctx.state !== "idle" || ctx.approvalOpen || ctx.questionOpen || ctx.bubbleActive || ctx.criticalPending;
  }

  /** Liefert eine Phrase, wenn jetzt Zeit und Kontext dafür frei sind, sonst null. */
  tick(ctx: ChatterContext, nowMs: number): string | null {
    if (this.blocked(ctx)) {
      // Nach einer Blockade nicht sofort plappern: frühestens minGap nach dem letzten blockierten Tick.
      this.dueMs = Math.max(this.dueMs, nowMs + this.opts.minGapS * 1000);
      return null;
    }
    if (nowMs < this.dueMs) return null;
    const pool = CHATTER_PHRASES.filter((p) => p !== this.last);
    const phrase = pool[Math.min(pool.length - 1, Math.floor(this.rng() * pool.length))] as string;
    this.last = phrase;
    this.dueMs = nowMs + this.gapMs();
    return phrase;
  }
}
