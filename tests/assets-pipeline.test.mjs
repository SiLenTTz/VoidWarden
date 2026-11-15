// Asset-Pipeline (EPIC-P2 T2.4, NYX2 nach ADR-0006): Determinismus (byte-gleich),
// Körperfarben-Grenze, reservierte Marker-Indizes, Alpha, Augenband.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PNG } from "pngjs";

const pipeline = (extra = []) =>
  spawnSync(process.execPath, ["tools/assets/pipeline.mjs", ...extra], { encoding: "utf8" });

test("Determinismus: zwei Läufe erzeugen byte-identische nyx.spr", () => {
  const first = pipeline();
  assert.equal(first.status, 0, first.stderr);
  const sha1 = JSON.parse(readFileSync("firmware/data/nyx.spr.json", "utf8")).sha256;
  const second = pipeline();
  assert.equal(second.status, 0, second.stderr);
  const sha2 = JSON.parse(readFileSync("firmware/data/nyx.spr.json", "utf8")).sha256;
  assert.equal(sha1, sha2, "gleiche Quelle muss byte-gleiches Image ergeben");
  assert.ok(sha1.length === 64);
});

// Baut ein Mini-Atlas-PNG (ein Frame) aus [r,g,b,a]-Pixeln und führt die Pipeline darauf aus.
function runOn(pixels) {
  const dir = mkdtempSync(join(tmpdir(), "vw-assets-"));
  const png = new PNG({ width: pixels.length, height: 1 });
  pixels.forEach((p, i) => png.data.set(p, i * 4));
  writeFileSync(join(dir, "a.png"), PNG.sync.write(png));
  writeFileSync(
    join(dir, "meta.json"),
    JSON.stringify({ fw: pixels.length, fh: 1, frames: [{ state: "idle", index: 0, frame: 0 }] }),
  );
  const res = pipeline(["--png", join(dir, "a.png"), "--meta", join(dir, "meta.json"), "--out", join(dir, "x.spr")]);
  // Aufräumen übernimmt der Aufrufer nach dem Lesen der Ausgabe
  return { res, out: join(dir, "x.spr"), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("Körperfarben > 12 brechen den Build ab (ADR-0006)", () => {
  const px = Array.from({ length: 14 }, (_, x) => [x * 18, 255 - x * 18, x * 5, 255]);
  const { res, cleanup } = runOn(px);
  try {
    assert.notEqual(res.status, 0, "13 Körperfarben müssen abgebrochen werden");
    assert.match(res.stderr, /12 Körperfarben/);
  } finally {
    cleanup();
  }
});

test("Marker zählen nicht zu den 12 Körperfarben, Indizes 1–3 sind reserviert", () => {
  const body = Array.from({ length: 12 }, (_, x) => [10 + x * 10, 20, 30, 255]);
  const px = [...body, [255, 0, 255, 255], [192, 0, 192, 255], [128, 0, 128, 255], [0, 0, 0, 0]];
  const { res, out, cleanup } = runOn(px);
  try {
    assert.equal(res.status, 0, res.stderr);
    const blob = readFileSync(out);
    assert.equal(blob.toString("ascii", 0, 4), "NYX2");
    assert.equal(blob[11], 16, "Palette: 0 transparent + 3 Marker + 12 Körper");
    const pixelOff = 12 + 16 * 3 + 18;
    // 16 Pixel, 4 Bit: Körper 4..15, dann Marker 1,2,3, dann transparent 0
    assert.deepEqual([...blob.subarray(pixelOff)], [0x45, 0x67, 0x89, 0xab, 0xcd, 0xef, 0x12, 0x30]);
  } finally {
    cleanup();
  }
});

test("Teiltransparenz bricht den Build ab", () => {
  const { res, cleanup } = runOn([[10, 10, 10, 255], [10, 10, 10, 128]]);
  try {
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /Teiltransparenz/);
  } finally {
    cleanup();
  }
});

test("Zustandsname > 16 Zeichen bricht den Build ab", () => {
  const dir = mkdtempSync(join(tmpdir(), "vw-assets-"));
  try {
    const png = new PNG({ width: 2, height: 1 });
    png.data.set([10, 10, 10, 255, 20, 20, 20, 255]);
    writeFileSync(join(dir, "a.png"), PNG.sync.write(png));
    writeFileSync(
      join(dir, "meta.json"),
      JSON.stringify({ fw: 2, fh: 1, frames: [{ state: "x".repeat(17), index: 0, frame: 0 }] }),
    );
    const res = pipeline(["--png", join(dir, "a.png"), "--meta", join(dir, "meta.json"), "--out", join(dir, "x.spr")]);
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /länger als 16/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Augenmarker außerhalb des Augenbands brechen den Build ab", () => {
  // 1 Pixel breit, 12 Zeilen hoch: Marker in Zeile 0 und 11
  const dir = mkdtempSync(join(tmpdir(), "vw-assets-"));
  try {
    const png = new PNG({ width: 1, height: 12 });
    for (let y = 0; y < 12; y++) png.data.set(y === 0 || y === 11 ? [255, 0, 255, 255] : [9, 9, 9, 255], y * 4);
    writeFileSync(join(dir, "a.png"), PNG.sync.write(png));
    writeFileSync(join(dir, "meta.json"), JSON.stringify({ fw: 1, fh: 12, frames: [{ state: "idle", index: 0, frame: 0 }] }));
    const res = pipeline(["--png", join(dir, "a.png"), "--meta", join(dir, "meta.json"), "--out", join(dir, "x.spr")]);
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /Marker außerhalb der Augen/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Manifest nennt Frames, Palette und Zustände", () => {
  const m = JSON.parse(readFileSync("firmware/data/nyx.spr.json", "utf8"));
  assert.equal(m.format, "NYX2");
  assert.deepEqual(m.frame, { w: 64, h: 64 });
  assert.equal(m.frames, 33);
  assert.ok(m.bodyColors <= 12);
  assert.equal(m.palette, 4 + m.bodyColors);
  assert.deepEqual(m.states, [
    "idle",
    "listening",
    "approval_pending",
    "executing",
    "success",
    "error",
    "offline",
  ]);
});
