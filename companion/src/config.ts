/**
 * Config-Laden (EPIC-P1 T1.6, spec.md §8): `voidwarden.config.json` (echte
 * Datei git-ignored), Validierung gegen das Zod-Modell, das
 * `protocol/config.schema.json` abbildet (Contract-Test prüft das Beispiel
 * gegen beide). Token nur als Datei-Referenz, nie im JSON.
 */
import { readFileSync, statSync } from "node:fs";
import { z } from "zod";

export const ConfigSchema = z.object({
  hub: z.object({
    url: z.string().regex(/^https?:\/\//),
    tokenFile: z.string().min(1),
    decideTokenFile: z.string().min(1).optional(), // EPIC-P3/AV-D1: display:<name>
  }),
  serial: z.object({
    path: z.string().min(1),
    baud: z.number().int().min(1200).default(921600),
  }),
  heartbeat: z
    .object({
      intervalMs: z.number().int().min(250).default(5000),
      timeoutMs: z.number().int().min(1000).default(15000),
    })
    .default({ intervalMs: 5000, timeoutMs: 15000 }),
  poll: z
    .object({ intervalMs: z.number().int().min(250).default(1500) })
    .default({ intervalMs: 1500 }),
  /** EPIC-P10 T10.3: opt-in Web-Frontend (WS-Export + statische PWA-Auslieferung). */
  web: z
    .object({
      enabled: z.boolean().default(false),
      port: z.number().int().min(1).max(65535).default(8791),
      /** Bindung: 127.0.0.1 (Default) oder eine LAN-Adresse. "0.0.0.0" nur mit optInAllInterfaces=true. */
      host: z.string().min(1).default("127.0.0.1"),
      optInAllInterfaces: z.boolean().default(false),
      /** Decide-Proxy-Token (display:<name>, Modus 600); ohne ihn bleibt der Web-Client read-only. */
      decideTokenFile: z.string().min(1).optional(),
      /** Verzeichnis der gebauten PWA (web/dist); fehlt es, serviert der Server nur den WS. */
      staticDir: z.string().min(1).optional(),
      /** P10-Retro: Idle-Ticker des Kiosk abschaltbar, ohne das ganze Web-Modul zu deaktivieren. */
      idleTickerEnabled: z.boolean().default(true),
    })
    .default({ enabled: false, port: 8791, host: "127.0.0.1", optInAllInterfaces: false, idleTickerEnabled: true }),
  /** EPIC-P11 T11.5: Nyx-Stimme — lokaler Kokoro-TTS + Ghost-Post-Processing. */
  voice: z
    .object({
      enabled: z.boolean().default(false),
      /** Kokoro-Server (POST /tts). Default lokal; das echte Setup steht in voidwarden.config.json. */
      url: z.string().regex(/^https?:\/\//).default("http://127.0.0.1:8797/tts"),
      speed: z.number().min(0.5).max(2).default(1.05),
      /** Ghost-Pitch in Halbtönen (negativ = tiefer). */
      pitchSemitones: z.number().min(-12).max(0).default(-2.5),
      /** Ziel-Tempo nach Pitch-Trick. */
      tempo: z.number().min(0.5).max(1.5).default(0.95),
      timeoutMs: z.number().int().min(1000).max(120_000).default(30_000),
      /** Ereignisse, die Sprache auslösen (Epic §2: Statuswechsel + Attention). */
      onEvents: z.array(z.enum(["state_change", "attention"])).default(["state_change", "attention"]),
    /** T11.14: Sprache der Nyx-Stimme ("de" | "en"). */
    lang: z.enum(["de", "en"]).default("de"),
    })
    .default({ enabled: false, url: "http://127.0.0.1:8797/tts", speed: 1.05, pitchSemitones: -2.5, tempo: 0.95, timeoutMs: 30_000, onEvents: ["state_change", "attention"], lang: "de" }),
  ui: z
    .object({
      dimAfterS: z.number().min(0).default(60),
      criticalActions: z.array(z.string().min(1)).default([]),
      /** Rückfallzeit nach manuellem Session-Wechsel (ADR-0009). */
      focusHoldS: z.number().min(0).default(30),
      /** T13.5/ADR-0012 Punkt 6: Freigabe-Geste am Web-Kiosk. Ohne Default —
       * der Schlüssel wird nur gesetzt, wenn der Nutzer ihn wählt; der Web-Client
       * nimmt bei Fehlen "hold". Das Board liest den Schlüssel nicht. */
      approveGesture: z.enum(["tap", "hold"]).optional(),
      /** Idle-Chatter; minGapS >= 60 hält W12 (höchstens 1 automatische Blase je 60 s). */
      chatter: z
        .object({
          enabled: z.boolean().default(true),
          minGapS: z.number().min(60).default(90),
          jitterS: z.number().min(0).default(60),
        })
        .default({ enabled: true, minGapS: 90, jitterS: 60 }),
    })
    .default({ dimAfterS: 60, criticalActions: [], focusHoldS: 30, chatter: { enabled: true, minGapS: 90, jitterS: 60 } }),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(path: string): Config {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  return ConfigSchema.parse(raw);
}

/** Liest den Token aus der referenzierten Datei; Modus muss 600 sein (spec §8/§10). */
export function readToken(tokenFile: string): string {
  const stat = statSync(tokenFile);
  if ((stat.mode & 0o777) !== 0o600) {
    throw new Error(`Token-Datei ${tokenFile} muss Modus 600 haben (ist ${octal(stat.mode)})`);
  }
  return readFileSync(tokenFile, "utf8").trim();
}

function octal(mode: number): string {
  return (mode & 0o777).toString(8);
}
