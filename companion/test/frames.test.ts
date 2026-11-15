// Contract-Oracle (EPIC-P1 T1.3): die Zod-Modelle müssen sich EXAKT wie die
// JSON-Schemas in protocol/ verhalten — geprüft über dieselben goldenen
// Fixtures (docs/testing.md §1 Contract-Ebene).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { decodeLine, encodeFrame, splitLinePrefix, type Frame } from "../src/frames.ts";

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "protocol", "fixtures");
const files = readdirSync(fixtureDir).filter((f) => f.endsWith(".ndjson"));

test("gültige Fixtures dekodieren erfolgreich", () => {
  const valid = files.filter((f) => f.includes(".valid"));
  assert.ok(valid.length >= 11, `erwartet ≥ 11 gültige Fixtures, gefunden ${valid.length}`);
  for (const f of valid) {
    for (const line of readFileSync(join(fixtureDir, f), "utf8").split("\n").filter(Boolean)) {
      const res = decodeLine(line);
      assert.ok(res.ok, `${f}: ${res.ok ? "" : res.failure.kind + " " + res.failure.message}`);
    }
  }
});

test("ungültige Fixtures werden abgelehnt, je Kategorie", () => {
  const categories = new Map<string, number>();
  for (const f of files.filter((f) => f.includes(".invalid-"))) {
    const cat = f.match(/\.invalid-([a-z0-9-]+)\.ndjson$/)?.[1] ?? "?";
    for (const line of readFileSync(join(fixtureDir, f), "utf8").split("\n").filter(Boolean)) {
      const res = decodeLine(line);
      assert.ok(!res.ok, `${f}: sollte scheitern, war aber ok`);
      categories.set(cat, (categories.get(cat) ?? 0) + 1);
    }
  }
  assert.ok((categories.get("oversize") ?? 0) >= 1, "Kategorie oversize fehlt");
  assert.ok((categories.get("unknown-type") ?? 0) >= 1, "Kategorie unknown-type fehlt");
  assert.ok((categories.get("missing-v") ?? 0) >= 1, "Kategorie missing-v fehlt");
  assert.ok((categories.get("wrong-type") ?? 0) >= 1, "Kategorie wrong-type fehlt");
});

test("additive Felder: gültig, aber als unknownFields gemeldet (ADR-0002)", () => {
  const res = decodeLine('{"v":1,"type":"resync","last_seq":7,"future_field":{"x":1},"anderes":3}');
  assert.ok(res.ok);
  assert.deepEqual(res.ok ? res.unknownFields.sort() : [], ["anderes", "future_field"]);
});

test("splitLinePrefix: ROM-Bytes vor dem ersten { werden getrennt, Körper bleibt unverändert", () => {
  assert.deepEqual(splitLinePrefix("\u001b[0m\u0000{\"v\":1}"), { prefix: "\u001b[0m\u0000", body: '{"v":1}' });
  assert.deepEqual(splitLinePrefix('{"v":1,"x":"{"}'), { prefix: "", body: '{"v":1,"x":"{"}' }, "erstes { am Anfang: kein Präfix");
  assert.deepEqual(splitLinePrefix("nur text"), { prefix: "", body: "nur text" }, "ohne { keine Abtrennung");
  assert.deepEqual(splitLinePrefix("{"), { prefix: "", body: "{" });
});

test("ROM-Präfix vor hello: Frame dekodiert, Präfix nicht im Körper (T2.9 Host-Teil)", () => {
  const hello = '{"v":1,"type":"hello","fw":"0.2.0","proto":1,"screen":{"w":320,"h":240},"reset_reason":"POWERON_RESET","heap_free":244160}';
  const { body } = splitLinePrefix("\u00ff\u00fe garbage" + hello);
  const res = decodeLine(body);
  assert.ok(res.ok, JSON.stringify(res));
  assert.equal(res.ok && res.frame.type, "hello");
});

test("encodeFrame verweigert schema-invaliden Frame (Review B5)", () => {
  const bad = { v: 1, type: "resync", last_seq: -1 } as unknown as Parameters<typeof encodeFrame>[0];
  assert.throws(() => encodeFrame(bad), /schema-invalid/);
});

test("encodeFrame verweigert > 512 Byte (K5: kein Truncate)", () => {
  // schema-gültig, aber in der Summe > 512 B: Länge läuft in die K5-Prüfung.
  const fat: Frame = {
    v: 1,
    type: "log",
    level: "info",
    msg: "x".repeat(200),
    fields: { pad: "y".repeat(400) },
  };
  assert.throws(() => encodeFrame(fat), /K5/);
});

test("encode→decode ist identisch (Roundtrip)", () => {
  const frame: Frame = {
    v: 1,
    type: "heartbeat",
    seq: 42,
    ts: "2026-11-03T12:00:00Z",
    hub: "up",
  };
  const res = decodeLine(encodeFrame(frame));
  assert.ok(res.ok);
  assert.deepEqual(res.ok ? res.frame : null, frame);
});
