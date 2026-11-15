/**
 * Betriebs-Einstieg des Companions (EPIC-P4 T4.6, Runbook): `npm run companion [-- --config <Pfad>]`.
 * Startet startCompanion und beendet sauber bei SIGINT/SIGTERM (systemd stoppt mit SIGTERM).
 * Ein Konfigurations- oder Token-Fehler endet sichtbar mit Exit-Code 1, nie still.
 */
import { startCompanion } from "./main.ts";

function configPath(argv: string[]): string {
  const i = argv.indexOf("--config");
  return i >= 0 && argv[i + 1] ? (argv[i + 1] as string) : "voidwarden.config.json";
}

try {
  const running = await startCompanion({ configPath: configPath(process.argv.slice(2)) });
  let stopping = false;
  const stop = (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`voidwarden: ${signal}, fahre herunter`);
    running.stop().then(
      () => process.exit(0),
      (err: unknown) => {
        console.error(`voidwarden: Fehler beim Herunterfahren: ${String(err)}`);
        process.exit(1);
      },
    );
  };
  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));
} catch (err) {
  console.error(`voidwarden: Start fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
