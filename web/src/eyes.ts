/**
 * Augenfarben je Nyx-Zustand (spec.md §5, Firmware Renderer::eyeColors).
 * Atlas-Marker #FF00FF/#C000C0/#800080 werden beim Blit ersetzt — ohne diesen
 * Tausch bleiben die Augen am Web-Kiosk immer magenta (BUG-0016).
 */
import type { NyxState } from "./types.ts";

export type Rgb = readonly [number, number, number];

export interface EyeRgb {
  core: Rgb;
  mid: Rgb;
  dim: Rgb;
}

/** Marker-Indizes 1–3 der Atlas-Palette (exakte RGB888). */
export const MARKER_CORE: Rgb = [255, 0, 255];
export const MARKER_MID: Rgb = [192, 0, 192];
export const MARKER_DIM: Rgb = [128, 0, 128];

function rgb(hex: number): Rgb {
  return [(hex >> 16) & 0xff, (hex >> 8) & 0xff, hex & 0xff];
}

function shade(base: Rgb, num: number, den: number): Rgb {
  return [Math.round((base[0] * num) / den), Math.round((base[1] * num) / den), Math.round((base[2] * num) / den)];
}

/** Kernfarbe → mid 75 %, dim 50 % (wie Firmware). */
export function eyeRgb(state: NyxState): EyeRgb {
  let coreHex: number;
  switch (state) {
    case "listening":
    case "executing":
      coreHex = 0x45e4f7;
      break;
    case "approval_pending":
      coreHex = 0xff9f43;
      break;
    case "success":
      coreHex = 0xffe38a;
      break;
    case "error":
      coreHex = 0xff526e;
      break;
    case "offline":
      coreHex = 0x737185;
      break;
    default:
      coreHex = 0xaf72ff;
  }
  const core = rgb(coreHex);
  return { core, mid: shade(core, 3, 4), dim: shade(core, 1, 2) };
}

function same(a: Rgb, r: number, g: number, b: number): boolean {
  return a[0] === r && a[1] === g && a[2] === b;
}

/** Ersetzt Marker-Pixel in ImageData (RGBA) durch die Zustands-Augenfarben. */
export function swapEyeMarkers(data: Uint8ClampedArray, eyes: EyeRgb): number {
  let n = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]!, g = data[i + 1]!, b = data[i + 2]!;
    let dest: Rgb | null = null;
    if (same(MARKER_CORE, r, g, b)) dest = eyes.core;
    else if (same(MARKER_MID, r, g, b)) dest = eyes.mid;
    else if (same(MARKER_DIM, r, g, b)) dest = eyes.dim;
    if (dest === null) continue;
    data[i] = dest[0];
    data[i + 1] = dest[1];
    data[i + 2] = dest[2];
    n += 1;
  }
  return n;
}
