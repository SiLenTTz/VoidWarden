// Sanitizing-Tests (EPIC-P1 T1.4, ADR-0004): ANSI, Steuerzeichen, Überlänge,
// Umlaute — Grenzen 40/160 sind Protokoll-Pflicht (W4).
import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeText, sanitizePayload } from "../src/sanitize.ts";

test("ANSI-/CSI-Sequenzen werden entfernt; OSC-Inhalt komplett (Injection-Schutz)", () => {
  assert.equal(sanitizeText("\u001b[31mrot\u001b[0m \u001b[2Ktext", 40), "rot text");
  // OSC (\x1b]0;title\x07) ist Terminal-Titel-Setter: Inhalt ist keine Anzeige-Daten.
  assert.equal(sanitizeText("\u001b]0;title\u0007rest", 40), "rest");
});

test("Steuerzeichen fliegen raus, Whitespace kollabiert zu Einzel-Leerzeichen", () => {
  assert.equal(sanitizeText("a\u0000b\u0007c\u007f\u000bd\te\nf", 40), "abcd e f");
  assert.equal(sanitizeText("  viele   Lücken  ", 40), "viele Lücken");
});

test("Überlange Titel kürzen mit … auf exakt die Grenze", () => {
  const out = sanitizeText("x".repeat(50), 40);
  assert.equal(out.length, 40);
  assert.ok(out.endsWith("…"));
});

test("Umlaute zählen als je ein Zeichen (äöüß bleibt lesbar)", () => {
  assert.equal(sanitizeText("ÄÖÜäöüß", 40), "ÄÖÜäöüß");
  const out = sanitizeText("ß".repeat(45), 40);
  assert.equal([...out].length, 40);
});

test("sanitizePayload erzwingt 40/160", () => {
  const p = sanitizePayload({ title: "t".repeat(80), body: "b".repeat(300) });
  // „…“ kostet 3 Byte, die Firmware zählt Bytes: 38 + „…“ = 40 B, 158 + „…“ = 160 B.
  assert.equal(Buffer.byteLength(p.title), 40);
  assert.equal(Buffer.byteLength(p.body), 160);
  assert.ok(p.title.endsWith("…") && p.body.endsWith("…"));
});

// Die Firmware prüft `strlen` (Bytes), nicht Zeichen: Umlaute und „…“ dürfen das Limit nicht sprengen,
// sonst verwirft sie den Frame (Seq-Lücke → Resync, keine Blase). Reproduziert am Board 2026-11-06.
test("sanitizePayload hält 40/160 auch in UTF-8-Bytes ein", () => {
  const p = sanitizePayload({ title: "ü".repeat(60), body: "Gemergt, gründlich geprüft – größer…".repeat(10) });
  assert.ok(Buffer.byteLength(p.title) <= 40, String(Buffer.byteLength(p.title)));
  assert.ok(Buffer.byteLength(p.body) <= 160, String(Buffer.byteLength(p.body)));
  assert.ok(p.body.endsWith("…"));
  assert.ok(!p.body.includes("�"), "kein halbes Zeichen");
});

test("sanitizePayload lässt kurze Umlaut-Texte unverändert", () => {
  const p = sanitizePayload({ title: "Prüfung", body: "Größe ok" });
  assert.deepEqual(p, { title: "Prüfung", body: "Größe ok" });
});
