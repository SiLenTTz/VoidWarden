// Logger-Tests (EPIC-P1 T1.6): Redaction ist Pflicht (observability.md §2,
// W9): Token tauchen nirgends im Klartext auf; Payload-Texte nur als Hash.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Logger, redactFields } from "../src/log.ts";

function tempLog() {
  const dir = mkdtempSync(join(tmpdir(), "vw-log-"));
  return { dir, file: join(dir, "companion.jsonl") };
}

test("Redaction: Token-Schlüssel werden durch Hash ersetzt", () => {
  const secret = "bi_SUPERSECRETTOKEN123456";
  const out = redactFields({ authorization: `Bearer ${secret}`, token: secret, nested: { apiKey: secret } }, false);
  const text = JSON.stringify(out);
  assert.ok(!text.includes(secret), "Token darf nicht im Klartext vorkommen (W9)");
  assert.match(out["authorization"] as string, /^\[redacted:[0-9a-f]{12}\]$/);
  assert.match((out["nested"] as Record<string, string>)["apiKey"] as string, /^\[redacted:/);
});

test("Payload-Texte nur als len+sha, mit LOG_PAYLOADS im Klartext", () => {
  const out = redactFields({ title: "Paket installieren", body: "npm exec bild" }, false);
  assert.match(out["title"] as string, /^\[payload len=\d+ sha=[0-9a-f]{12}\]$/);
  const full = redactFields({ title: "Paket installieren" }, true);
  assert.equal(full["title"], "Paket installieren");
});

test("Logger schreibt JSON-Lines mit ts/level/component/msg in Datei und hält Level", () => {
  const { dir, file } = tempLog();
  try {
    const log = new Logger({ file, stdout: false, level: "info", now: () => "2026-11-03T12:00:00.000Z" });
    log.debug("unsichtbar");
    log.warn("sichtbar", { token: "geheim123" });
    const lines = readFileSync(file, "utf8").trim().split("\n");
    assert.equal(lines.length, 1);
    const entry = JSON.parse(lines[0] as string) as Record<string, unknown>;
    assert.equal(entry["level"], "warn");
    assert.equal(entry["ts"], "2026-11-03T12:00:00.000Z");
    assert.ok(!JSON.stringify(entry).includes("geheim123"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Rotation: Datei rotiert bei Grenze und respektiert maxFiles", () => {
  const { dir, file } = tempLog();
  try {
    const log = new Logger({
      file,
      stdout: false,
      level: "info",
      maxFileBytes: 120,
      maxFiles: 2,
      now: () => "2026-11-03T12:00:00.000Z",
    });
    for (let i = 0; i < 30; i++) log.info("zeile " + i);
    assert.ok(existsSync(`${file}.1`), "rotation erzeugt .1");
    assert.ok(!existsSync(`${file}.3`), "maxFiles wird respektiert");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
