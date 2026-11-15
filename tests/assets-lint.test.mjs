// Asset-Linter (EPIC-P5 T5.5, AC-P5-5): je Regel ein rotes Fixture, dazu der reale Atlas.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { PNG } from "pngjs";
import { REQUIRED_STATES, applyExceptions, lintAtlas } from "../tools/assets/lint.mjs";

const FW = 64;
const BODY = [0x40, 0x20, 0x60];

/** Synthetischer Atlas: ein Frame je Zustand, Körper 10×20 px mittig, Augenmarker bei (30..33, 16). */
function build({ states = REQUIRED_STATES, frames = states.map((s) => ({ state: s, index: 0 })), mutate } = {}) {
  const png = new PNG({ width: FW * frames.length, height: FW });
  frames.forEach((fr, f) => {
    for (let y = 30; y < 58; y++) {
      for (let x = 27; x < 37; x++) png.data.set([...BODY, 255], (y * png.width + f * FW + x) * 4);
    }
    for (let x = 30; x < 34; x++) png.data.set([255, 0, 255, 255], (16 * png.width + f * FW + x) * 4);
  });
  const meta = { fw: FW, fh: FW, frames };
  mutate?.(png, meta);
  return { png, meta };
}
const rules = (r) => lintAtlas(r.png, r.meta).map((i) => i.rule);
const px = (png, f, x, y, rgba) => png.data.set(rgba, (y * png.width + f * FW + x) * 4);

test("sauberer Fixture-Atlas ist ohne Verstoß", () => {
  assert.deepEqual(lintAtlas(...Object.values(build())), []);
});

test("Regel size: Frame-Größe und PNG-Maße", () => {
  const r = build({ mutate: (_p, m) => (m.fw = 48) });
  assert.ok(rules(r).includes("size"));
});

test("Regel tags: fehlender und unbekannter Zustand", () => {
  assert.ok(lintAtlas(...Object.values(build({ states: REQUIRED_STATES.slice(1) }))).some((i) => i.rule === "tags" && /fehlt/.test(i.message)));
  assert.ok(lintAtlas(...Object.values(build({ states: [...REQUIRED_STATES, "dance"] }))).some((i) => i.rule === "tags" && /Unbekannter/.test(i.message)));
});

test("Regel empty: leerer Frame", () => {
  const r = build({ mutate: (p) => { for (let y = 0; y < FW; y++) for (let x = 0; x < FW; x++) px(p, 0, x, y, [0, 0, 0, 0]); } });
  assert.ok(rules(r).includes("empty"));
});

test("Regel border: opaker Pixel am Frame-Rand", () => {
  const r = build({ mutate: (p) => px(p, 2, 33, 0, [...BODY, 255]) });
  const issue = lintAtlas(r.png, r.meta).find((i) => i.rule === "border");
  assert.match(issue.message, /^approval_pending\[0\]/);
});

test("Regel palette: mehr als 12 Körperfarben", () => {
  const r = build({ mutate: (p) => { for (let k = 0; k < 13; k++) px(p, 0, 40 + (k % 8), 30 + Math.floor(k / 8), [10 + k * 7, 200, 10, 255]); } });
  assert.ok(rules(r).includes("palette"));
});

test("Regel eyes: Marker über zu viele Zeilen und abweichende Maske", () => {
  const tall = build({ mutate: (p) => { px(p, 0, 31, 30, [255, 0, 255, 255]); } });
  assert.ok(lintAtlas(tall.png, tall.meta).some((i) => i.rule === "eyes" && /Zeilen/.test(i.message)));
  const drift = build({ mutate: (p) => { for (let x = 30; x < 34; x++) { px(p, 1, x, 16, [...BODY, 255]); px(p, 1, x + 12, 16, [255, 0, 255, 255]); } } });
  assert.ok(lintAtlas(drift.png, drift.meta).some((i) => i.rule === "eyes" && /maske/i.test(i.message)));
});

test("Regel pivot: Standpunkt springt innerhalb eines Zustands", () => {
  const frames = [{ state: "idle", index: 0 }, { state: "idle", index: 1 }, ...REQUIRED_STATES.slice(1).map((s) => ({ state: s, index: 0 }))];
  const r = build({ frames, mutate: (p) => { for (let x = 27; x < 37; x++) for (let y = 52; y < 58; y++) px(p, 1, x, y, [0, 0, 0, 0]); } });
  assert.ok(rules(r).includes("pivot"));
});

test("Regel seam: Loop-Naht springt, Einmal-Zustände sind ausgenommen", () => {
  const loopFrames = [{ state: "idle", index: 0 }, { state: "idle", index: 1 }, ...REQUIRED_STATES.slice(1).map((s) => ({ state: s, index: 0 }))];
  const shift = (p) => { for (let y = 30; y < 58; y++) for (let x = 27; x < 37; x++) { px(p, 1, x, y, [0, 0, 0, 0]); } for (let y = 30; y < 58; y++) for (let x = 41; x < 51; x++) px(p, 1, x, y, [...BODY, 255]); };
  assert.ok(rules(build({ frames: loopFrames, mutate: shift })).includes("seam"));
  const oneShot = [...REQUIRED_STATES.filter((s) => s !== "success").map((s) => ({ state: s, index: 0 })), { state: "success", index: 0 }, { state: "success", index: 1 }];
  const r = build({ frames: oneShot, mutate: (p) => { const f = oneShot.length - 1; for (let y = 30; y < 58; y++) for (let x = 27; x < 37; x++) px(p, f, x, y, [0, 0, 0, 0]); for (let y = 30; y < 58; y++) for (let x = 41; x < 51; x++) px(p, f, x, y, [...BODY, 255]); } });
  assert.ok(!rules(r).includes("seam"));
});

test("Ausnahmen: begründet gilt, ohne Begründung und veraltet sind rot", () => {
  const issues = [{ rule: "border", message: "success[1]: x" }, { rule: "palette", message: "13" }];
  const r = applyExceptions(issues, [{ rule: "border", prefix: "success[1]", reason: "Halo" }, { rule: "eyes", prefix: "idle", reason: "alt" }]);
  assert.equal(r.waived.length, 1);
  assert.deepEqual(r.violations.map((v) => v.rule), ["palette"]);
  assert.equal(r.stale.length, 1);
  assert.equal(applyExceptions([issues[0]], [{ rule: "border", prefix: "success[1]", reason: "" }]).violations.length, 1);
});

test("realer Atlas besteht check:assets (mit der dokumentierten Ausnahme)", () => {
  const res = spawnSync(process.execPath, ["tools/assets/check-assets.mjs"], { encoding: "utf8" });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /33 Frames/);
  assert.ok(JSON.parse(readFileSync("assets/nyx/lint-exceptions.json", "utf8")).every((e) => e.reason.length > 10));
});
