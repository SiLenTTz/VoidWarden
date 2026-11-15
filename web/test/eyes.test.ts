import { test } from "node:test";
import assert from "node:assert/strict";
import { eyeRgb, swapEyeMarkers, MARKER_CORE, MARKER_MID, MARKER_DIM } from "../src/eyes.ts";

test("eyeRgb: Zustandsfarben nach spec.md §5", () => {
  assert.deepEqual(eyeRgb("idle").core, [0xaf, 0x72, 0xff]);
  assert.deepEqual(eyeRgb("listening").core, [0x45, 0xe4, 0xf7]);
  assert.deepEqual(eyeRgb("executing").core, [0x45, 0xe4, 0xf7]);
  assert.deepEqual(eyeRgb("approval_pending").core, [0xff, 0x9f, 0x43]);
  assert.deepEqual(eyeRgb("success").core, [0xff, 0xe3, 0x8a]);
  assert.deepEqual(eyeRgb("error").core, [0xff, 0x52, 0x6e]);
  assert.deepEqual(eyeRgb("offline").core, [0x73, 0x71, 0x85]);
});

test("eyeRgb: mid 75 %, dim 50 %", () => {
  const e = eyeRgb("idle");
  assert.deepEqual(e.mid, [Math.round((0xaf * 3) / 4), Math.round((0x72 * 3) / 4), Math.round((0xff * 3) / 4)]);
  assert.deepEqual(e.dim, [Math.round(0xaf / 2), Math.round(0x72 / 2), Math.round(0xff / 2)]);
});

test("swapEyeMarkers: ersetzt nur Marker, zählt Pixel", () => {
  const buf = new Uint8ClampedArray(4 * 4);
  // pixel0 core, pixel1 mid, pixel2 dim, pixel3 body
  buf.set([...MARKER_CORE, 255], 0);
  buf.set([...MARKER_MID, 255], 4);
  buf.set([...MARKER_DIM, 255], 8);
  buf.set([10, 20, 30, 255], 12);
  const eyes = eyeRgb("error");
  assert.equal(swapEyeMarkers(buf, eyes), 3);
  assert.deepEqual([...buf.slice(0, 3)], [...eyes.core]);
  assert.deepEqual([...buf.slice(4, 7)], [...eyes.mid]);
  assert.deepEqual([...buf.slice(8, 11)], [...eyes.dim]);
  assert.deepEqual([...buf.slice(12, 15)], [10, 20, 30]);
});
