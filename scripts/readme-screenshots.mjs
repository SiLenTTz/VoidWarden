#!/usr/bin/env node
/**
 * README-Screenshots (EPIC-P14 T14.2): startet den Web-Kiosk gegen einen
 * Demo-AncientVoid-Hub (Dummy-Adapter + synthetische Stand-in-CLIs, temporaere
 * Datenverzeichnisse) und fotografiert den Kiosk mit Playwright — Normalzustand
 * mit Nyx/Kacheln und das Freigabe-Band. Nichts erreicht echte Sessions, den
 * produktiven Hub/Companion des Nutzers oder ein Board.
 *
 * Aufruf: node scripts/readme-screenshots.mjs [AncientVoid-Checkout]
 *   Default: ../AncientVoid (Sibling-Anordnung, siehe README). Der Hub und
 *   Playwright kommen aus dem AncientVoid-Checkout — VoidWarden hat bewusst
 *   keine eigene Browser-Abhängigkeit (ADR-0003).
 * Voraussetzung: gebauter Kiosk (`npm run web:build`).
 * Ausgabe: docs/assets/readme-*.webp — jeder Lauf überschreibt denselben Satz.
 */
import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const avRoot = resolve(process.argv[2] ?? "../AncientVoid");
const repoRoot = resolve(import.meta.dirname, "..");
const OUT = join(repoRoot, "docs/assets");
const WEB_PORT = 8795; // 8791 gehört dem produktiven Dienst — nie anfassen

// Hub + Playwright aus dem AncientVoid-Checkout (strip-types importiert .ts direkt).
// Playwright wird wie bei Node üblich aufwärts gesucht (Worktrees teilen sich die
// node_modules des Haupt-Checkouts); TestHub bleibt an den übergebenen Checkout gebunden.
const { TestHub } = await import(pathToFileURL(join(avRoot, "e2e/support/hub.ts")).href);
const findPlaywright = () => {
  for (let d = avRoot; d !== dirname(d); d = dirname(d)) {
    const p = join(d, "node_modules/playwright/index.mjs");
    if (existsSync(p)) return p;
  }
  throw new Error("playwright nicht gefunden — AncientVoid-Checkout mit npm install?");
};
const { chromium } = await import(pathToFileURL(findPlaywright()).href);

const tmp = mkdtempSync(join(tmpdir(), "voidwarden-shots-"));
mkdirSync(OUT, { recursive: true });

const hub = await TestHub.start();
const log = [];
let companion = null;
const spawnCompanion = () => {
  companion = spawn(process.execPath, [join(repoRoot, "companion/src/run.ts"), "--config", join(tmp, "vw.config.json")], {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "pipe"],
  });
  companion.stdout.on("data", (d) => log.push(d.toString()));
  companion.stderr.on("data", (d) => log.push(d.toString()));
};

const shot = (page, name) => page.screenshot({ path: join(OUT, `${name}.webp`), quality: 88, type: "webp", fullPage: false });

try {
  // agent:-Token (read-only, ADR-0001) direkt über hubctl — nie ein menschliches.
  const agentToken = execFileSync(
    process.execPath,
    [join(avRoot, "apps/hubctl/src/cli.ts"), "token", "issue", "voidwarden", "--agent", "--db", join(hub.dataDir, "hub.db")],
    { encoding: "utf8" },
  ).split("\n").map((l) => l.trim()).find((l) => l && !l.startsWith("token for"));
  writeFileSync(join(tmp, "agent.token"), agentToken, { mode: 0o600 });
  // decideTokenFile muss existieren (Boot-Validierung) — Platzhalter, der Screenshot-
  // Stack entscheidet nichts; echte display:-Token erzeugt der Setup-Wizard.
  writeFileSync(join(tmp, "display.token"), "", { mode: 0o600 });
  writeFileSync(join(tmp, "vw.config.json"), JSON.stringify({
    hub: { url: hub.origin, tokenFile: join(tmp, "agent.token"), decideTokenFile: join(tmp, "display.token") },
    serial: { path: join(tmp, "kein-board"), baud: 921600 }, // kein Board am Screenshot-Stack
    web: { enabled: true, port: WEB_PORT, host: "127.0.0.1", staticDir: join(repoRoot, "web/dist") },
  }, null, 2));

  // Demo-Sessions im Hub: eine läuft, eine wartet auf Freigabe (bleibt offen).
  const running = await hub.createSession({ adapter: "claude", prompt: "Bitte LANGSAM: Migration der Datenbank vorbereiten" });
  const approval = await hub.createSession({ adapter: "claude", prompt: "Bitte WERKZEUG" });
  for (const [id, title] of [[running, "Migration der Datenbank vorbereiten"], [approval, "Tests ergänzen: Adapter-Matrix"]]) {
    const res = await hub.api(`/api/sessions/${id}/meta`, { method: "POST", body: { title } });
    if (res.status !== 200) throw new Error(`rename ${res.status}`);
  }
  // Erst wenn Config und Token stehen: Companion starten (liest beides beim Boot).
  spawnCompanion();
  // Web-Port abwarten (fetch statt goto: Playwright scheitert an sofortigem REFUSED).
  const kiosk = `http://127.0.0.1:${WEB_PORT}/`;
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    try { up = (await fetch(kiosk)).ok; } catch { /* noch nicht da */ }
    if (!up) await new Promise((r) => setTimeout(r, 500));
  }
  if (!up) throw new Error(`Companion-Web-Port ${WEB_PORT} kommt nicht hoch — Companion-Log:\n${log.join("").slice(-3000)}`);

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    locale: "de-DE", timezoneId: "Europe/Berlin", reducedMotion: "reduce",
  });
  const page = await context.newPage();
  try {
    await page.goto(`http://127.0.0.1:${WEB_PORT}/`, { timeout: 15_000 });
  } catch (err) {
    throw new Error(`Kiosk nicht erreichbar (${err.message.split("\n")[0]}) — Companion-Log:\n${log.join("").slice(-3000)}`, { cause: err });
  }
  // Verbunden + Nyx gerendert: #conn zeigt den Zustand, #stage-status den Aggregat.
  await page.locator("#conn").filter({ hasText: /verbunden|online|up/i }).waitFor({ timeout: 20_000 }).catch(async () => {
    throw new Error(`Kiosk nicht verbunden — Companion-Log:\n${log.join("").slice(-3000)}`);
  });
  await page.locator("#nyx-stage-canvas").waitFor();
  await page.waitForTimeout(3000); // Companion pollt im 1,5-s-Takt: Kacheln füllen sich
  await shot(page, "readme-kiosk-412");

  // Freigabe-Band: die WERKZEUG-Session hält eine offene Freigabe (600 s Fenster).
  await page.locator("#approval:not([hidden])").waitFor({ timeout: 15_000 });
  await shot(page, "readme-kiosk-freigabe-412");
  await context.close();
  await browser.close();
  console.log(`ok: 2 Screenshots -> ${OUT}/readme-kiosk-*.webp`);
} finally {
  if (companion) {
    companion.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 300));
    companion.kill("SIGKILL");
  }
  await hub.stop();
  rmSync(tmp, { recursive: true, force: true });
}
