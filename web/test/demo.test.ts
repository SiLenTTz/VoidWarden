// demo.ts (EPIC-P13 T13.1): Vorschau-Modus ?demo=<display> — jeder
// Anzeigezustand erreichbar, Bühne zeigt ihn exakt, decide bleibt gesperrt.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDemoDisplay, demoStageInput, decideAllowed, DEMO_DISPLAYS } from "../src/demo.ts";
import { stageView } from "../src/stage.ts";

test("T13.1 parseDemoDisplay: bekannte Zustände, fehlender/unbekannter Parameter", () => {
  assert.equal(parseDemoDisplay("?demo=idle"), "idle");
  assert.equal(parseDemoDisplay("?demo=ws_offline"), "ws_offline");
  assert.equal(parseDemoDisplay(""), null);
  assert.equal(parseDemoDisplay("?foo=1"), null);
  assert.equal(parseDemoDisplay("?demo=kaffee"), null);
});

test("T13.1 demoStageInput: stageView liefert genau den angeforderten Anzeigezustand", () => {
  for (const d of DEMO_DISPLAYS) {
    assert.equal(stageView(demoStageInput(d)).display, d, `demo-Input für ${d}`);
  }
});

test("T13.1 Demo-Modus entscheidet nie: decideAllowed nur ohne Demo", () => {
  assert.equal(decideAllowed(null), true);
  for (const d of DEMO_DISPLAYS) {
    assert.equal(decideAllowed(d), false, `decideAllowed(${d})`);
  }
});
