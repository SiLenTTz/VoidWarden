#!/usr/bin/env node
/**
 * check:protocol (EPIC-P0 T0.4) — Fixtures beidseitig prüfbar machen:
 *
 * 1. Node-Seite: jede NDJSON-Zeile in protocol/fixtures/ validiert gegen ihr
 *    JSON-Schema (protocol/schema/frame/<type>.schema.json), Zeilenlänge
 *    ≤ 512 Byte (W4/K5, auf Zeilenebene erzwungen — JSON-Schema sieht serialisierte
 *    Bytes nicht, ADR-0002). Null gefundene Fixtures/Schemas = FAIL, nie still grün.
 * 2. Firmware-Seite: `pio test -e native` (Unity liest dieselben Dateien).
 *    Ohne PlatformIO: sichtbarer SKIP (zählt nie als Pass, docs/testing.md §2.6).
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import Ajv from "ajv";

const SCHEMA_DIR = new URL("../protocol/schema/frame/", import.meta.url).pathname;
const CONFIG_SCHEMA = new URL("../protocol/config.schema.json", import.meta.url).pathname;
const CONFIG_EXAMPLE = new URL("../voidwarden.config.example.json", import.meta.url).pathname;
const FIXTURE_DIR = new URL("../protocol/fixtures/", import.meta.url).pathname;

const failures = [];
const fail = (msg) => failures.push(msg);

// --- Schemas laden (Fail loud, wenn leer) ---
if (!existsSync(SCHEMA_DIR)) fail(`Schema-Verzeichnis fehlt: ${SCHEMA_DIR}`);
const schemaFiles = existsSync(SCHEMA_DIR) ? readdirSync(SCHEMA_DIR).filter((f) => f.endsWith(".schema.json")) : [];
if (schemaFiles.length === 0) fail("keine Frame-Schemas in protocol/schema/frame/ gefunden");
const ajv = new Ajv({ allErrors: true, verbose: true, allowUnionTypes: true });
const schemas = new Map();
for (const f of schemaFiles) {
  const type = f.replace(/\.schema\.json$/, "");
  schemas.set(type, ajv.compile(JSON.parse(readFileSync(join(SCHEMA_DIR, f), "utf8"))));
}

// --- Fixtures prüfen ---
if (!existsSync(FIXTURE_DIR)) fail(`Fixture-Verzeichnis fehlt: ${FIXTURE_DIR}`);
const fixtureFiles = existsSync(FIXTURE_DIR) ? readdirSync(FIXTURE_DIR).filter((f) => f.endsWith(".ndjson")) : [];
if (fixtureFiles.length === 0) fail("keine Fixtures in protocol/fixtures/ gefunden");

const SECRET_RE = /(bearer|token|secret|password|api[-_]?key)/i;
let validCount = 0;
let invalidCount = 0;
const coveredTypes = new Set();

for (const f of fixtureFiles) {
  const m = /^([a-z_]+)\.(valid(?:-[a-z0-9-]+)?|invalid-[a-z0-9-]+)\.ndjson$/.exec(f);
  if (!m) {
    fail(`${f}: Dateiname muss "<type>.valid[-variante]|invalid-<grund>.ndjson" folgen`);
    continue;
  }
  const [, expectedType, klass] = m;
  const expectValid = klass.startsWith("valid");
  const lines = readFileSync(join(FIXTURE_DIR, f), "utf8").split("\n").filter((l) => l.length > 0);
  if (lines.length === 0) fail(`${f}: leer`);
  for (const line of lines) {
    const bytes = Buffer.byteLength(line, "utf8");
    const tooLong = bytes > 512;
    let schemaReject;
    let parsedType = null;
    try {
      const parsed = JSON.parse(line);
      parsedType = typeof parsed?.type === "string" ? parsed.type : null;
      const validate = schemas.get(parsedType);
      schemaReject = validate ? !validate(parsed) : true; // unbekannter type: kein Schema → invalid
    } catch {
      schemaReject = true;
    }
    const rejected = tooLong || schemaReject;

    if (SECRET_RE.test(line)) fail(`${f}: Fixture enthält Verdacht auf Secret (${SECRET_RE.source})`);

    if (expectValid && rejected) {
      fail(`${f}: soll gültig sein, wurde aber abgelehnt (${tooLong ? `${bytes}B > 512B` : "Schema-Verstoß"}) — ${line.slice(0, 80)}`);
    }
    if (!expectValid && !rejected) {
      fail(`${f}: soll ungültig sein (${klass}), passierte aber Größe- und Schema-Prüfung`);
    }
    if (expectValid) {
      validCount++;
      if (parsedType !== expectedType) fail(`${f}: type "${parsedType}" ≠ Dateiname "${expectedType}"`);
      coveredTypes.add(expectedType);
    } else {
      invalidCount++;
    }
  }
}

// --- Abdeckung: je Schema-Typ ≥1 gültiges und ≥1 ungültiges Fixture ---
for (const type of schemas.keys()) {
  const hasInvalid = fixtureFiles.some((f) => f.startsWith(`${type}.invalid-`));
  if (!fixtureFiles.some((f) => f.startsWith(`${type}.valid`))) fail(`kein gültiges Fixture für "${type}"`);
  if (!hasInvalid) fail(`kein ungültiges Fixture für "${type}"`);
}
for (const cat of ["oversize", "unknown-type", "missing-v", "wrong-type"]) {
  if (!fixtureFiles.some((f) => f.includes(`invalid-${cat}`))) fail(`kein Fixture der Kategorie invalid-${cat}`);
}

// --- Config-Beispiel gegen Config-Schema ---
if (existsSync(CONFIG_SCHEMA) && existsSync(CONFIG_EXAMPLE)) {
  const validateConfig = ajv.compile(JSON.parse(readFileSync(CONFIG_SCHEMA, "utf8")));
  const example = JSON.parse(readFileSync(CONFIG_EXAMPLE, "utf8"));
  if (!validateConfig(example)) {
    fail(`voidwarden.config.example.json verstößt gegen config.schema.json: ${ajv.errorsText(validateConfig.errors)}`);
  }
} else {
  fail("config.schema.json oder voidwarden.config.example.json fehlt");
}

// --- WS-Fixtures (EPIC-P10 T10.3): protocol/fixtures/ws/ gegen protocol/schema/ws/ ---
// Kein K5-Zeilenlimit (ADR-0011 §2), gleiche Secret-Regel. Je WS-Schema ≥1 gültige
// und ≥1 ungültige Zeile über alle Dateien zusammen.
const WS_SCHEMA_DIR = new URL("../protocol/schema/ws/", import.meta.url).pathname;
const WS_FIXTURE_DIR = new URL("../protocol/fixtures/ws/", import.meta.url).pathname;
if (existsSync(WS_SCHEMA_DIR)) {
  const wsSchemaFiles = readdirSync(WS_SCHEMA_DIR).filter((f) => f.endsWith(".schema.json"));
  if (wsSchemaFiles.length === 0) fail("WS-Schema-Verzeichnis vorhanden, aber leer");
  const wsSchemas = new Map();
  for (const f of wsSchemaFiles) {
    const type = f.replace(/^web-/, "").replace(/\.schema\.json$/, "");
    // $ref auf web-approval.schema.json auflösen (Ajv braucht die Referenz registriert)
    const raw = JSON.parse(readFileSync(join(WS_SCHEMA_DIR, f), "utf8"));
    if (JSON.stringify(raw).includes("web-approval.schema.json") && !wsSchemas.has("approval")) {
      const approvalSchema = JSON.parse(readFileSync(join(WS_SCHEMA_DIR, "web-approval.schema.json"), "utf8"));
      approvalSchema.$id = "web-approval.schema.json";
      ajv.addSchema(approvalSchema, "web-approval.schema.json");
    }
    wsSchemas.set(type, ajv.compile(raw));
  }
  const wsFixtureFiles = existsSync(WS_FIXTURE_DIR)
    ? readdirSync(WS_FIXTURE_DIR).filter((f) => f.endsWith(".ndjson"))
    : [];
  if (wsFixtureFiles.length === 0) fail("WS-Schema vorhanden, aber keine Fixtures in protocol/fixtures/ws/");
  const wsValidTypes = new Set();
  let wsInvalidSeen = false;
  for (const f of wsFixtureFiles) {
    const expectValid = /\.valid(?:-[a-z0-9-]+)?\.ndjson$/.test(f);
    const lines = readFileSync(join(WS_FIXTURE_DIR, f), "utf8").split("\n").filter((l) => l.length > 0);
    if (lines.length === 0) fail(`ws/${f}: leer`);
    for (const line of lines) {
      if (SECRET_RE.test(line)) fail(`ws/${f}: Fixture enthält Verdacht auf Secret`);
      let reject;
      let parsedType = null;
      try {
        const parsed = JSON.parse(line);
        parsedType = typeof parsed?.type === "string" ? parsed.type : null;
        const validate = wsSchemas.get(parsedType);
        reject = validate ? !validate(parsed) : true;
      } catch {
        reject = true;
      }
      if (expectValid && reject) fail(`ws/${f}: soll gültig sein, wurde abgelehnt — ${line.slice(0, 80)}`);
      if (!expectValid && !reject) fail(`ws/${f}: soll ungültig sein, passierte aber — ${line.slice(0, 80)}`);
      if (expectValid && !reject) wsValidTypes.add(parsedType);
      if (!expectValid && reject) wsInvalidSeen = true;
    }
  }
  for (const type of wsSchemas.keys()) {
    if (type === "approval") continue; // nur $ref-Ziel, keine eigene Zeile
    if (!wsValidTypes.has(type)) fail(`keine gültige WS-Zeile für "${type}"`);
  }
  if (!wsInvalidSeen) fail("keine ungültige WS-Fixture-Zeile");
}

for (const f of failures) console.error(`FAIL: ${f}`);
if (failures.length > 0) process.exit(1);

console.log(`check:protocol — ${validCount} gültige, ${invalidCount} ungültige Zeilen geprüft, ` +
  `${schemas.size} Frame-Typen abgedeckt, Config-Beispiel gültig`);

// --- Firmware-Seite: dieselben Fixtures im native-Env (Unity) ---
const pio = spawnSync("pio", ["test", "-e", "native"], { stdio: "inherit", cwd: new URL("../firmware/", import.meta.url).pathname });
if (pio.error) {
  console.log("SKIP (firmware): PlatformIO nicht gefunden — Unity-Gegenstück nicht gelaufen (zählt nicht als Pass).");
  process.exit(0);
}
process.exit(pio.status ?? 1);
