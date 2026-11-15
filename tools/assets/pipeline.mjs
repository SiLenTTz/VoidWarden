#!/usr/bin/env node
/**
 * Asset-Pipeline Atlas-PNG → firmware/data/nyx.spr (Format NYX2, ADR-0006).
 *
 * Regeln: Index 0 = transparent, Indizes 1–3 = Augenmarker (Firmware tauscht sie je
 * Zustand), Indizes 4–15 = Körperfarben (≤ 12, mehr bricht den Build). Deterministisch:
 * gleiche Quelle → byte-gleiches Image, Körperfarben nach Helligkeit sortiert.
 * Ausgabe liegt in firmware/data/ (git-ignored).
 *
 * Quelle: assets/nyx/nyx-atlas.{png,json} (Atlas v2, Herkunft in assets/nyx/README.txt).
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname } from "node:path";
import { PNG } from "pngjs";

// Pfade über argv überschreibbar (Tests arbeiten mit eigenen PNGs):
const args = new Map(process.argv.slice(2).map((a, i, all) => (a.startsWith("--") ? [a.slice(2), all[i + 1]] : [null, null])).filter(([k]) => k));
const SRC_PNG = args.get("png") ?? "assets/nyx/nyx-atlas.png";
const SRC_META = args.get("meta") ?? "assets/nyx/nyx-atlas.json";
const OUT = args.get("out") ?? "firmware/data/nyx.spr";
const MAX_BODY = 12;
const EYE_ROW_SPAN_MAX = 8; // Marker nur im Augenband (Premortem: verirrte Marker färben den Körper)
// Reihenfolge = Palette-Index 1..3 (core, mid, dim)
const MARKERS = [
  [0xff, 0x00, 0xff],
  [0xc0, 0x00, 0xc0],
  [0x80, 0x00, 0x80],
];

const fail = (msg) => {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
};

for (const f of [SRC_PNG, SRC_META]) {
  if (!existsSync(f)) fail(`${f} fehlt (Quelle: assets/nyx/, siehe assets/nyx/README.txt)`);
}
const png = PNG.sync.read(readFileSync(SRC_PNG));
const meta = JSON.parse(readFileSync(SRC_META, "utf8"));
const { fw, fh, frames } = meta;
if (png.width !== fw * frames.length || png.height !== fh) {
  fail(`PNG-Maße ${png.width}x${png.height} passen nicht zu ${frames.length}x ${fw}x${fh}`);
}
if ((fw * fh) % 2 !== 0) fail(`Frame ${fw}x${fh} hat ungerade Pixelzahl (4-Bit-Packung)`);

const key = (r, g, b) => (r << 16) | (g << 8) | b;
const hex = (k) => `#${k.toString(16).padStart(6, "0")}`;
const markerIndex = new Map(MARKERS.map((c, i) => [key(...c), i + 1]));

// --- Pass 1: Farben sammeln, Alpha streng binär, Marker-Zeilenband ----------
const bodyKeys = new Set();
let markerYMin = Infinity;
let markerYMax = -1;
for (let y = 0; y < png.height; y++) {
  for (let x = 0; x < png.width; x++) {
    const i = (y * png.width + x) << 2;
    const a = png.data[i + 3];
    if (a === 0) continue;
    if (a !== 255) fail(`Teiltransparenz bei (${x},${y}): alpha ${a} (nur 0 oder 255 erlaubt)`);
    const k = key(png.data[i], png.data[i + 1], png.data[i + 2]);
    if (markerIndex.has(k)) {
      markerYMin = Math.min(markerYMin, y);
      markerYMax = Math.max(markerYMax, y);
    } else {
      bodyKeys.add(k);
    }
  }
}
if (bodyKeys.size > MAX_BODY) {
  fail(`> ${MAX_BODY} Körperfarben (ADR-0006): ${bodyKeys.size} gefunden, Marker nicht mitgezählt`);
}
if (markerYMax >= 0 && markerYMax - markerYMin + 1 > EYE_ROW_SPAN_MAX) {
  fail(`Augenmarker über ${markerYMax - markerYMin + 1} Zeilen (${markerYMin}–${markerYMax}), erlaubt sind ${EYE_ROW_SPAN_MAX}: Marker außerhalb der Augen`);
}
if (Array.isArray(meta.bodyColors)) {
  const declared = new Set(meta.bodyColors.map((h) => parseInt(h.slice(1), 16)));
  const same = declared.size === bodyKeys.size && [...bodyKeys].every((k) => declared.has(k));
  if (!same) fail("bodyColors im JSON stimmt nicht mit den Farben des PNG überein");
}

// Körperfarben dunkel → hell (Luma, dann Wert): stabile Indizes unabhängig vom Pixel-Scan.
const luma = (k) => 0.299 * (k >> 16) + 0.587 * ((k >> 8) & 255) + 0.114 * (k & 255);
const body = [...bodyKeys].sort((a, b) => luma(a) - luma(b) || a - b);
const bodyIndex = new Map(body.map((k, i) => [k, 4 + i]));

// Palette: 0 = transparent (Renderer setzt den Hintergrund), 1–3 Marker, 4.. Körper
const palette = [[0, 0, 0], ...MARKERS, ...body.map((k) => [k >> 16, (k >> 8) & 255, k & 255])];

// --- Pass 2: Frame-Daten als 4-Bit-Indizes (high nibble zuerst) -------------
const pixels = Buffer.alloc((frames.length * fw * fh) / 2);
let out = 0;
let pending = -1;
for (let f = 0; f < frames.length; f++) {
  for (let y = 0; y < fh; y++) {
    for (let x = 0; x < fw; x++) {
      const i = (y * png.width + f * fw + x) << 2;
      let idx = 0;
      if (png.data[i + 3] !== 0) {
        const k = key(png.data[i], png.data[i + 1], png.data[i + 2]);
        idx = markerIndex.get(k) ?? bodyIndex.get(k);
      }
      if (pending < 0) {
        pending = idx;
      } else {
        pixels[out++] = (pending << 4) | idx;
        pending = -1;
      }
    }
  }
}

// --- Dauer je Frame aus states[].duration_ms (optional), 10-ms-Einheiten ----
const durationByState = new Map((meta.states ?? []).map((s) => [s.state, s.duration_ms]));
const stateNames = [...new Set(frames.map((fr) => fr.state))];
const frameDuration = (state) => {
  const ms = durationByState.get(state) ?? 0;
  if (!Number.isInteger(ms) || ms < 0 || ms % 10 !== 0 || ms > 2550) {
    fail(`Dauer ${ms} ms für ${state}: erlaubt sind Vielfache von 10 bis 2550`);
  }
  return ms / 10;
};

// --- Container (stabile Reihenfolge) -----------------------------------------
// magic "NYX2" | u8 version(2) | u16 fw | u16 fh | u16 frames | u8 palette |
// Palette RGB888 | pro Frame (18 B): 16 Byte Name (state, \0-gepolstert; "approval_pending"
// füllt alle 16) + u8 index + u8 Dauer (10 ms; 0 = Renderer-Standard) | Pixeldaten
const header = Buffer.alloc(12);
header.write("NYX2", 0, "ascii");
header.writeUInt8(2, 4);
header.writeUInt16LE(fw, 5);
header.writeUInt16LE(fh, 7);
header.writeUInt16LE(frames.length, 9);
header.writeUInt8(palette.length, 11);

const palBuf = Buffer.alloc(palette.length * 3);
palette.forEach(([r, g, b], i) => {
  palBuf.writeUInt8(r, i * 3);
  palBuf.writeUInt8(g, i * 3 + 1);
  palBuf.writeUInt8(b, i * 3 + 2);
});

const META = 18;
const NAME_MAX = 16;
const metaBuf = Buffer.alloc(frames.length * META);
frames.forEach((fr, i) => {
  if (fr.state.length > NAME_MAX) fail(`Zustandsname ${fr.state} länger als ${NAME_MAX} Zeichen`);
  metaBuf.write(fr.state, i * META, NAME_MAX, "ascii");
  metaBuf.writeUInt8(fr.index, i * META + NAME_MAX);
  metaBuf.writeUInt8(frameDuration(fr.state), i * META + NAME_MAX + 1);
});

const blob = Buffer.concat([header, palBuf, metaBuf, pixels]);
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, blob);
const sha = createHash("sha256").update(blob).digest("hex");
const manifest = {
  file: OUT,
  bytes: blob.length,
  sha256: sha,
  format: "NYX2",
  frame: { w: fw, h: fh },
  frames: frames.length,
  palette: palette.length,
  bodyColors: body.length,
  eyeMarkers: MARKERS.map((c) => hex(key(...c))),
  states: stateNames,
  source: { png: SRC_PNG, meta: SRC_META },
};
writeFileSync(OUT + ".json", JSON.stringify(manifest, null, 1) + "\n");
console.log(`nyx.spr: NYX2 ${blob.length} B, ${frames.length} Frames ${fw}x${fh}, Körperfarben ${body.length}/${MAX_BODY}, sha256=${sha.slice(0, 16)}…`);
