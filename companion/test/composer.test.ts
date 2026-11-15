// EPIC-P8 T8.1: Composer — Tabelle + Property (AC-P8-1, W4/W10). Seed fest, keine Uhr.
import { test } from "node:test";
import assert from "node:assert/strict";
import { compose, formatDuration, type ComposerInput } from "../src/composer.ts";

const base: ComposerInput = { working: 0, blocked: 0, error: 0, hubUp: true, dataAgeS: 2 };

test("Tabelle: Vorlage aus ADR-0008 mit Zahlen aus der Eingabe", () => {
  const cases: Array<[Partial<ComposerInput>, string]> = [
    [{ working: 2, blocked: 1, lastEventTitle: "Build ok" }, "2 Agents arbeiten. 1 wartet auf Eingriff. Letztes Ereignis: Build ok."],
    [{ working: 1 }, "1 Agent arbeitet."],
    [{ blocked: 3 }, "3 warten auf Eingriff."],
    [{ error: 1, working: 1 }, "1 Agent arbeitet. 1 Fehler."],
    [{ lastEventAgeS: 125 }, "Keine neuen Statusmeldungen seit 2 Min."],
    [{}, "Keine aktiven Agents."],
  ];
  for (const [patch, expected] of cases) {
    assert.equal(compose({ ...base, ...patch }).text, expected);
  }
});

test("veralteter Stand wird benannt statt geraten", () => {
  const down = compose({ ...base, hubUp: false, dataAgeS: 90, working: 2 });
  assert.ok(down.stale);
  assert.match(down.text, /^Hub nicht erreichbar\. Letzter Stand vor 1 Min: 2 Agents arbeiten\./);
  const old = compose({ ...base, dataAgeS: 31, blocked: 1 });
  assert.ok(old.stale && old.text.startsWith("Stand veraltet."));
  assert.ok(!compose({ ...base, dataAgeS: 30 }).stale);
});

test("Zeilen ≤ 40 Zeichen, Seiten à 2 Zeilen, Seite 0 ist die kompakte Blase", () => {
  const b = compose({ ...base, working: 12, blocked: 4, error: 2, lastEventTitle: "x".repeat(60) });
  for (const page of b.pages) assert.ok(page.length >= 1 && page.length <= 2);
  for (const line of b.pages.flat()) assert.ok([...line].length <= 40, line);
  assert.ok(b.pages.length > 1);
});

test("Titel wird bereinigt: ANSI und Steuerzeichen raus, Befehlstext bleibt Anzeige", () => {
  const b = compose({ ...base, working: 1, lastEventTitle: "\x1b[31mrm -rf /\x1b[0m\u0007 ausführen" });
  // eslint-disable-next-line no-control-regex -- prüft gerade die Abwesenheit von Steuerzeichen
  assert.ok(!/[\u0000-\u001f\u007f]/.test(b.text));
  assert.ok(b.text.includes("rm -rf / ausführen"));
});

test("formatDuration", () => {
  assert.equal(formatDuration(0), "0 s");
  assert.equal(formatDuration(59), "59 s");
  assert.equal(formatDuration(60), "1 Min");
  assert.equal(formatDuration(3599), "59 Min");
  assert.equal(formatDuration(7200), "2 Std");
  assert.equal(formatDuration(-5), "0 s");
});

test("Property: jede Zahl der Ausgabe stammt aus der Eingabe, nie Prozent/Vermutung", () => {
  let seed = 12345;
  const rnd = (n: number) => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed % n;
  };
  for (let i = 0; i < 500; i++) {
    const input: ComposerInput = {
      working: rnd(30),
      blocked: rnd(10),
      error: rnd(5),
      hubUp: rnd(4) !== 0,
      dataAgeS: rnd(10000),
    };
    if (rnd(2) === 0) input.lastEventAgeS = rnd(100000);
    const b = compose(input);
    const allowed = new Set<string>([
      String(input.working),
      String(input.blocked),
      String(input.error),
      ...[input.dataAgeS, input.lastEventAgeS ?? 0].flatMap((s) => [
        String(Math.floor(s)),
        String(Math.floor(s / 60)),
        String(Math.floor(s / 3600)),
      ]),
    ]);
    for (const m of b.text.match(/\d+/g) ?? []) assert.ok(allowed.has(m), `${m} nicht aus Eingabe: ${b.text}`);
    assert.ok(!b.text.includes("%"));
  }
});

test("Ungültige Zähler (NaN, negativ) werden zu 0, nie zu Text wie NaN", () => {
  const b = compose({ ...base, working: Number.NaN, blocked: -3, error: Number.POSITIVE_INFINITY });
  assert.equal(b.text, "Keine aktiven Agents.");
});
