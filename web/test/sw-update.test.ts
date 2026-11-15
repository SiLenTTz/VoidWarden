import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bump } from "../scripts/bump-sw.mjs";

const here = dirname(fileURLToPath(import.meta.url));

test("BUG-0013: bump ersetzt die CACHE-Version durch den Stempel", () => {
  const sw = 'const CACHE = "nyx-shell-v15"; // alt';
  const out = bump(sw, "20261111T2219");
  assert.match(out, /const CACHE = "nyx-shell-v20261111T2219";/);
  assert.doesNotMatch(out, /v15/);
});

test("BUG-0013: bump wirft fail loud, wenn die CACHE-Zeile fehlt", () => {
  assert.throws(() => bump("const KEINE_CACHE = 1;", "x"), /CACHE-Zeile nicht gefunden/);
});

test("BUG-0013-Verdrahtung: App prüft SW-Updates bei Start und Foreground", () => {
  const main = readFileSync(join(here, "../src/main.ts"), "utf8");
  assert.ok(main.includes(".update()"), "registration.update() fehlt");
  assert.ok(main.includes("visibilitychange"), "Foreground-Check fehlt");
  assert.ok(main.includes("controllerchange"), "Reload bei neuem Worker fehlt");
  assert.ok(main.includes("reloadedForNewWorker"), "Reload-Guard gegen Schleife fehlt");
  const sw = readFileSync(join(here, "../public/sw.js"), "utf8");
  assert.match(sw, /const CACHE = "nyx-shell-v/, "sw.js muss versioniert bleiben");
});
