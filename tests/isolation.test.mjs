// Hub-Isolation (AC-P1-6): der Companion importiert aus AncientVoid ausschließlich
// @ancientvoid/contracts — statisch geprüft über die Quelltexte.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

function tsFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...tsFiles(p));
    else if (/\.(ts|mjs)$/.test(name)) out.push(p);
  }
  return out;
}

const FORBIDDEN = [
  /from\s+["']@ancientvoid\/(?!contracts)/, // andere AncientVoid-Pakete
  /from\s+["']\.\.\/\.\.\/AncientVoid\//, // direkter Quell-Import
  /from\s+["'].*core\//, // AncientVoid-core
];

test("Hub-Isolation: companion/src importiert nur @ancientvoid/contracts", () => {
  const files = [...tsFiles(join(import.meta.dirname, "..", "companion", "src")), join(import.meta.dirname, "..", "scripts", "sim.mjs")];
  const violations = [];
  for (const f of files) {
    const text = readFileSync(f, "utf8");
    for (const re of FORBIDDEN) {
      if (re.test(text)) violations.push(`${f}: ${re}`);
    }
  }
  assert.deepEqual(violations, []);
});

test("Hub-Isolation: keine AncientVoid-Datenpfade im Companion-Quelltext", () => {
  const files = tsFiles(join(import.meta.dirname, "..", "companion", "src"));
  for (const f of files) {
    const text = readFileSync(f, "utf8");
    assert.ok(!text.includes("../AncientVoid/data"), f);
    assert.ok(!/\/AncientVoid\/(data|apps|packages\/(?!contracts))/.test(text), f);
  }
});
