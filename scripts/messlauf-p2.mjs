#!/usr/bin/env node
/**
 * Messlauf W3/AC-P2-5 am Board (EPIC-P2 T2.7): schaltet die sieben Nyx-Zustände im
 * Takt durch (je 4 s, mit Heartbeat), schreibt alle Frames mit und legt Roh-Frames
 * (data/messlauf/) und Bericht (docs/messlauf/) ab. Ablauf und Pflichtfelder:
 * Skill `messlauf`. Aufruf: node scripts/messlauf-p2.mjs [Minuten=30]
 * Ohne Board: sichtbarer SKIP (kein Messlauf). Flasht nie.
 */
import { accessSync, constants, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { SerialPort } from "serialport";
import { pickBoard } from "./hil/detect.mjs";
import { STATES, findHello, parseStream, summarizeSoak } from "./hil/assess.mjs";

const MINUTES = Number(process.argv[2] ?? 30);
const HOLD_MS = 4000;
// In 20-ms-Schritten warten: mit einem einzigen langen Timer lieferte serialport die Bytes am Board
// erst, wenn der Timer ablief (Befund 2026-11-04; ein Reset-Lauf sah das hello 3 s zu spät).
const sleep = async (ms) => {
  const until = performance.now() + ms;
  while (performance.now() < until) await new Promise((r) => setTimeout(r, 20));
};
const { path } = pickBoard(readdirSync("/dev").map((name) => ({ dir: "/dev", name })));
if (!path) {
  console.log("SKIP: kein Board an /dev/ttyUSB* oder /dev/ttyACM*, kein Messlauf.");
  process.exit(0);
}
try {
  accessSync(path, constants.R_OK | constants.W_OK);
} catch (err) {
  console.log(`FAIL: ${path} ohne Zugriff (${err.code}); Gruppe uucp nötig.`);
  process.exit(1);
}

const chunks = [];
const port = new SerialPort({ path, baudRate: 921600, autoOpen: false });
await new Promise((res, rej) => port.open((e) => (e ? rej(e) : res())));
port.on("data", (b) => chunks.push({ at: performance.now(), text: b.toString("utf8") }));
const setLines = (rts) => new Promise((res, rej) => port.set({ dtr: false, rts }, (e) => (e ? rej(e) : res())));
const send = (o) => new Promise((res, rej) => port.write(`${JSON.stringify(o)}\n`, (e) => (e ? rej(e) : res())));

// Der erste Reset nach dem Öffnen liefert am Board manchmal keine Bytes (offener Befund,
// EPIC-P2 T2.9): bis zu drei Versuche, jeder wird im Bericht gezählt.
let hello = { found: false };
let attempts = 0;
while (!hello.found && attempts < 3) {
  attempts++;
  await setLines(true);
  await sleep(100);
  await setLines(false);
  const resetAt = performance.now();
  await sleep(3000);
  hello = findHello(parseStream(chunks).frames, resetAt);
}
if (!hello.found) {
  port.close();
  console.log("FAIL: kein hello nach 3 Resets, Lauf abgebrochen.");
  process.exit(1);
}

const git = (...a) => execFileSync("git", a, { encoding: "utf8" }).trim();
// Stand beim Start festhalten: Während des Laufs darf weitergearbeitet werden.
const commit = git("rev-parse", "--short", "HEAD");
const dirty = git("status", "--porcelain", "--untracked-files=no") !== "";
const startedAt = new Date();
const end = performance.now() + MINUTES * 60_000;
let seq = 0;
let lastHeartbeat = 0;
console.log(`Messlauf W3: ${MINUTES} min, ${path}, Start ${startedAt.toISOString()}`);
await send({ v: 1, type: "snapshot", seq: seq++, state: "idle", sessions: { total: 0, working: 0, waiting: 0, error: 0 }, approval: null, hub: "up", ts: startedAt.toISOString() });
let i = 0;
while (performance.now() < end) {
  const state = STATES[i++ % STATES.length];
  await send({ v: 1, type: "state_change", seq: seq++, state });
  const until = performance.now() + HOLD_MS;
  while (performance.now() < until) {
    if (performance.now() - lastHeartbeat > 5000) {
      lastHeartbeat = performance.now();
      await send({ v: 1, type: "heartbeat", seq: seq++, ts: new Date().toISOString(), hub: "up" });
    }
    await sleep(100);
  }
}
await sleep(1000);
port.close();

const parsed = parseStream(chunks);
const sum = summarizeSoak(parsed.frames, Math.max(1, Math.floor((MINUTES * 60) / 30) - 2));
const day = startedAt.toISOString().slice(0, 10);
mkdirSync("data/messlauf", { recursive: true });
writeFileSync(`data/messlauf/${day}-p2-w3.ndjson`, parsed.frames.map((e) => JSON.stringify(e.frame)).join("\n") + "\n");
const pass = sum.checks.every((c) => c.ok);
const report = `# Messlauf P2: W3 und Heap im Dauerlauf (T2.7)

Datum: ${startedAt.toISOString()}. Bezug: EPIC-P2 T2.7, AC-P2-2, AC-P2-5, W3 (K3-Bezug laut spec §9).
Commit beim Start: ${commit} (Arbeitsbaum ${dirty ? "mit Änderungen" : "sauber"}).

## Prüfstand und Methode

Rechner: ${process.platform}, Node ${process.version}. Board: ESP32-2432S028R (ESP32-D0WD-V3, 4 MB Flash, kein PSRAM),
ILI9341 320×240, CH340 an \`${path}\`, 921600 Baud. Firmware wie auf dem Board geflasht (siehe Commit; das Flashen
ist nicht Teil des Skripts). Kein Hub, kein Companion: das Skript schickt \`state_change\` im Takt von ${HOLD_MS / 1000} s
(Reihenfolge ${STATES.join(", ")}) plus Heartbeat alle 5 s. Dauer ${MINUTES} min. Reset-Versuche bis hello: ${attempts}. Kommando: \`node scripts/messlauf-p2.mjs ${MINUTES}\`.
Rohframes: \`data/messlauf/${day}-p2-w3.ndjson\` (git-ignoriert). Messgröße: \`stats.fps\` aus dem gleitenden 5-s-Fenster (T2.10),
\`stats\` alle 30 s; Frame-Ceiling nur als \`log\`-Warnung (\`frame_ueber_80ms\`).

## Ergebnisse

- stats-Samples: ${sum.stats}; fps min ${sum.fpsMin ?? "n/a"}, Median ${sum.fpsMedian ?? "n/a"} (Streuung: min bis Median).
- heap_min über den Lauf: ${sum.heapMin ?? "n/a"} B.
- Warnungen: Frame > 80 ms ${sum.frameWarnings}, fps < 25 ${sum.fpsWarnings}. ROM-Präfix-Zeilen: ${parsed.romPrefix}, kaputtes JSON: ${parsed.junk}.

${sum.checks.map((c) => `- ${c.ok ? "PASS" : "FAIL"}: ${c.name} (${c.detail})`).join("\n")}

Urteil: ${pass ? "alle Prüfungen grün" : "mindestens eine Prüfung rot"} (W3, AC-P2-2, AC-P2-5).

## Was das nicht sagt

- Nicht, wie Nyx aussieht (Foto-Abnahme AC-P2-1 steht aus), und nicht, dass jeder Zustand am Panel ankommt.
- \`stats.fps\` ist ein Fenstermittel (5 s) alle 30 s; ein einzelner Ausreißer-Frame zeigt sich nur über die \`log\`-Warnung,
  die der Ringpuffer (5/s) begrenzt.
- Ohne Touch, ohne Ticker-Text, ohne echten Companion/Hub: spätere Epics bringen Last dazu (W3 wird in P5 T5.10 mit
  Komposition neu belegt).
`;
mkdirSync("docs/messlauf", { recursive: true });
const out = `docs/messlauf/${day}-p2-w3.md`;
writeFileSync(out, report);
console.log(report.split("## Ergebnisse")[1].split("## Was das")[0]);
console.log(`Bericht: ${out}`);
process.exit(pass ? 0 : 1);
