/**
 * Typewriter (T11.11): Blasen-Text erscheint Zeichen für Zeichen wie von einem
 * Menschen getippt — KEIN konstanter Ticker. Menschlichkeit entsteht durch:
 *  - variable Basis-Verzögerung pro Zeichen (Jitter)
 *  - Satzzeichen-Pausen (. ! ? länger als , ; :)
 *  - gelegentliche "Denkpausen" (seed-deterministisch, in Tests reproduzierbar)
 *  - blinkender Cursor am Ende (CSS-Klasse)
 * Reine Funktionen, Zeit injiziert — gleicher Stil wie bubble.ts.
 */

export interface TypewriterState {
  /** Volltext. */
  readonly text: string;
  /** Sichtbares Präfix (text.slice(0, charIdx)). */
  readonly charIdx: number;
  /** kumulierte Abfahrtszeiten je Zeichensprung: revealAtMs[i] = Zeitpunkt, an dem charIdx i erreicht wird. */
  readonly revealAtMs: readonly number[];
  /** true wenn fertig (charIdx === text.length). */
  readonly done: boolean;
}

/** Deterministischer PRNG (mulberry32) — gleicher Seed = gleiche Rhythmus-Spur. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Verzögerung nach Zeichen c (in ms), rng-gesteuert. */
function delayAfter(c: string, rng: () => number): number {
  // Buchstaben/Zeichen: 35–75 ms Basis-Jitter (Mensch ~40–80)
  const base = 35 + Math.floor(rng() * 41);
  if (c === "." || c === "!" || c === "?") return base + 180 + Math.floor(rng() * 120); // Satzende: 180–300额外
  if (c === "," || c === ";" || c === ":") return base + 90 + Math.floor(rng() * 60);
  if (c === " ") return base + 15;
  if (c === "\n") return base + 250;
  // ~7% Chance auf Denkpause mitten im Wort/after char
  if (rng() < 0.07) return base + 220 + Math.floor(rng() * 180);
  return base;
}

/** Gesamt-Tippdauer (ms) von texts — für Auto-Hide-Nachlauf (Blase bleibt nach Ende lesbar). */
export function typewriterDurationMs(text: string, seed: number): number {
  return planReveals(text, seed)[text.length] ?? 0;
}

function planReveals(text: string, seed: number): number[] {
  const rng = mulberry32(seed);
  const revealAtMs = [0]; // Index 0: Start, 0 ms
  for (let i = 0; i < text.length; i++) {
    revealAtMs.push(revealAtMs[i]! + delayAfter(text[i]!, rng));
  }
  return revealAtMs;
}

/** Neuen Typing-Lauf starten. startMs = injizierte "jetzt"-Zeit. */
export function startTypewriter(text: string, seed: number, startMs: number): TypewriterState & { startMs: number } {
  return { text, charIdx: 0, revealAtMs: planReveals(text, seed), done: text.length === 0, startMs };
}

/** Zeit-Tick: enthüllt alle fälligen Zeichen (auch mehrere pro Tick bei nachlaufendem Frame). */
export function tickTypewriter(
  state: TypewriterState & { startMs: number },
  nowMs: number,
): TypewriterState & { startMs: number } {
  if (state.done) return state;
  const elapsed = nowMs - state.startMs;
  let idx = state.charIdx;
  while (idx < state.text.length && state.revealAtMs[idx + 1]! <= elapsed) idx++;
  if (idx === state.charIdx) return state;
  return { ...state, charIdx: idx, done: idx >= state.text.length };
}
