import { test } from "node:test";
import assert from "node:assert/strict";
import { checkStats } from "../src/stats-check.ts";

test("fps 0 (kein Messfenster, ruhiges Bild) ist keine Warnung", () => {
  assert.deepEqual(checkStats({ rx_overrun: 0, heap_free: 200000, fps: 0 }), []);
});

test("echte fps-Unterschreitung, Heap-Mangel und Overrun werden gemeldet", () => {
  const w = checkStats({ rx_overrun: 2, heap_free: 10000, fps: 12 });
  assert.deepEqual(w.map((x) => x.msg), ["firmware:rx_overrun", "firmware:heap_low", "firmware:fps_low"]);
  assert.equal(w[0]?.level, "error");
});

test("fps genau 25 und gesunde Werte: still", () => {
  assert.deepEqual(checkStats({ rx_overrun: 0, heap_free: 20000, fps: 25 }), []);
});
