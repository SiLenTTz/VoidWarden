import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
import assert from "node:assert/strict";
import { sayDone, sayTap, type SayGate } from "../src/say.ts";

const fresh = (): SayGate => ({ inFlight: false });

test("BUG-0011: erster Tap startet, zweiter Tap während des Laufes wird ignoriert", () => {
  const g = fresh();
  assert.equal(sayTap(g), true, "erster Tap erlaubt");
  assert.equal(sayTap(g), false, "zweiter Tap während 10-s-Synthese ignoriert");
  assert.equal(sayTap(g), false, "dritter Tap ebenfalls");
});

test("BUG-0011: nach Erfolg ist das Gate wieder frei", () => {
  const g = fresh();
  assert.equal(sayTap(g), true);
  sayDone(g);
  assert.equal(sayTap(g), true, "nach sayDone wieder startbar");
});

test("BUG-0011: nach Fehler (finally-Pfad) ist das Gate wieder frei", () => {
  const g = fresh();
  assert.equal(sayTap(g), true);
  sayDone(g);
  assert.equal(g.inFlight, false);
  assert.equal(sayTap(g), true);
});

test("BUG-0011-Verdrahtung: Blase vor dem /say-Fetch, Guard am Funktionsanfang", () => {
  const src = readFileSync(join(here, "../src/main.ts"), "utf8");
  const fn = src.slice(src.indexOf("async function speakText"));
  const guard = fn.indexOf("if (!sayTap(sayGate)) return;");
  const bubble = fn.indexOf('showBubble("voice", "Nyx liest vor');
  const fetchIdx = fn.indexOf('await fetch("/say"');
  assert.ok(guard > -1, "sayTap-Guard fehlt");
  assert.ok(bubble > -1, "sofortige Blase fehlt");
  assert.ok(fetchIdx > -1, "/say-Fetch fehlt");
  assert.ok(guard < fetchIdx && bubble < fetchIdx, "Guard und Blase müssen vor dem Fetch kommen");
  assert.ok(fn.indexOf("finally {") > -1 && fn.indexOf("sayDone(sayGate)") > -1, "sayDone im finally fehlt");
});

test("BUG-0018: Körper-Tap spricht Status (speakFocusStatus), nicht nur Blase", () => {
  const src = readFileSync(join(here, "../src/main.ts"), "utf8");
  assert.match(src, /async function speakFocusStatus/);
  const stage = src.slice(src.indexOf('$("stage").addEventListener("click"'));
  const body = stage.indexOf("speakFocusStatus");
  const head = stage.indexOf("speakLastMessage");
  assert.ok(head > -1 && body > -1, "Kopf- und Körper-Speak verdrahtet");
  assert.ok(body > head, "Körper-Zweig nach Kopf-Zweig");
  assert.equal(stage.includes('showBubble(item.kind, item.title, item.body);\n    return;'), false, "alter Text-only-Körperpfad darf nicht mehr stehen");
});
