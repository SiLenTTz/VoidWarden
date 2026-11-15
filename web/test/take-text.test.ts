import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { takeBodyText } from "../src/take-text.ts";

test("takeBodyText: Title und Body zusammen, Leer/Identität sauber", () => {
  assert.equal(takeBodyText({ title: "Schreib Datei", body: "write · Edit" }), "Schreib Datei\nwrite · Edit");
  assert.equal(takeBodyText({ title: "", body: "write · Edit" }), "write · Edit");
  assert.equal(takeBodyText({ title: "  ", body: "  write  " }), "write");
  assert.equal(takeBodyText({ title: "same", body: "same" }), "same");
  assert.equal(takeBodyText({ title: "nur", body: "" }), "nur");
});

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "../index.html"), "utf8");
const css = readFileSync(join(here, "../src/style.css"), "utf8");
const main = readFileSync(join(here, "../src/main.ts"), "utf8");

test("BUG-0014: Viewport sperrt Pinch-Zoom (Kiosk)", () => {
  assert.match(html, /user-scalable=no/);
  assert.match(html, /maximum-scale=1/);
});

test("BUG-0014: Nyx-Wrap füllt die 66%-Bühne; Kacheln sprengen die Spalte nicht", () => {
  assert.match(css, /grid-template-rows:\s*66fr\s+34fr/);
  assert.doesNotMatch(css, /#stage[^}]*container-type:\s*size/s);
  assert.match(css, /#nyx-wrap[^}]*max-height:\s*calc\(100%\s*-\s*3\.2rem\)/s);
  assert.match(css, /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
});

test("BUG-0014: Freigabetext und Pending-Voice verdrahtet", () => {
  assert.match(main, /takeBodyText\(/);
  assert.match(main, /pendingVoice/);
});
