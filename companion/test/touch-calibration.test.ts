// T3.8: Fünf-Punkt-Kalibrierung. Der Solver rekonstruiert aus Rohwerten an bekannten Zielpunkten
// die Konstanten von firmware/src/state/touch_map (gleiche Semantik wie mapTouch).
import { test } from "node:test";
import assert from "node:assert/strict";
import { solveCalibration, mapTouch, CAL_TARGETS, type Calibration } from "../src/touch-calibration.ts";

const SCREEN = { w: 320, h: 240 };

/** Erzeugt Rohwerte, die mapTouch(cal) auf (x, y) abbilden würde (Umkehrfunktion). */
function rawFor(cal: Calibration, x: number, y: number): { x: number; y: number } {
  const px = cal.invertX ? SCREEN.w - 1 - x : x;
  const py = cal.invertY ? SCREEN.h - 1 - y : y;
  const sx = px / (SCREEN.w - 1);
  const sy = py / (SCREEN.h - 1);
  if (cal.swapXY) {
    return {
      y: cal.rawYMin + sx * (cal.rawYMax - cal.rawYMin),
      x: cal.rawXMin + sy * (cal.rawXMax - cal.rawXMin),
    };
  }
  return {
    x: cal.rawXMin + sx * (cal.rawXMax - cal.rawXMin),
    y: cal.rawYMin + sy * (cal.rawYMax - cal.rawYMin),
  };
}

function samplesFor(cal: Calibration) {
  return CAL_TARGETS.map((t) => ({ target: t, raw: rawFor(cal, t.x, t.y) }));
}

test("rekonstruiert die Board-Kalibrierung (swap, x und y gespiegelt)", () => {
  const truth: Calibration = { rawXMin: 500, rawXMax: 3600, rawYMin: 400, rawYMax: 3700, swapXY: true, invertX: true, invertY: true };
  const res = solveCalibration(samplesFor(truth), SCREEN);
  assert.equal(res.cal.swapXY, true);
  assert.equal(res.cal.invertX, true);
  assert.equal(res.cal.invertY, true);
  assert.ok(res.maxErrorPx < 1.5, `Rest-Fehler ${res.maxErrorPx}`);
  assert.ok(Math.abs(res.cal.rawYMin - 400) < 80 && Math.abs(res.cal.rawYMax - 3700) < 80);
});

test("erkennt Achsen ohne swap und ohne Spiegelung", () => {
  const truth: Calibration = { rawXMin: 300, rawXMax: 3800, rawYMin: 350, rawYMax: 3750, swapXY: false, invertX: false, invertY: false };
  const res = solveCalibration(samplesFor(truth), SCREEN);
  assert.equal(res.cal.swapXY, false);
  assert.equal(res.cal.invertX, false);
  assert.equal(res.cal.invertY, false);
  assert.ok(res.maxErrorPx < 1.5);
});

test("Ergebnis bildet die Zielpunkte mit mapTouch zurück auf die Ziele ab", () => {
  const truth: Calibration = { rawXMin: 500, rawXMax: 3600, rawYMin: 400, rawYMax: 3700, swapXY: true, invertX: false, invertY: true };
  const samples = samplesFor(truth);
  const res = solveCalibration(samples, SCREEN);
  for (const s of samples) {
    const p = mapTouch(res.cal, s.raw.x, s.raw.y, SCREEN);
    assert.ok(Math.abs(p.x - s.target.x) <= 2 && Math.abs(p.y - s.target.y) <= 2, `${JSON.stringify(s.target)} → ${JSON.stringify(p)}`);
  }
});

test("zu wenige oder entartete Punkte werden abgelehnt (fail loud)", () => {
  assert.throws(() => solveCalibration([], SCREEN), /5 Punkte/);
  const same = CAL_TARGETS.map((t) => ({ target: t, raw: { x: 2000, y: 2000 } }));
  assert.throws(() => solveCalibration(same, SCREEN), /Achse/);
});

test("ein verwackelter Punkt zeigt sich als großer Rest-Fehler", () => {
  const truth: Calibration = { rawXMin: 500, rawXMax: 3600, rawYMin: 400, rawYMax: 3700, swapXY: true, invertX: true, invertY: true };
  const samples = samplesFor(truth);
  (samples[4] as { raw: { x: number; y: number } }).raw = { x: 500, y: 3700 };
  const res = solveCalibration(samples, SCREEN);
  assert.ok(res.maxErrorPx > 10);
});
