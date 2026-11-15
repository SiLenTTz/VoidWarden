// BUG-0013: Bei jedem Build die SW-Cache-Version neu stempeln. Ein
// byte-verändertes sw.js ist das einzige Signal, das installierte Clients
// sicher zur Aktualisierung bringt — ein vergessener manueller Bump friert
// sonst eingefrorene Kiosk-Instanzen auf altem Stand ein.
import { readFileSync, writeFileSync } from "node:fs";

/** Ersetzt die CACHE-Zeile in einem sw.js-Inhalt durch einen UTC-Stempel. */
export function bump(content, stamp) {
  const re = /const CACHE = "nyx-shell-v[^"]*";.*$/m;
  if (!re.test(content)) throw new Error("CACHE-Zeile nicht gefunden");
  return content.replace(re, `const CACHE = "nyx-shell-v${stamp}"; // build-stamp (BUG-0013): Deployments erreichen Clients beim naechsten Start`);
}

if (process.argv[1]?.endsWith("bump-sw.mjs")) {
  const file = new URL("../public/sw.js", import.meta.url).pathname;
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  writeFileSync(file, bump(readFileSync(file, "utf8"), stamp));
}
