#!/usr/bin/env node
/**
 * EPIC-P2 T2.4: 5×7-Pixelfont (UTF-8: A-Z, a-z-Auswahl via Großbuchstaben,
 * Ziffern, Satzzeichen, Pflicht-Umlaute äöüßÄÖÜ — spec §6) als C-Header für
 * die Firmware. Glyphen sind handgesetzte Bitmaps (lesbar, wartbar); der
 * Generator prüft Vollständigkeit gegen die Pflichtliste und schreibt
 * firmware/src/render/font5x7.h. Deterministisch: gleiche Glyphen → gleiches
 * Byte-Bild (Spaltenbits, 5 Bytes je Glyphe,高低 LSB-first).
 */
import { writeFileSync } from "node:fs";
await null; // top-level await-Kontext (ESM)

const G = {
  " ": [".....", ".....", ".....", ".....", ".....", ".....", "....."],
  A: [".###.", "#...#", "#####", "#...#", "#...#", ".....", "....."],
  B: ["####.", "#...#", "####.", "#...#", "####.", ".....", "....."],
  C: [".####", "#....", "#....", "#....", ".####", ".....", "....."],
  D: ["####.", "#...#", "#...#", "#...#", "####.", ".....", "....."],
  E: ["#####", "#....", "####.", "#....", "#####", ".....", "....."],
  F: ["#####", "#....", "####.", "#....", "#....", ".....", "....."],
  G: [".####", "#....", "#..##", "#...#", ".####", ".....", "....."],
  H: ["#...#", "#...#", "#####", "#...#", "#...#", ".....", "....."],
  I: ["#####", "..#..", "..#..", "..#..", "#####", ".....", "....."],
  J: ["..###", "...#.", "...#.", "#..#.", ".##..", ".....", "....."],
  K: ["#...#", "#..#.", "###..", "#..#.", "#...#", ".....", "....."],
  L: ["#....", "#....", "#....", "#....", "#####", ".....", "....."],
  M: ["#...#", "##.##", "#.#.#", "#...#", "#...#", ".....", "....."],
  N: ["#...#", "##..#", "#.#.#", "#..##", "#...#", ".....", "....."],
  O: [".###.", "#...#", "#...#", "#...#", ".###.", ".....", "....."],
  P: ["####.", "#...#", "####.", "#....", "#....", ".....", "....."],
  Q: [".###.", "#...#", "#.#.#", "#..#.", ".##.#", ".....", "....."],
  R: ["####.", "#...#", "####.", "#..#.", "#...#", ".....", "....."],
  S: [".####", "#....", ".###.", "....#", "####.", ".....", "....."],
  T: ["#####", "..#..", "..#..", "..#..", "..#..", ".....", "....."],
  U: ["#...#", "#...#", "#...#", "#...#", ".###.", ".....", "....."],
  V: ["#...#", "#...#", "#...#", ".#.#.", "..#..", ".....", "....."],
  W: ["#...#", "#...#", "#.#.#", "##.##", "#...#", ".....", "....."],
  X: ["#...#", ".#.#.", "..#..", ".#.#.", "#...#", ".....", "....."],
  Y: ["#...#", ".#.#.", "..#..", "..#..", "..#..", ".....", "....."],
  Z: ["#####", "...#.", "..#..", ".#...", "#####", ".....", "....."],
  Ä: [".#.#.", ".....", ".###.", "#...#", ".###.", ".....", "....."],
  Ö: [".#.#.", ".###.", "#...#", "#...#", ".###.", ".....", "....."],
  Ü: [".#.#.", "#...#", "#...#", "#...#", ".###.", ".....", "....."],
  0: [".###.", "#..##", "#.#.#", "##..#", ".###.", ".....", "....."],
  1: ["..#..", ".##..", "..#..", "..#..", ".###.", ".....", "....."],
  2: [".###.", "#...#", "..##.", ".#...", "#####", ".....", "....."],
  3: ["####.", "....#", ".###.", "....#", "####.", ".....", "....."],
  4: ["#..#.", "#..#.", "#####", "...#.", "...#.", ".....", "....."],
  5: ["#####", "#....", "####.", "....#", "####.", ".....", "....."],
  6: [".###.", "#....", "####.", "#...#", ".###.", ".....", "....."],
  7: ["#####", "....#", "...#.", "..#..", ".#...", ".....", "....."],
  8: [".###.", "#...#", ".###.", "#...#", ".###.", ".....", "....."],
  9: [".###.", "#...#", ".####", "....#", ".###.", ".....", "....."],
  ".": [".....", ".....", ".....", ".....", ".##..", ".....", "....."],
  ",": [".....", ".....", ".....", ".##..", ".#...", ".....", "....."],
  ":": [".....", ".##..", ".....", ".##..", ".....", ".....", "....."],
  "!": ["..#..", "..#..", "..#..", "..#..", ".....", "..#..", "....."],
  "?": [".###.", "#...#", "..##.", ".....", "..#..", ".....", "....."],
  "-": [".....", ".....", "#####", ".....", ".....", ".....", "....."],
  "+": [".....", "..#..", "#####", "..#..", ".....", ".....", "....."],
  "/": ["....#", "...#.", "..#..", ".#...", "#....", ".....", "....."],
  "(": ["...#.", "..#..", "..#..", "..#..", "...#.", ".....", "....."],
  ")": [".#...", "..#..", "..#..", "..#..", ".#...", ".....", "....."],
  "%": ["#...#", "...#.", "..#..", ".#...", "#...#", ".....", "....."],
  "ä": [".#.#.", ".....", ".###.", "#...#", ".###.", ".....", "....."],
  "ö": [".#.#.", ".###.", "#...#", "#...#", ".###.", ".....", "....."],
  "ü": [".#.#.", "#...#", "#...#", "#...#", ".###.", ".....", "....."],
  "ß": [".##..", "#..#.", "#.##.", "#..#.", "###..", ".....", "....."],
};

// Alle Glyphen sind oben als 5 Zeilen Körper gesetzt. Zellenlayout 5x7: Zeilen 0–1 frei für die
// Umlautpunkte, Körper auf Zeilen 2–6 (Grundlinie unten, Satzzeichen sitzen richtig). Umlaute
// bekommen ihre Punkte in Zeile 0 über dem unveränderten Grundbuchstaben (am Board: vorher
// ersetzten die Punkte die oberste Zeile, A/O/U waren nicht mehr erkennbar).
const UMLAUT_BASE = { "Ä": "A", "Ö": "O", "Ü": "U", "ä": "A", "ö": "O", "ü": "U" };
const SRC = JSON.parse(JSON.stringify(G)); // Quelle unverändert halten: A wird selbst verschoben
for (const ch of Object.keys(G)) {
  const base = UMLAUT_BASE[ch];
  const body = (base ? SRC[base] : SRC[ch]).slice(0, 5);
  G[ch] = [base ? ".#.#." : ".....", ".....", ...body];
}

const REQUIRED = "ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÜ0123456789.,:!?-+/()% äöüß".split("");
for (const ch of REQUIRED) {
  if (!G[ch]) {
    console.error(`FAIL: Glyphe fehlt: '${ch}'`);
    process.exit(1);
  }
}

let maxBytes = 0;
const entries = [];
for (const ch of REQUIRED) {
  const rows = G[ch];
  if (rows.length !== 7 || rows.some((r) => r.length !== 5)) {
    console.error(`FAIL: Glyphe '${ch}' nicht 5x7`);
    process.exit(1);
  }
  // Spaltenbytes: Bit y gesetzt, wenn Pixel in Zeile y (LSB = Zeile 0)
  const bytes = [0, 0, 0, 0, 0];
  for (let y = 0; y < 7; y++) {
    for (let x = 0; x < 5; x++) {
      if (rows[y][x] === "#") bytes[x] |= 1 << y;
    }
  }
  maxBytes += 5;
  entries.push({ ch, bytes });
}

const cp = (ch) => Array.from(Buffer.from(ch, "utf8"));
let out = `// Generiert von tools/assets/generate_font.mjs — nicht von Hand editieren.\n`;
out += `// 5x7-Pixelfont, Pflichtzeichen inkl. äöüßÄÖÜ (spec.md §6).\n`;
out += `// Kodierung: UTF-8-Codepoints als Tupel + 5 Spaltenbytes (Bit y = Zeile y).\n`;
out += `#pragma once\n#include <cstddef>\n#include <cstdint>\nnamespace vw {\n`;
out += `struct FontGlyph {\n    uint8_t cp[3];\n    uint8_t len;\n    uint8_t cols[5];\n};\n`;
out += `inline const FontGlyph kFont5x7[] = {\n`;
for (const e of entries) {
  const c = cp(e.ch);
  const padded = c.concat(Array(3 - c.length).fill(0));
  out += `    {${`{${padded.join(", ")}}`}, ${c.length}, {${e.bytes.join(", ")}}}, // '${e.ch}'\n`;
}
out += `};\n`;
out += `inline const size_t kFont5x7Count = sizeof(kFont5x7) / sizeof(kFont5x7[0]);\n`;
out += `inline constexpr uint8_t kFontW = 5, kFontH = 7, kFontAdvance = 6;\n`;
out += `}  // namespace vw\n`;
// Generierte Datei direkt clang-formatieren (lint prueft sie spaeter):
writeFileSync("firmware/src/render/font5x7.h", out);
try {
  const { execFileSync } = await import("node:child_process");
  execFileSync("clang-format", ["-i", "firmware/src/render/font5x7.h"]);
} catch {
  console.warn("warn: clang-format nicht gefunden — Header unformatiert (lint wird rot)");
}
console.log(`font5x7.h: ${entries.length} Glyphen (${maxBytes} Bytes Daten), Pflichtliste inkl. Umlaute geprüft`);
