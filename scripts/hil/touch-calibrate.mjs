#!/usr/bin/env node
/**
 * T3.8/T3.7 Touch am Board: geführte Fünf-Punkt-Kalibrierung und Trefferprobe der Flächen.
 *   node scripts/hil/touch-calibrate.mjs            # Kalibrierung: 5 Punkte × 2 Taps
 *   node scripts/hil/touch-calibrate.mjs --verify   # Trefferprobe: Nyx, Indikator, ACCEPT, DECLINE je 5 Taps
 * Stoppt den Dienst `voidwarden` für die Dauer (Port gehört dem Skript) und startet ihn danach wieder.
 * Ergebnis ist nur eine Ausgabe: die Konstanten für `kTouchCal` in firmware/src/main.cpp trägst du
 * (oder ich) von Hand ein, danach flashen und mit --verify gegenprüfen.
 */
import { execFileSync } from "node:child_process";
import { SerialPort } from "serialport";
import { CAL_TARGETS, solveCalibration } from "../../companion/src/touch-calibration.ts";

const verify = process.argv.includes("--verify");
const path = process.argv.find((a) => a.startsWith("--path="))?.slice(7) ?? "/dev/ttyUSB0";
const SCREEN = { w: 320, h: 240 };
const ZONES = [
  { name: "Nyx (Mitte des Bildes)", x: 64, y: 12, w: 192, h: 192 },
  { name: "Indikator oben rechts", x: 272, y: 0, w: 48, h: 44 },
  { name: "DECLINE (links unten)", x: 10, y: 150, w: 140, h: 80 },
  { name: "ACCEPT (rechts unten)", x: 170, y: 150, w: 140, h: 80 },
];

const sh = (...a) => {
  try {
    return execFileSync("systemctl", ["--user", ...a], { encoding: "utf8" }).trim();
  } catch (e) {
    return String(e.stdout ?? "").trim();
  }
};
const serviceWasActive = sh("is-active", "voidwarden.service") === "active";
const restore = () => {
  if (serviceWasActive) sh("start", "voidwarden.service");
};
process.on("SIGINT", () => {
  restore();
  process.exit(130);
});
if (serviceWasActive) {
  console.log("Dienst voidwarden wird für die Messung gestoppt …");
  sh("stop", "voidwarden.service");
}

const port = new SerialPort({ path, baudRate: 921600, autoOpen: false });
const presses = [];
let waiter = null;
let buf = "";
port.on("data", (d) => {
  buf += d.toString("latin1");
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    const m = /touch raw=(-?\d+),(-?\d+) px=(-?\d+),(-?\d+)/.exec(line);
    if (!m) continue;
    const p = { raw: { x: +m[1], y: +m[2] }, px: { x: +m[3], y: +m[4] }, at: Date.now() };
    if (waiter) {
      const w = waiter;
      waiter = null;
      w(p);
    } else presses.push(p);
  }
});

let lastAt = 0;
function nextPress() {
  presses.length = 0;
  return new Promise((resolve) => {
    const arm = () => {
      waiter = (p) => {
        if (p.at - lastAt < 700) return arm(); // Prellen/Doppelmeldung derselben Berührung
        lastAt = p.at;
        resolve(p);
      };
    };
    arm();
  });
}

try {
  await new Promise((res, rej) => port.open((e) => (e ? rej(e) : res())));
  console.log("Tippe einmal irgendwo auf das Display, falls es gedimmt ist (weckt nur).\n");
  await new Promise((r) => setTimeout(r, 1500));

  if (!verify) {
    const samples = [];
    for (const t of CAL_TARGETS) {
      const taps = [];
      for (let k = 1; k <= 2; k++) {
        console.log(`Punkt ${CAL_TARGETS.indexOf(t) + 1}/5: ${t.name} — Tap ${k}/2 so nah wie möglich an der Ecke bzw. Mitte`);
        taps.push(await nextPress());
      }
      samples.push({ target: t, raw: { x: (taps[0].raw.x + taps[1].raw.x) / 2, y: (taps[0].raw.y + taps[1].raw.y) / 2 } });
    }
    const { cal, maxErrorPx } = solveCalibration(samples, SCREEN);
    console.log(`\nRest-Fehler max ${maxErrorPx.toFixed(1)} px ${maxErrorPx > 8 ? "(zu groß: Punkte erneut messen)" : "(ok)"}`);
    console.log("In firmware/src/main.cpp eintragen:");
    console.log(`constexpr vw::TouchCalibration kTouchCal = {${cal.rawXMin}, ${cal.rawXMax}, ${cal.rawYMin}, ${cal.rawYMax}, ${cal.swapXY}, ${cal.invertX}, ${cal.invertY}, 320, 240};`);
  } else {
    let total = 0;
    let hits = 0;
    for (const z of ZONES) {
      let zoneHits = 0;
      for (let k = 1; k <= 5; k++) {
        console.log(`${z.name}: Tap ${k}/5 in die Mitte der Fläche`);
        const p = await nextPress();
        const hit = p.px.x >= z.x && p.px.x < z.x + z.w && p.px.y >= z.y && p.px.y < z.y + z.h;
        zoneHits += hit ? 1 : 0;
        console.log(`  px=(${p.px.x},${p.px.y}) ${hit ? "Treffer" : "DANEBEN"}`);
      }
      total += 5;
      hits += zoneHits;
      console.log(`  → ${zoneHits}/5\n`);
    }
    console.log(`Gesamt ${hits}/${total} Treffer. Jeder Fehltreffer auf ACCEPT/DECLINE gehört ins Fehltouch-Protokoll (T3.7).`);
  }
} finally {
  await new Promise((r) => port.close(() => r()));
  restore();
}
