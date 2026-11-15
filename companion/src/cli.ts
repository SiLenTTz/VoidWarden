/**
 * CLI (EPIC-P1 T1.6): `voidwarden status [--watch] [--json]` — Klartext, `--json` roh; liest den Status-Socket
 * des laufenden Companions (observability.md §4). Start des Companions läuft
 * über `companion/src/main.ts` (wird mit dem Simulator T1.7 verdrahtet).
 */
import { fetchStatus } from "./status-server.ts";
import { formatStatus } from "./status-format.ts";
import { join } from "node:path";

// Gleicher Pfad wie companion/src/main.ts: cwd/data, überschreibbar für Tests.
const SOCK = process.env["VOIDWARDEN_SOCK"] ?? join(process.cwd(), "data", "voidwarden.sock");

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args[0] === "status") {
    const watch = args.includes("--watch");
    const json = args.includes("--json");
    for (;;) {
      const raw = await fetchStatus(SOCK);
      if (raw === null) {
        console.log("voidwarden: läuft nicht (kein Status-Socket in data/)");
        process.exitCode = 1;
      } else {
        console.log(json ? raw.trim() : formatStatus(JSON.parse(raw) as Record<string, unknown>, Date.now()));
      }
      if (!watch) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    return;
  }
  console.log("Nutzung: voidwarden status [--watch] [--json]");
  process.exitCode = 2;
}

void main();
