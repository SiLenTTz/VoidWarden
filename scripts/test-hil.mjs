#!/usr/bin/env node
/**
 * test:hil (EPIC-P2 T2.8): HIL-Lauf gegen das echte Board.
 *
 * Ablauf: Port finden → öffnen → 5× Reset über RTS (wie der Smoke-Test im
 * Messlauf 2026-11-03-display-fix) → `hello` ≤ 3 s mit screen 320×240 → Companion-
 * artiger `snapshot` → alle sieben Zustände je 4 s → `stats` (parse_err, rx_overrun,
 * heap_min).
 *
 * Grenzen, bewusst benannt: Dass die Zustände am Display ankommen, zeigt nur ein
 * Foto (AC-P2-1). Der Lauf prüft die Frames, nicht die Pixel. Ohne Board: SKIP.
 * Board da, aber nicht zugänglich: FAIL, nie SKIP (Skip zählt nie als Pass).
 */
import { accessSync, constants, readdirSync } from "node:fs";
import { SerialPort } from "serialport";
import { pickBoard } from "./hil/detect.mjs";
import {
  HOLD_MS,
  RESET_COUNT,
  STATES,
  STATS_DEADLINE_MS,
  assessStats,
  findHello,
  lastStatsAfter,
  parseStream,
  screenMatches,
} from "./hil/assess.mjs";

const BAUD = 921600;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function ttyEntries(dirs) {
  const out = [];
  for (const dir of dirs) {
    let names;
    try {
      names = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) out.push({ dir, name });
  }
  return out;
}

const { path, all } = pickBoard(ttyEntries(["/dev"]));
if (!path) {
  console.log("SKIP: kein Board an /dev/ttyUSB* oder /dev/ttyACM* gefunden.");
  process.exit(0);
}
if (all.length > 1) console.log(`hinweis: mehrere Ports (${all.join(", ")}), genommen wird ${path}`);

try {
  accessSync(path, constants.R_OK | constants.W_OK);
} catch (err) {
  console.log(
    `FAIL: Board an ${path} gefunden, aber ohne Zugriff (${err.code}). ` +
      "Benutzer in die Gruppe uucp aufnehmen (sudo usermod -aG uucp $USER, neu anmelden) " +
      "oder eine udev-Regel setzen.",
  );
  process.exit(1);
}

const chunks = [];
const port = new SerialPort({ path, baudRate: BAUD, autoOpen: false });
await new Promise((res, rej) => port.open((e) => (e ? rej(e) : res())));
port.on("data", (buf) => chunks.push({ at: performance.now(), text: buf.toString("utf8") }));

const frames = () => parseStream(chunks).frames;
const send = (obj) =>
  new Promise((res, rej) => port.write(`${JSON.stringify(obj)}\n`, (e) => (e ? rej(e) : res())));

async function waitFor(pred, timeoutMs) {
  const end = performance.now() + timeoutMs;
  while (performance.now() < end) {
    if (pred()) return true;
    await sleep(20);
  }
  return pred();
}

// Beide Leitungen bei jedem Schritt setzen: DTR auf IO0 (low = Download-Modus!),
// RTS auf EN. Ohne dtr-Angabe im zweiten Schritt bootet das Board in den Download-
// Modus (Befund am Board 2026-11-04: boot:0x3 DOWNLOAD_BOOT, kein hello).
async function reset() {
  await new Promise((res, rej) => port.set({ dtr: false, rts: true }, (e) => (e ? rej(e) : res())));
  await sleep(100);
  await new Promise((res, rej) => port.set({ dtr: false, rts: false }, (e) => (e ? rej(e) : res())));
  return performance.now();
}

const checks = [];
const check = (name, ok, detail) => checks.push({ name, ok, detail });
let seq = 0;
const ts = () => new Date().toISOString();

console.log(`HIL: Board ${path}, ${RESET_COUNT} Resets, ${STATES.length} Zustände je ${HOLD_MS / 1000} s`);

const latencies = [];
for (let i = 1; i <= RESET_COUNT; i++) {
  const resetAt = await reset();
  const deadline = resetAt + 3000;
  await waitFor(() => findHello(frames(), resetAt).found || performance.now() > deadline, 3500);
  const hello = findHello(frames(), resetAt);
  check(`Reset ${i}: hello ≤ 3 s`, hello.found, hello.found ? `${hello.latencyMs} ms` : "kein hello");
  if (hello.found) {
    latencies.push(hello.latencyMs);
    check(`Reset ${i}: screen 320×240`, screenMatches(hello.frame), JSON.stringify(hello.frame.screen));
    // Companion-artiger Stand nach hello (ADR-0002: hello löst snapshot aus).
    await send({
      v: 1, type: "snapshot", seq: seq++, state: "idle",
      sessions: { total: 0, working: 0, waiting: 0, error: 0 },
      approval: null, hub: "up", ts: ts(),
    });
  }
}

console.log("HIL: Zustandsdurchlauf (Sichtprüfung am Display nötig)");
const stateStart = performance.now();
for (const state of STATES) {
  await send({ v: 1, type: "state_change", seq: seq++, state });
  console.log(`  -> ${state}`);
  await sleep(HOLD_MS);
}
check("Zustandsdurchlauf gesendet", true, `${STATES.length} state_change, seq bis ${seq - 1}`);

const gotStats = await waitFor(() => lastStatsAfter(frames(), stateStart) !== null, STATS_DEADLINE_MS);
const stats = lastStatsAfter(frames(), stateStart);
check("stats innerhalb 35 s", gotStats, gotStats ? `uptime ${stats.uptime_s} s` : "kein stats");
if (stats) for (const c of assessStats(stats)) check(c.name, c.ok, c.detail);

port.close();

const parsed = parseStream(chunks);
console.log(`HIL: ROM-Präfix vor JSON: ${parsed.romPrefix} Zeile(n), kaputtes JSON: ${parsed.junk} (T2.9)`);
if (latencies.length) {
  console.log(`HIL: reset→hello: min ${Math.min(...latencies)} ms, max ${Math.max(...latencies)} ms`);
}
for (const c of checks) console.log(`${c.ok ? "PASS" : "FAIL"}: ${c.name} — ${c.detail}`);
const failed = checks.filter((c) => !c.ok).length;
console.log(failed ? `HIL: ${failed} Prüfung(en) rot` : "HIL: alle automatischen Prüfungen grün — Foto-Abnahme AC-P2-1 steht aus");
process.exit(failed ? 1 : 0);
