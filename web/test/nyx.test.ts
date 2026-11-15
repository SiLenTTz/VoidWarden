// Nyx-Sprite (EPIC-P10 T10.8): Frame-Auswahl gegen den echten Atlas
// (web/public/nyx/nyx-atlas.json — Committete Kopie aus assets/nyx/) — reine
// Funktionen, injizierbare Zeit, Validierung fail loud.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  spriteState,
  frameColumnAt,
  validateAtlas,
  type NyxAtlasMeta,
} from "../src/nyx.ts";

const meta = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "public", "nyx", "nyx-atlas.json"), "utf8"),
) as NyxAtlasMeta;

test("Atlas im Web-Client ist der committete Nyx-Atlas: gültig, 7 States, 33 Frames", () => {
  assert.deepEqual(validateAtlas(meta), []);
  assert.equal(meta.states.length, 7);
  assert.equal(meta.frames.length, 33);
});

test("spriteState: WS-down → offline, Verfall → idle (schlafend), sonst Hub-State", () => {
  assert.equal(spriteState("executing", false, true), "offline");
  assert.equal(spriteState("executing", true, false), "idle");
  assert.equal(spriteState("approval_pending", false, false), "approval_pending");
  assert.equal(spriteState("error", true, false), "idle");
});

test("frameColumnAt: zyklisch nach duration_ms, Spalte aus Frame-Tabelle", () => {
  const idle = meta.states.find((s) => s.state === "idle")!;
  assert.equal(idle.frames, 7);
  assert.equal(idle.duration_ms, 130);
  // 0..129ms → index 0, 130..259 → 1 … zyklisch über 7 Frames
  assert.equal(frameColumnAt(meta, "idle", 0), 0);
  assert.equal(frameColumnAt(meta, "idle", 129), 0);
  assert.equal(frameColumnAt(meta, "idle", 130), 1);
  assert.equal(frameColumnAt(meta, "idle", 6 * 130), 6);
  assert.equal(frameColumnAt(meta, "idle", 7 * 130), 0, "Animation loopt");
  assert.equal(frameColumnAt(meta, "idle", -50), 0, "negative Zeit geklemmt");
  // Frame-Spalten sind nicht zwingend == index (Tabelle mappt) — hier idle 1:1
  const ap = meta.states.find((s) => s.state === "approval_pending")!;
  assert.equal(frameColumnAt(meta, "approval_pending", 0), 12, "approval_pending beginnt bei Spalte 12");
  assert.equal(frameColumnAt(meta, "approval_pending", ap.duration_ms * 3), 15);
});

test("frameColumnAt: unbekannter State → -1 (Aufrufer fail loud)", () => {
  assert.equal(frameColumnAt(meta, "listening", 0), 7);
  const broken = { ...meta, states: meta.states.filter((s) => s.state !== "listening") };
  assert.equal(frameColumnAt(broken, "listening", 0), -1);
  assert.ok(validateAtlas(broken).length > 0, "Atlas-Sanity schlägt an");
});
