/**
 * Fünf-Punkt-Kalibrierung des Touch (EPIC-P3 T3.8, AC-P3-8): rechnet aus Rohwerten an bekannten
 * Zielpunkten die Konstanten von `firmware/src/state/touch_map` aus. Rein; die Semantik von
 * `mapTouch` entspricht der Firmware (swap → Rohachse X läuft entlang der Höhe).
 */
export interface Calibration {
  rawXMin: number;
  rawXMax: number;
  rawYMin: number;
  rawYMax: number;
  swapXY: boolean;
  invertX: boolean;
  invertY: boolean;
}

export interface CalSample {
  target: { x: number; y: number };
  raw: { x: number; y: number };
}

export interface Screen {
  w: number;
  h: number;
}

/** Vier Ecken (knapp innen) und die Mitte; ein Finger trifft keine Randpixel. */
export const CAL_TARGETS: ReadonlyArray<{ x: number; y: number; name: string }> = [
  { x: 10, y: 10, name: "oben links" },
  { x: 309, y: 10, name: "oben rechts" },
  { x: 10, y: 229, name: "unten links" },
  { x: 309, y: 229, name: "unten rechts" },
  { x: 160, y: 120, name: "Mitte" },
];

interface Fit {
  slope: number;
  intercept: number;
  maxErr: number;
}

/** Kleinste Quadrate: ziel = slope * raw + intercept. */
function fit(raw: number[], target: number[]): Fit | null {
  const n = raw.length;
  const mr = raw.reduce((a, b) => a + b, 0) / n;
  const mt = target.reduce((a, b) => a + b, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    const dr = (raw[i] as number) - mr;
    sxx += dr * dr;
    sxy += dr * ((target[i] as number) - mt);
  }
  if (sxx < 1e-6) return null;
  const slope = sxy / sxx;
  const intercept = mt - slope * mr;
  let maxErr = 0;
  for (let i = 0; i < n; i++) {
    maxErr = Math.max(maxErr, Math.abs(slope * (raw[i] as number) + intercept - (target[i] as number)));
  }
  return { slope, intercept, maxErr };
}

function sumErr(a: Fit | null, b: Fit | null): number {
  return a === null || b === null ? Infinity : a.maxErr + b.maxErr;
}

export function solveCalibration(samples: CalSample[], screen: Screen): { cal: Calibration; maxErrorPx: number } {
  if (samples.length < 5) throw new Error("Kalibrierung braucht 5 Punkte");
  const rx = samples.map((s) => s.raw.x);
  const ry = samples.map((s) => s.raw.y);
  const tx = samples.map((s) => s.target.x);
  const ty = samples.map((s) => s.target.y);

  // Variante A: raw.x → x, raw.y → y. Variante B (swap): raw.y → x, raw.x → y. Die bessere gewinnt.
  const a = { x: fit(rx, tx), y: fit(ry, ty) };
  const b = { x: fit(ry, tx), y: fit(rx, ty) };
  const swap = sumErr(b.x, b.y) < sumErr(a.x, a.y);
  const fx = swap ? b.x : a.x;
  const fy = swap ? b.y : a.y;
  if (fx === null || fy === null) throw new Error("Achse ohne Messbereich: Rohwerte schwanken nicht");

  // Rohbereich, der 0 … max auf dem Schirm entspricht; negative Steigung = gespiegelt.
  const range = (f: Fit, max: number): { lo: number; hi: number; inv: boolean } => {
    const r0 = (0 - f.intercept) / f.slope;
    const r1 = (max - f.intercept) / f.slope;
    return { lo: Math.min(r0, r1), hi: Math.max(r0, r1), inv: f.slope < 0 };
  };
  const rngX = range(fx, screen.w - 1);
  const rngY = range(fy, screen.h - 1);

  // Zuordnung auf die Firmware-Felder: ohne swap gehört X-Fit zur Rohachse X.
  const cal: Calibration = swap
    ? { rawYMin: Math.round(rngX.lo), rawYMax: Math.round(rngX.hi), rawXMin: Math.round(rngY.lo), rawXMax: Math.round(rngY.hi), swapXY: true, invertX: rngX.inv, invertY: rngY.inv }
    : { rawXMin: Math.round(rngX.lo), rawXMax: Math.round(rngX.hi), rawYMin: Math.round(rngY.lo), rawYMax: Math.round(rngY.hi), swapXY: false, invertX: rngX.inv, invertY: rngY.inv };
  return { cal, maxErrorPx: Math.max(fx.maxErr, fy.maxErr) };
}

/** Wie `vw::mapTouch`: Rohwert → Pixel, an den Rand geklemmt. */
export function mapTouch(cal: Calibration, rawX: number, rawY: number, screen: Screen): { x: number; y: number } {
  const scale = (v: number, lo: number, hi: number, outMax: number): number => {
    const c = Math.min(Math.max(v, lo), hi);
    return Math.trunc(((c - lo) * (outMax - 1)) / (hi - lo));
  };
  let px: number;
  let py: number;
  if (cal.swapXY) {
    px = scale(rawY, cal.rawYMin, cal.rawYMax, screen.w);
    py = scale(rawX, cal.rawXMin, cal.rawXMax, screen.h);
  } else {
    px = scale(rawX, cal.rawXMin, cal.rawXMax, screen.w);
    py = scale(rawY, cal.rawYMin, cal.rawYMax, screen.h);
  }
  if (cal.invertX) px = screen.w - 1 - px;
  if (cal.invertY) py = screen.h - 1 - py;
  return { x: px, y: py };
}
