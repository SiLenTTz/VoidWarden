#!/usr/bin/env node
/**
 * EPIC-P11 T11.7: extrahiert die 5x7-Glyphen aus firmware/src/render/font5x7.h
 * (der vom Font-Generator erzeugten Wahrheit) nach web/src/pixelfont-data.g.ts
 * UND baut daraus einen TTF-Webfont (Pixel-Glyphen 1:1, Advance 6 wie
 * kFontAdvance; a-z auf Groß-Glyphen gemappt wie bubbleGlyph() in der Firmware).
 * Damit rendert das Web exakt wie das Board — kein Hand-Abtippen, deterministisch.
 * Aufruf: node tools/assets/extract-web-pixelfont.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const header = readFileSync(join(root, "firmware/src/render/font5x7.h"), "utf8");
const glyphRe = /\{\{(\d+(?:, \d+)*)\}, (\d+), \{(\d+(?:, \d+)*)\}\}\s*,\s*\/\/ '(.)'/g;

const glyphs = [];
let m;
while ((m = glyphRe.exec(header)) !== null) {
  // cp aus dem Kommentar-Char (m[4]) — die Tupel-Bytes sind UTF-8-kodiert,
  // fromCodePoint(bytes...) würde sie als separate Codepoints fehl-dekodieren.
  glyphs.push({ ch: m[4], cp: m[4], cols: m[3].split(", ").map(Number) });
}
if (glyphs.length < 50) throw new Error(`extraction suspect: only ${glyphs.length} glyphs`);

// --- 1) TS-Datenmodul (Canvas-Renderer + Tests) -------------------------------
const body = glyphs
  .map((g) => `  { cp: ${JSON.stringify(g.cp)}, cols: [${g.cols.join(", ")}] }, // ${JSON.stringify(g.ch)}`)
  .join("\n");
const tsOut = `// Generiert von tools/assets/extract-web-pixelfont.mjs aus firmware/src/render/font5x7.h — nicht von Hand editieren.
// EPIC-P11 T11.7: 1:1-Pixelfont des Boards für den Web-Client. Kodierung wie Firmware:
// 5 Spaltenbytes je Glyphe, Bit y = Zeile y (LSB = Zeile 0 oben), kFontAdvance = 6.
export const FONT_W = 5;
export const FONT_H = 7;
export const FONT_ADVANCE = 6;

export interface PixGlyph {
  cp: string;
  cols: number[];
}

export const FONT5X7: readonly PixGlyph[] = [
${body}
];
`;
const tsTarget = join(root, "web/src/pixelfont-data.g.ts");
writeFileSync(tsTarget, tsOut);
console.log(`wrote ${tsTarget} with ${glyphs.length} glyphs`);

// --- 2) TTF-Webfont aus den Glyphen -------------------------------------------
const UNITS = 1024; // unitsPerEm
const PX = 128;     // 1 Font-Pixel = 128 Units → Glyph 640x896, Advance 768
const ADVANCE = 6 * PX;
const ASCENT = 7 * PX;
const DESCENT = -PX;
const BASELINE = 7 * PX; // y=0 (Baseline) = Unterseite von Pixelzeile 6

const byCp = new Map(glyphs.map((g) => [g.cp, g.cols]));
const charSet = new Map();
for (const g of glyphs) charSet.set(g.cp, g.cols);
for (let c = 97; c <= 122; ++c) {
  // Kleinbuchstaben wie bubbleGlyph() (firmware/src/state/bubble_view.cpp) auf Groß-Glyph
  const lo = String.fromCodePoint(c);
  const up = String.fromCodePoint(c - 32);
  const cols = byCp.get(up);
  if (cols !== undefined && !charSet.has(lo)) charSet.set(lo, cols);
}

/** Glyphe → Quadrat-Kontur je gesetztem Pixel (LSB = Zeile 0 oben, wie Firmware). */
function glyphContours(cols) {
  const contours = [];
  for (let colX = 0; colX < 5; ++colX) {
    const bits = cols[colX];
    for (let rowY = 0; rowY < 7; ++rowY) {
      if (((bits >> rowY) & 1) === 0) continue; // Klammern! & bindet schwächer als ===
      const x0 = colX * PX;
      const y0 = BASELINE - (rowY + 1) * PX; // Font-y wächst nach oben
      contours.push([x0, y0, x0 + PX, y0, x0 + PX, y0 + PX, x0, y0 + PX]);
    }
  }
  return contours;
}

const u16 = (v) => { const b = Buffer.alloc(2); b.writeUInt16BE(v >>> 0); return b; };
const i16 = (v) => { const b = Buffer.alloc(2); b.writeInt16BE(v); return b; };
const u32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32BE(v >>> 0); return b; };

const chars = [...charSet.keys()].sort((a, b) => a.codePointAt(0) - b.codePointAt(0));
const numGlyphs = chars.length + 1; // Glyph 0 = .notdef

// glyf + loca (short)
const locas = [0];
const glyfParts = [];
/** Glyphen-Body: 10-Byte-Header (Konturen + BBox) immer, auch bei 0 Konturen. */
function glyphRecord(contours) {
  const parts = [u16(contours.length)];
  let xMin = 0, yMin = 0, xMax = 0, yMax = 0;
  if (contours.length > 0) {
    xMin = Math.min(...contours.map((c) => Math.min(c[0], c[2], c[4], c[6])));
    xMax = Math.max(...contours.map((c) => Math.max(c[0], c[2], c[4], c[6])));
    yMin = Math.min(...contours.map((c) => Math.min(c[1], c[3], c[5], c[7])));
    yMax = Math.max(...contours.map((c) => Math.max(c[1], c[3], c[5], c[7])));
  }
  parts.push(i16(xMin), i16(yMin), i16(xMax), i16(yMax));
  if (contours.length > 0) {
    const endPts = [];
    const xs = [];
    const ys = [];
    for (const c of contours) {
      for (let i = 0; i < 4; ++i) {
        xs.push(c[i * 2]);
        ys.push(c[i * 2 + 1]);
      }
      endPts.push(xs.length - 1);
    }
    for (const e of endPts) parts.push(u16(e));
    parts.push(u16(0)); // instructionLength
    parts.push(Buffer.alloc(xs.length, 0x01)); // Flags: alle Punkte on-curve
    let prev = 0;
    for (const x of xs) { parts.push(i16(x - prev)); prev = x; }
    prev = 0;
    for (const y of ys) { parts.push(i16(y - prev)); prev = y; }
  }
  let g = Buffer.concat(parts);
  if (g.length % 4 !== 0) g = Buffer.concat([g, Buffer.alloc(4 - (g.length % 4))]);
  return g;
}
const notdef = glyphRecord([]); // Glyph 0 = .notdef (leer, aber mit Header)
glyfParts.push(notdef);
locas.push(notdef.length); // NICHT vergessen: loca-Eintrag für .notdef selbst
for (const ch of chars) {
  const g = glyphRecord(glyphContours(charSet.get(ch)));
  glyfParts.push(g);
  locas.push(locas[locas.length - 1] + g.length);
}
const glyfTable = Buffer.concat(glyfParts);
locas.push(glyfTable.length); // loca: numGlyphs+1 Einträge
const locaTable = Buffer.concat(locas.map((o) => u16(o / 2)));

// head (54 Bytes) — checkSumAdjustment später
const headTable = Buffer.concat([
  u32(0x00010000), u32(0x00010000), u32(0), u32(0x5f0f3cf5),
  u16(0), u16(UNITS),
  u32(0), u32(0), u32(0), u32(0),   // created + modified (je LONGDATETIME, 8 Bytes)
  i16(0), i16(DESCENT), i16(5 * PX), i16(7 * PX), // xMin yMin xMax yMax
  u16(0), u16(8),                      // macStyle, lowestRecPPEM
  i16(2), i16(0), i16(0),              // directionHint, indexToLocFormat=0, glyphDataFormat
]);

// hhea (36 Bytes)
const hheaTable = Buffer.concat([
  u32(0x00010000),
  i16(ASCENT), i16(DESCENT), i16(2 * PX),
  u16(ADVANCE), i16(0), i16(ADVANCE), i16(ADVANCE),
  i16(1), i16(0), i16(0),
  i16(0), i16(0), i16(0), i16(0),
  i16(0), u16(numGlyphs),
]);
const hmtxTable = Buffer.concat(
  Array.from({ length: numGlyphs }, () => Buffer.concat([u16(ADVANCE), i16(0)])),
);

// maxp v1.0 (32 Bytes: version + numGlyphs + 13 Felder)
const maxpTable = Buffer.concat([
  u32(0x00010000), u16(numGlyphs),
  u16(16), u16(8), u16(0), u16(0),
  u16(2), u16(0), u16(0), u16(0),
  u16(0), u16(0), u16(0),
  u16(0), u16(0),
]);

// cmap Format 4 (Unicode BMP, Platform 3 Encoding 1)
const cps = chars.map((c) => c.codePointAt(0));
const glyphIdOf = new Map(chars.map((c, i) => [c.codePointAt(0), i + 1]));
const segs = [];
{
  let start = cps[0];
  let prev = cps[0];
  for (let i = 1; i <= cps.length; ++i) {
    const cur = i < cps.length ? cps[i] : -1;
    if (cur !== prev + 1) {
      segs.push({ start, end: prev, firstId: glyphIdOf.get(start) });
      start = cur;
    }
    prev = cur;
  }
}
segs.push({ start: 0xffff, end: 0xffff, firstId: 0 });
const segCount = segs.length;
const bits = Math.floor(Math.log2(segCount));
const searchRange = 2 ** bits * 2;
const entrySelector = bits;
const rangeShift = segCount * 2 - searchRange;
const cmapSub = Buffer.concat([
  u16(4), u16(16 + segCount * 8), u16(0),
  u16(segCount * 2), u16(searchRange), u16(entrySelector), u16(rangeShift),
  ...segs.map((s) => u16(s.end)),
  u16(0),
  ...segs.map((s) => u16(s.start)),
  ...segs.map((s) => u16(((s.firstId - s.start) + 0x10000) & 0xffff)),
  ...segs.map(() => u16(0)),
]);
const cmapTable = Buffer.concat([u16(0), u16(1), u16(3), u16(1), u32(12), cmapSub]);

// OS/2 v4 (96 Bytes)
const firstCp = Math.min(...cps, 0xffff);
const lastCp = Math.max(...cps);
const os2Table = Buffer.concat([
  u16(4),                       // version
  i16(ADVANCE),                 // xAvgCharWidth
  u16(400), u16(5),             // weight, width class
  u16(0),                       // fsType: installable
  i16(640), i16(640), i16(0), i16(0),   // subscript
  i16(640), i16(640), i16(0), i16(0),   // superscript
  i16(PX), i16(6 * PX),         // strikeout size/position
  i16(0),                       // sFamilyClass
  Buffer.alloc(10),             // panose
  u32(1), u32(0), u32(0), u32(0), // unicode ranges (Basic Latin)
  Buffer.from("VW  ", "ascii"), // achVendID
  u16(0x0040),                  // fsSelection: REGULAR
  u16(firstCp), u16(lastCp),
  i16(ASCENT), i16(DESCENT), i16(2 * PX), // typo metrics
  u16(ASCENT), u16(-DESCENT),   // win metrics
  u32(1), u32(0),               // code page ranges (Latin 1)
  i16(3 * PX), i16(7 * PX),     // xHeight, capHeight
  u16(0x20), u16(0x20), u16(1), // default char, break char, max context
]);

// name: Format 0, 6 Records (Family, Subfamily, Unique, Full, Version, PostScript) × plattform 3/1/0x409
const nameStrings = [
  [1, "VW Pixel 5x7"],
  [2, "Regular"],
  [3, "VW-Pixel-5x7-regular"],
  [4, "VW Pixel 5x7 Regular"],
  [5, "Version 1.0"],
  [6, "VWPixel5x7-Regular"],
];
const utf16 = (s) => Buffer.from(s, "utf16le").swap16();
let nameBodyLen = 0;
for (const [, s] of nameStrings) nameBodyLen += utf16(s).length;
const nameRecords = [];
let strOff = 0;
for (const [id, s] of nameStrings) {
  const b = utf16(s);
  nameRecords.push(Buffer.concat([u16(3), u16(1), u16(0x0409), u16(id), u16(b.length), u16(strOff)]));
  strOff += b.length;
}
const nameTable = Buffer.concat([
  u16(0), u16(nameStrings.length), u16(6 + nameStrings.length * 12 + nameBodyLen),
  ...nameRecords,
  ...nameStrings.map(([, s]) => utf16(s)),
]);

// post v3.0 (32 Bytes)
const postTable = Buffer.concat([
  u32(0x00030000), i16(0), i16(0), i16(0), u32(1),
  u32(0), u32(0), u32(0), u32(0), u32(0),
]);

function checksum32(buf) {
  const padded = buf.length % 4 === 0 ? buf : Buffer.concat([buf, Buffer.alloc(4 - (buf.length % 4))]);
  let sum = 0;
  for (let i = 0; i < padded.length; i += 4) sum = (sum + padded.readUInt32BE(i)) >>> 0;
  return sum >>> 0;
}

// SFNT zusammenbauen
const tables = { OS2: os2Table, cmap: cmapTable, glyf: glyfTable, head: headTable, hhea: hheaTable, hmtx: hmtxTable, loca: locaTable, maxp: maxpTable, name: nameTable, post: postTable };
const tags = Object.keys(tables).sort();
const numTables = tags.length;
const es = Math.floor(Math.log2(numTables));
const sr = 2 ** es * 16;
const rs = numTables * 16 - sr;
let offset = 12 + numTables * 16;
const dirEntries = [];
const tableData = [];
for (const t of tags) {
  const data = tables[t];
  dirEntries.push(Buffer.concat([Buffer.from(t.padEnd(4, " "), "ascii"), u32(checksum32(data)), u32(offset), u32(data.length)]));
  tableData.push(data);
  offset += data.length + (data.length % 4 !== 0 ? 4 - (data.length % 4) : 0);
}
// Padding zwischen Tabellen für Ausrichtung
const fontNoAdj = Buffer.concat([
  u32(0x00010000), u16(numTables), u16(sr), u16(es), u16(rs),
  ...dirEntries,
  ...tableData.map((d, _i) => (d.length % 4 !== 0 ? Buffer.concat([d, Buffer.alloc(4 - (d.length % 4))]) : d)),
]);
// checkSumAdjustment: Summe über den ganzen Font muss 0xB1B0AFBA ergeben
const magic = 0xb1b0afba;
const adj = (magic - checksum32(fontNoAdj)) >>> 0;
fontNoAdj.writeUInt32BE(adj, 12 + numTables * 16 + 8); // head-Dir: Offset 8 = checkSumAdjustment (Feld 3 in head)

mkdirSync(join(root, "web/public"), { recursive: true });
const fontPath = join(root, "web/public/pixel-font.ttf");
writeFileSync(fontPath, fontNoAdj);
console.log(`wrote ${fontPath} (${fontNoAdj.length} bytes, ${numGlyphs} glyphs incl. .notdef)`);
