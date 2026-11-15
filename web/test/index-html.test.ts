// BUG-0010: DOM-Verdrahtung — jede ID, die main.ts per $("…")/$dialog("…")
// referenziert, muss in index.html existieren. Die Web-Tests sind bewusst
// DOM-frei (AGENTS.md); dieser Test prüft die Verdrahtung als reine
// Text-Abbildung, damit ein Tippfehler im HTML nicht erst am Gerät auffällt.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "../index.html"), "utf8");
const mainTs = readFileSync(join(here, "../src/main.ts"), "utf8");

const idsInHtml = new Set([...html.matchAll(/\bid="([^"]*)"/g)].map((m) => m[1] as string));
const referenced = [
  ...mainTs.matchAll(/\$dialog\("([a-z0-9-]+)"\)|\$\("([a-z0-9-]+)"\)/g),
].map((m) => (m[1] ?? m[2]) as string);

test("BUG-0010: index.html deklariert jede von main.ts referenzierte Element-ID", () => {
  assert.ok(referenced.length > 0, "main.ts referenziert keine IDs — Regex kaputt?");
  for (const id of referenced) {
    assert.ok(idsInHtml.has(id), `id="${id}" wird in main.ts benutzt, fehlt in index.html (vorhanden: ${[...idsInHtml].join(", ")})`);
  }
});
