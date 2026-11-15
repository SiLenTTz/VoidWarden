// Bewertung des HIL-Laufs (EPIC-P2 T2.8): Frames werden ohne Board und ohne Uhr geprüft.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  HELLO_DEADLINE_MS,
  MIN_HEAP_MIN,
  STATES,
  assessStats,
  findHello,
  lastStatsAfter,
  parseStream,
  screenMatches,
} from "../scripts/hil/assess.mjs";

const hello = (at, screen = { w: 320, h: 240 }) => ({ at, frame: { v: 1, type: "hello", fw: "0.2.0", proto: 1, screen, reset_reason: "POWERON_RESET", heap_free: 300000 } });
const stats = (at, over = {}) => ({ at, frame: { v: 1, type: "stats", fps: 50, heap_free: 240000, heap_min: 222000, uptime_s: 30, rx_overrun: 0, parse_err: 0, ...over } });

test("findHello: hello innerhalb der Frist findet Latenz und Frame", () => {
  const r = findHello([hello(1250)], 1000);
  assert.equal(r.found, true);
  assert.equal(r.latencyMs, 250);
  assert.equal(r.frame.screen.w, 320);
});

test("findHello: hello genau an der Grenze gilt, dahinter nicht (AC-P2-4: ≤ 3 s)", () => {
  assert.equal(findHello([hello(1000 + HELLO_DEADLINE_MS)], 1000).found, true);
  assert.equal(findHello([hello(1000 + HELLO_DEADLINE_MS + 1)], 1000).found, false);
});

test("findHello: hello vor dem Reset zählt nicht (altes Boot-Frame)", () => {
  assert.equal(findHello([hello(900)], 1000).found, false);
});

test("screenMatches: nur 320×240 ist korrekt (BUG-0001)", () => {
  assert.equal(screenMatches({ screen: { w: 320, h: 240 } }), true);
  assert.equal(screenMatches({ screen: { w: 480, h: 320 } }), false, "altes Profil");
  assert.equal(screenMatches({}), false);
});

test("assessStats: gesunde Werte sind alle grün", () => {
  const checks = assessStats(stats(0).frame);
  assert.ok(checks.every((c) => c.ok), JSON.stringify(checks));
});

test("assessStats: parse_err, rx_overrun und heap_min werden einzeln rot", () => {
  const result = (over) => Object.fromEntries(assessStats({ ...stats(0).frame, ...over }).map((c) => [c.name, c.ok]));
  const HEAP = `stats: heap_min ≥ ${MIN_HEAP_MIN} B`;
  assert.equal(result({ parse_err: 1 })["stats: parse_err = 0"], false);
  assert.equal(result({ rx_overrun: 2 })["stats: rx_overrun = 0"], false);
  assert.equal(result({ heap_min: MIN_HEAP_MIN - 1 })[HEAP], false);
  assert.equal(result({ heap_min: MIN_HEAP_MIN })[HEAP], true, "Grenze ist inklusiv");
});

test("lastStatsAfter: nimmt das letzte stats-Frame nach dem Startzeitpunkt", () => {
  const ev = [stats(100, { uptime_s: 1 }), stats(500, { uptime_s: 2 }), stats(900, { uptime_s: 3 })];
  assert.equal(lastStatsAfter(ev, 400).uptime_s, 3);
  assert.equal(lastStatsAfter(ev, 1000), null);
});

test("parseStream: Frames über Chunk-Grenzen hinweg, ROM-Präfix und Müll werden gezählt", () => {
  const h = JSON.stringify({ v: 1, type: "hello", fw: "0.2.0", proto: 1, screen: { w: 320, h: 240 }, reset_reason: "POWERON_RESET", heap_free: 1 });
  const s = JSON.stringify({ v: 1, type: "stats", fps: 1, heap_free: 1, heap_min: 1, uptime_s: 1, rx_overrun: 0, parse_err: 0 });
  const chunks = [
    { at: 1, text: "\x1b[0m\u0000" + h.slice(0, 20) },
    { at: 2, text: h.slice(20) + "\r\n" + s.slice(0, 5) },
    { at: 3, text: s.slice(5) + "\n{not json\n" },
  ];
  const r = parseStream(chunks);
  assert.deepEqual(r.frames.map((f) => f.frame.type), ["hello", "stats"]);
  assert.equal(r.frames[0].at, 2, "Frame bekommt den Zeitpunkt des Chunks, in dem seine Zeile endet");
  assert.equal(r.romPrefix, 1, "ROM-Bytes vor dem ersten { werden gezählt");
  assert.equal(r.junk, 1, "kaputtes JSON wird gezählt, nicht verworfen");
});

test("STATES: genau die sieben Zustände aus spec.md §5", () => {
  assert.deepEqual(STATES, ["idle", "listening", "approval_pending", "executing", "success", "error", "offline"]);
});

import { summarizeSoak } from "../scripts/hil/assess.mjs";

const st = (at, fps, heap_min, uptime_s, extra = {}) => ({
  at,
  frame: { type: "stats", fps, heap_free: heap_min + 1000, heap_min, uptime_s, rx_overrun: 0, parse_err: 0, ...extra },
});

test("summarizeSoak: sauberer Lauf besteht alle Prüfungen", () => {
  const r = summarizeSoak([st(0, 31, 140000, 30), st(1, 29, 139000, 60), st(2, 33, 139500, 90)], 3);
  assert.equal(r.checks.every((c) => c.ok), true);
  assert.equal(r.fpsMin, 29);
  assert.equal(r.fpsMedian, 31);
  assert.equal(r.heapMin, 139000);
});

test("summarizeSoak: fps unter 25, Warnungen, Neustart und leerer Lauf werden rot", () => {
  const bad = summarizeSoak([
    st(0, 24, 140000, 30),
    { at: 1, frame: { type: "log", level: "warn", msg: "frame_ueber_80ms" } },
    { at: 2, frame: { type: "log", level: "warn", msg: "fps_unter_25" } },
    st(3, 30, 15000, 10),
  ]);
  const failed = bad.checks.filter((c) => !c.ok).map((c) => c.name);
  assert.ok(failed.some((n) => n.startsWith("W3: fps min")));
  assert.ok(failed.some((n) => n.includes("Frame > 80 ms")));
  assert.ok(failed.some((n) => n.includes("fps < 25")));
  assert.ok(failed.some((n) => n.startsWith("AC-P2-5")));
  assert.ok(failed.some((n) => n.startsWith("kein Neustart")));
  const empty = summarizeSoak([]);
  assert.equal(empty.checks.some((c) => !c.ok), true);
  assert.equal(empty.fpsMin, null);
});
