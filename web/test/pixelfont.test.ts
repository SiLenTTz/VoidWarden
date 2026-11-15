// EPIC-P11 T11.7: 5x7-Pixelfont — Glyphen 1:1 aus firmware font5x7.h.
// Der Generator (tools/assets/extract-web-pixelfont.mjs) schreibt die Daten;
// diese Tests sichern die Board-Identität: Firmware-Kodierung (Spaltenbytes,
// Bit y = Zeile y), Kleinbuchstaben-Fallback auf Groß-Glyphen (bubbleGlyph-
// Kanon), unbekannte Zeichen → Leerzeichen.
import { test } from "node:test";
import assert from "node:assert/strict";
import { FONT5X7, FONT_ADVANCE, FONT_W, FONT_H } from "../src/pixelfont-data.g.ts";
import { glyphFor, pixelTextWidth } from "../src/pixelfont.ts";

test("FONT5X7: Pflicht-Zeichen des Boards sind vorhanden", () => {
  const cps = new Set(FONT5X7.map((g) => g.cp));
  // Pflichtliste laut font5x7.h (spec.md §6): A-Z, 0-9, Satzzeichen, äöüßÄÖÜ
  for (const ch of "ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÜ0123456789.,:!?-+/()% äöüß") {
    assert.ok(cps.has(ch), `Glyph fehlt: ${ch}`);
  }
  assert.equal(FONT5X7.length, 55);
  assert.equal(FONT_W, 5);
  assert.equal(FONT_H, 7);
  assert.equal(FONT_ADVANCE, 6); // kFontAdvance
});

test("glyphFor: Glyphe wird unverändert geliefert (Board-Kanon)", () => {
  const a = FONT5X7.find((g) => g.cp === "A");
  assert.notEqual(a, undefined);
  assert.deepEqual(glyphFor("A"), a?.cols);
  const ae = FONT5X7.find((g) => g.cp === "ä");
  assert.deepEqual(glyphFor("ä"), ae?.cols);
});

test("glyphFor: Kleinbuchstaben fallen auf Groß-Glyphen (wie bubbleGlyph)", () => {
  const a = glyphFor("A");
  assert.deepEqual(glyphFor("a"), a);
  const o = glyphFor("O");
  assert.deepEqual(glyphFor("o"), o); // ASCII-Kleinbuchstaben → Groß-Glyph
  // Umlaute existieren als eigene Glyphen (äöüß laut font5x7.h)
  for (const ch of "äöüßÄÖÜ") {
    const own = FONT5X7.find((g) => g.cp === ch);
    assert.notEqual(own, undefined, `Glyph fehlt: ${ch}`);
    assert.deepEqual(glyphFor(ch), own?.cols);
  }
});

test("glyphFor: unbekannte Zeichen → Leerzeichen (Lücke statt Absturz)", () => {
  const space = FONT5X7.find((g) => g.cp === " ");
  assert.deepEqual(glyphFor("@"), space?.cols);
  assert.deepEqual(glyphFor("😀"), space?.cols);
  assert.deepEqual(glyphFor("\n"), space?.cols);
});

test("pixelTextWidth: Advance 6 pro Zeichen wie kFontAdvance", () => {
  assert.equal(pixelTextWidth(""), 0);
  assert.equal(pixelTextWidth("A"), 6);
  assert.equal(pixelTextWidth("ABC"), 18);
});

test("Glyphen-Daten: kodiert wie Firmware (Spaltenbytes, Bit y = Zeile y)", () => {
  // Stichprobe '!' = cols [0,0,60,0,0]: 60 = 0b111100 → Zeilen 2,3,4,5 in Spalte 2
  const bang = FONT5X7.find((g) => g.cp === "!");
  assert.deepEqual(bang?.cols, [0, 0, 60, 0, 0]);
  // Stichprobe '1' = [0,72,124,64,0] (font5x7.h Zeile 44)
  const one = FONT5X7.find((g) => g.cp === "1");
  assert.deepEqual(one?.cols, [0, 72, 124, 64, 0]);
});
