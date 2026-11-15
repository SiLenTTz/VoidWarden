/**
 * EPIC-P11 T11.7: Pixelfont-Renderer — zeichnet Text mit den 1:1-Glyphen aus
 * firmware/src/render/font5x7.h (via pixelfont-data.g.ts, generiert). Kein
 * system-ui mehr für Kachelnamen, Blase und Status: das Web sieht exakt aus
 * wie das Board. Fallback-Kanon wie bubbleGlyph() in der Firmware:
 * Kleinbuchstaben → Großbuchstaben-Glyph, unbekannte Zeichen → Leerzeichen.
 */
import { FONT5X7, FONT_W, FONT_H, FONT_ADVANCE } from "./pixelfont-data.g.ts";

const byCp = new Map<string, number[]>(FONT5X7.map((g) => [g.cp, g.cols]));

/** Glyphe für ein Zeichen im Board-Kanon (a-z → A-Z, sonst Leerzeichen). */
export function glyphFor(ch: string): number[] | null {
  const g = byCp.get(ch);
  if (g !== undefined) return g;
  const up = ch.toUpperCase();
  if (up !== ch) {
    const cols = byCp.get(up);
    if (cols !== undefined) return cols;
  }
  return byCp.get(" ") ?? null;
}

/** Breite eines Textes in Font-Pixeln (Advance 6, wie kFontAdvance). */
export function pixelTextWidth(text: string): number {
  return text.length * FONT_ADVANCE;
}

export interface PixelTextOptions {
  /** Skalierung: 1 = 5x7-Pixel 1:1. Board-Blase nutzt Scale 2 für Kurzes. */
  scale?: number;
  color?: string;
  /** Text in Großbuchstaben umwandeln? Default true (Board-Kanon, nur Groß-Glyphen). */
  uppercase?: boolean;
}

/**
 * Zeichnet Text als Pixelfont in einen 2D-Context. Bit y = Zeile y (LSB oben),
 * Spaltenbyte x = Spalte x — identisch zur Firmware-Kodierung.
 */
export function drawPixelText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  opts: PixelTextOptions = {},
): void {
  const scale = opts.scale ?? 2;
  const color = opts.color ?? "#c5c5d5";
  const s = opts.uppercase === false ? text : text.toUpperCase();
  ctx.fillStyle = color;
  let cx = x;
  for (const ch of s) {
    const cols = glyphFor(ch);
    if (cols !== null) {
      for (let colX = 0; colX < FONT_W; ++colX) {
        const bits = cols[colX];
        for (let rowY = 0; rowY < FONT_H; ++rowY) {
          if ((bits & (1 << rowY)) !== 0) {
            ctx.fillRect(cx + colX * scale, y + rowY * scale, scale, scale);
          }
        }
      }
    }
    cx += FONT_ADVANCE * scale;
  }
}
