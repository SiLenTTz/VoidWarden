// Contract-Test (EPIC-P0 T0.4): goldene Fixtures validieren gegen die
// JSON-Schemas — dieselben Dateien, die auch check:protocol und die
// Firmware-native-Tests lesen (docs/testing.md §1).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
// ajv (CJS) wird unter nodenext als Namespace aufgelöst — die Klasse selbst
// ist der benannte Export `Ajv` (TS- und runtime-kompatibel).
import { Ajv } from "ajv";

const here = dirname(fileURLToPath(import.meta.url));
const schemaDir = join(here, "..", "schema", "frame");
const fixtureDir = join(here, "..", "fixtures");

const ajv = new Ajv({ allErrors: true, allowUnionTypes: true });
const schemas = new Map(
  readdirSync(schemaDir)
    .filter((f) => f.endsWith(".schema.json"))
    .map((f) => {
      const type = f.replace(/\.schema\.json$/, "");
      return [type, ajv.compile(JSON.parse(readFileSync(join(schemaDir, f), "utf8")))] as const;
    }),
);

const fixtureFiles = readdirSync(fixtureDir).filter((f) => f.endsWith(".ndjson"));

test("jeder Frame-Typ hat Schema, gültiges und ungültiges Fixture", () => {
  assert.ok(schemas.size >= 11, `erwartet ≥ 11 Frame-Schemas, gefunden ${schemas.size}`);
  for (const type of schemas.keys()) {
    assert.ok(
      fixtureFiles.some((f) => f.startsWith(`${type}.valid`)),
      `kein gültiges Fixture für ${type}`,
    );
    assert.ok(
      fixtureFiles.some((f) => f.startsWith(`${type}.invalid-`)),
      `kein ungültiges Fixture für ${type}`,
    );
  }
});

test("gültige Fixtures passieren Schema und 512-Byte-Grenze (W4/K5)", () => {
  for (const f of fixtureFiles.filter((f) => /\.valid/.test(f))) {
    for (const line of readFileSync(join(fixtureDir, f), "utf8").split("\n").filter(Boolean)) {
      assert.ok(Buffer.byteLength(line) <= 512, `${f}: ${Buffer.byteLength(line)} Byte > 512`);
      const parsed = JSON.parse(line) as { type?: string };
      const validate = schemas.get(parsed.type ?? "");
      assert.ok(validate, `${f}: kein Schema für type "${parsed.type}"`);
      assert.ok(validate(parsed), `${f}: ${ajv.errorsText(validate.errors)}`);
    }
  }
});

test("ungültige Fixtures werden abgelehnt — inkl. >512 B, unbekanntem type, fehlendem v", () => {
  const categories = new Set<string>();
  for (const f of fixtureFiles.filter((f) => f.includes(".invalid-"))) {
    categories.add(f.match(/\.invalid-([a-z0-9-]+)\.ndjson$/)?.[1] ?? "?");
    for (const line of readFileSync(join(fixtureDir, f), "utf8").split("\n").filter(Boolean)) {
      const tooLong = Buffer.byteLength(line) > 512;
      let accepted = false;
      if (!tooLong) {
        try {
          const parsed = JSON.parse(line) as { type?: string };
          const validate = schemas.get(parsed.type ?? "");
          accepted = validate ? validate(parsed) : false;
        } catch {
          accepted = false;
        }
      }
      assert.ok(!accepted || tooLong, `${f}: sollte abgelehnt werden, war aber gültig`);
    }
  }
  for (const required of ["oversize", "unknown-type", "missing-v", "wrong-type"]) {
    assert.ok(categories.has(required), `Fixture-Kategorie invalid-${required} fehlt`);
  }
});
