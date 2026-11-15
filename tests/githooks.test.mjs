// AC-P0-3: der commit-msg-Hook lehnt ungültige Notation ab (EPIC-P0 T0.2).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const hook = join(import.meta.dirname, "..", ".githooks", "commit-msg");

function runHook(subject) {
  const dir = mkdtempSync(join(tmpdir(), "vw-hook-"));
  const file = join(dir, "msg");
  writeFileSync(file, `${subject}\n`);
  const res = spawnSync(process.execPath, [hook, file], { encoding: "utf8" });
  rmSync(dir, { recursive: true, force: true });
  return res;
}

test("commit-msg akzeptiert korrekte Notation", () => {
  const res = runHook("^ F protocol: Snapshot-Frame kodieren");
  assert.equal(res.status, 0, res.stderr);
});

test("commit-msg lehnt Subject ohne Notation ab (AC-P0-3)", () => {
  const res = runHook("heartbeat gefixt");
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /Commit-Notation/);
});
