// EPIC-P11 T11.11: Typewriter — menschlicher Tipp-Rhythmus (node:test-Stil wie web/test/*).
import { test } from "node:test";
import assert from "node:assert/strict";
import { startTypewriter, tickTypewriter, typewriterDurationMs } from "../src/typewriter.ts";

const TEXT = "Nyx wacht. Drei Sessions laufen, eine wartet auf dich.";

test("enthüllt Zeichen progressiv, niemals alle sofort", () => {
  let st = startTypewriter(TEXT, 42, 0);
  assert.equal(st.charIdx, 0);
  st = tickTypewriter(st, 50);
  assert.ok(st.charIdx < 6, `charIdx ${st.charIdx} sollte klein sein`);
  assert.equal(st.done, false);
  assert.ok(TEXT.startsWith(st.text.slice(0, st.charIdx)));
});

test("ist nach der geplanten Gesamtdauer fertig", () => {
  const dur = typewriterDurationMs(TEXT, 42);
  let st = startTypewriter(TEXT, 42, 0);
  st = tickTypewriter(st, dur);
  assert.equal(st.done, true);
  assert.equal(st.charIdx, TEXT.length);
});

test("dauert länger als konstantes 30ms/Zeichen (Mensch-Rhythmus, kein Ticker)", () => {
  const dur = typewriterDurationMs(TEXT, 7);
  assert.ok(dur > TEXT.length * 30, `dur=${dur}`);
});

test("gleicher Seed = gleiche Rhythmus-Spur (deterministisch)", () => {
  const a = startTypewriter(TEXT, 7, 0);
  const b = startTypewriter(TEXT, 7, 1000);
  assert.deepEqual([...a.revealAtMs], [...b.revealAtMs]);
});

test("Satzende-Pause: '.' erzeugt deutlich längeren Sprung als Buchstabe", () => {
  const st = startTypewriter("A.B", 1, 0);
  const afterA = st.revealAtMs[1]!;
  const afterDot = st.revealAtMs[2]!;
  assert.ok(afterDot - afterA > 150, `gap=${afterDot - afterA}`);
});

test("nachlaufender Tick holt mehrere Zeichen auf einmal nach", () => {
  let st = startTypewriter(TEXT, 42, 0);
  st = tickTypewriter(st, 999_999);
  assert.equal(st.done, true);
});
