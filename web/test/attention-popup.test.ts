import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "../index.html"), "utf8");
const css = readFileSync(join(here, "../src/style.css"), "utf8");
const main = readFileSync(join(here, "../src/main.ts"), "utf8");

test("BUG-0015: Aufmerksamkeits-Badge und Popup-Markup", () => {
  assert.match(html, /id="attn"/);
  assert.match(html, /id="take-voice"/);
  assert.match(html, /id="take-close"/);
  assert.match(html, /id="nyx-wrap"/);
  assert.doesNotMatch(html, /<input\b|<textarea\b/i);
});

test("BUG-0015: Popup ist Modal, Badge pulsiert, keine Hold-Leiste", () => {
  assert.match(css, /#take\s*\{[^}]*position:\s*fixed/s);
  assert.match(css, /#attn\s*\{/s);
  assert.doesNotMatch(css, /#take\s+\.hold\b/);
});

test("BUG-0015: Badge öffnet Popup; Tippen statt Hold; Voice → Entwurf statt Steer", () => {
  assert.match(main, /openTakePopup/);
  assert.match(main, /startVoiceListen/);
  assert.match(main, /\$\("attn"\)\.addEventListener\("click"/);
  assert.doesNotMatch(main, /holdBegin|approveGesture|pointerleave/);
  assert.match(main, /ADR-0012/);
  assert.match(main, /app\.draft\(/);
  assert.doesNotMatch(main, /steer|\/prompt/);
});

test("BUG-0016: Augen-Marker-Tausch am Web-Blit", () => {
  assert.match(main, /swapEyeMarkers/);
  assert.match(main, /eyeRgb/);
});
