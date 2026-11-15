// EPIC-P8 T8.12 (vorgezogen, ADR-0009): Idle-Chatter — Abstand, Jitter, nie verdeckend, deterministisch.
// Zufall (rng) und Uhr (nowMs) sind injiziert; kein Test hängt von echter Zeit ab (docs/testing.md §2).
import { test } from "node:test";
import assert from "node:assert/strict";
import { IdleChatter, CHATTER_PHRASES, type ChatterContext } from "../src/chatter.ts";

const OPEN: ChatterContext = { state: "idle", approvalOpen: false, questionOpen: false, bubbleActive: false, criticalPending: false };
const OPTS = { minGapS: 90, jitterS: 60 };

const lcg = (seed: number) => () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x80000000;
};

test("nichts vor minGap; mit rng=0 genau bei minGap, mit rng≈1 erst nach minGap+jitter", () => {
  const early = new IdleChatter(OPTS, () => 0, 0);
  assert.equal(early.tick(OPEN, 89_999), null);
  assert.notEqual(early.tick(OPEN, 90_000), null);

  const late = new IdleChatter(OPTS, () => 0.999, 0);
  assert.equal(late.tick(OPEN, 149_000), null);
  assert.notEqual(late.tick(OPEN, 150_000), null);
});

test("nie verdeckend: jeder blockierende Kontext unterdrückt den Chatter, auch lange danach fällig", () => {
  const blocked: Array<[string, ChatterContext]> = [
    ["approval_pending", { ...OPEN, state: "approval_pending" }],
    ["Freigabe offen", { ...OPEN, approvalOpen: true }],
    ["Frage offen", { ...OPEN, questionOpen: true }],
    ["Blase aktiv", { ...OPEN, bubbleActive: true }],
    ["kritische Blase wartet", { ...OPEN, criticalPending: true }],
    ["listening", { ...OPEN, state: "listening" }],
    ["error", { ...OPEN, state: "error" }],
    ["executing", { ...OPEN, state: "executing" }],
    ["success", { ...OPEN, state: "success" }],
    ["offline", { ...OPEN, state: "offline" }],
  ];
  for (const [name, ctx] of blocked) {
    const c = new IdleChatter(OPTS, () => 0, 0);
    assert.equal(c.tick(ctx, 1_000_000), null, name);
  }
});

test("nach Ende einer Blockade wartet Nyx mindestens minGap, statt sofort loszuplappern", () => {
  const c = new IdleChatter(OPTS, () => 0, 0);
  assert.equal(c.tick({ ...OPEN, approvalOpen: true }, 500_000), null);
  assert.equal(c.tick(OPEN, 500_000 + 89_999), null);
  assert.notEqual(c.tick(OPEN, 500_000 + 90_000), null);
});

test("Abstand: zwischen zwei Äußerungen mindestens minGap (≥ 60 s, W12), über viele Ticks", () => {
  const c = new IdleChatter(OPTS, lcg(7), 0);
  const spoken: number[] = [];
  for (let t = 0; t <= 6 * 3600 * 1000; t += 1000) {
    if (c.tick(OPEN, t) !== null) spoken.push(t);
  }
  assert.ok(spoken.length > 20, `zu wenige Äußerungen: ${spoken.length}`);
  for (let i = 1; i < spoken.length; i++) {
    const gap = (spoken[i] as number) - (spoken[i - 1] as number);
    assert.ok(gap >= OPTS.minGapS * 1000, `Abstand ${gap} ms`);
    assert.ok(gap <= (OPTS.minGapS + OPTS.jitterS) * 1000 + 1000, `Abstand ${gap} ms zu groß`);
  }
});

test("Jitter wirkt: unterschiedliche Abstände, nicht immer minGap", () => {
  const c = new IdleChatter(OPTS, lcg(99), 0);
  const gaps = new Set<number>();
  let last = -1;
  for (let t = 0; t <= 3 * 3600 * 1000; t += 1000) {
    if (c.tick(OPEN, t) !== null) {
      if (last >= 0) gaps.add(t - last);
      last = t;
    }
  }
  assert.ok(gaps.size > 5, `nur ${gaps.size} verschiedene Abstände`);
});

test("dieselbe Phrase nie zweimal hintereinander", () => {
  const c = new IdleChatter({ minGapS: 1, jitterS: 0 }, lcg(3), 0);
  let prev: string | null = null;
  let n = 0;
  for (let t = 0; t <= 2000 * 1000; t += 1000) {
    const p = c.tick(OPEN, t);
    if (p === null) continue;
    assert.notEqual(p, prev);
    prev = p;
    n++;
  }
  assert.ok(n > 100);
});

test("Property: mit zufällig wechselnden Kontexten spricht Nyx nur bei freiem Kontext", () => {
  const rnd = lcg(2024);
  const c = new IdleChatter(OPTS, lcg(5), 0);
  for (let t = 0; t <= 4 * 3600 * 1000; t += 1000) {
    const ctx: ChatterContext = {
      state: rnd() < 0.7 ? "idle" : "approval_pending",
      approvalOpen: rnd() < 0.1,
      questionOpen: rnd() < 0.1,
      bubbleActive: rnd() < 0.1,
      criticalPending: rnd() < 0.05,
    };
    const free = ctx.state === "idle" && !ctx.approvalOpen && !ctx.questionOpen && !ctx.bubbleActive && !ctx.criticalPending;
    const said = c.tick(ctx, t);
    if (!free) assert.equal(said, null, `bei t=${t} trotz Blockade gesprochen`);
  }
});

test("Phrasen: lokal, kurz, ohne Steuerzeichen und ohne Statusbehauptung (W10, PRD §8.5)", () => {
  assert.ok(CHATTER_PHRASES.length >= 8);
  assert.equal(new Set(CHATTER_PHRASES).size, CHATTER_PHRASES.length, "Duplikate");
  for (const p of CHATTER_PHRASES) {
    assert.ok([...p].length <= 80, `zu lang: ${p}`);
    // eslint-disable-next-line no-control-regex -- prüft gerade die Abwesenheit von Steuerzeichen
    assert.ok(!/[\u0000-\u001f\u007f]/.test(p), p);
    assert.ok(!/(fehler|läuft|fertig|grün|\bok\b|arbeit|agent|session|freigabe|build|test)/i.test(p), `Statusbehauptung: ${p}`);
  }
});
