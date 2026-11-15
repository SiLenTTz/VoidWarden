#!/usr/bin/env node
/**
 * Nyx-Tour: schaltet alle 7 Zustände + Ticker (inkl. Umlaute) nacheinander
 * durch, damit man sie am Board ansehen kann. Companion-Bridge ohne Hub.
 *   node scripts/nyx-tour.mjs [--sim] [--part2|--taponly] [--hold=6] [--path=/dev/ttyUSB0]
 * --part2: nur der interaktive Teil (Blase, Frage, Chatter, Tap-Status, Fokus).
 * --sim: gegen FakeDevice (MemoryLink) statt echtem Board (Trockenlauf).
 * Zweiter Teil (ADR-0009): Sprechblase mit Typewriter, Freigabe-Buttons, offene Frage, Idle-Chatter,
 * Tap-Status und Session-Wechsel mit Auto-Fokus. Am Board tippst du selbst (Nyx, Indikator oben
 * rechts); im --sim-Lauf tippt das FakeDevice und der Lauf listet die empfangenen Frames.
 */
import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { MemoryLink } from "../companion/src/link.ts";
import { FakeDevice } from "../companion/src/sim.ts";
import { Bridge } from "../companion/src/bridge.ts";
import { RealClock } from "../companion/src/clock.ts";
import { aggregate } from "../companion/src/aggregate.ts";
import { Interaction } from "../companion/src/interaction.ts";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  }),
);
const holdMs = Number(args.hold ?? 6) * 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const T = () => String(Date.now() - t0).padStart(6);
const log = (msg, f) => console.log(`[bridge] ${msg} ${JSON.stringify(f ?? {})}`);

let link;
let device = null;
if (args.sim) {
  const [a, b] = MemoryLink.pair();
  link = a;
  device = new FakeDevice({ link: b });
} else {
  const { SerialLink } = await import("../companion/src/serial-link.ts");
  // SerialPort.list() übersieht manche USB-UART-Bridges; /dev direkt ist robuster.
  const found = readdirSync("/dev").find((n) => /^tty(USB|ACM)\d+$/.test(n));
  const path = args.path ?? (found ? `/dev/${found}` : "auto");
  console.log(`Serial: ${path}`);
  link = new SerialLink({ path, baud: 921600, log });
}

const now = () => new Date().toISOString();
const base = (status, extra = {}) => ({ ...aggregate({ sessions: [{ status }], approvals: [], now: now(), hubUp: true }), ...extra });
const approval = () =>
  aggregate({
    sessions: [{ status: "waiting_approval" }],
    approvals: [
      {
        id: randomUUID(),
        sessionId: "tour-session",
        status: "pending",
        class: "write",
        summary: "Datei schreiben: Größenprüfung",
        action: "write src/übung.ts",
        tool: "Edit",
        reasonRequired: false,
        timeoutAt: new Date(Date.now() + 120_000).toISOString(),
      },
    ],
    now: now(),
    hubUp: true,
  });

let latest = base("idle");
let interaction = null;
const bridge = new Bridge({
  link,
  clock: new RealClock(),
  getAggregate: () => latest,
  log,
  onSend: (type) => {
    if (type === "bubble" || type === "session_focus") console.log(`${T()} -> tx ${type}`);
  },
  onDeviceFrame: (f) => {
    // Tour-Diagnose: Berührungen (Firmware-Log mit Rohwerten/Pixeln) und Entscheidungen sichtbar machen.
    if (f.type === "log") console.log(`${T()} <- fw-log[${f.level}] ${f.msg}`);
    if (f.type === "action_response") console.log(`  <- action_response ${f.decision} (${f.ms} ms)`);
    if (f.type === "ui_action") {
      console.log(`${T()} <- ui_action ${f.action}${f.ref ? " " + f.ref : ""}`);
      interaction?.onUiAction({ action: f.action, ref: f.ref }, Date.now());
    }
  },
});
await link.open();
if (device) {
  await device.start();
  device.hello();
}
bridge.start();
console.log("Warte auf hello vom Board (ggf. Reset-Taste drücken) …");
await sleep(2500);

const steps = [
  ["idle", "Nyx ruht (violett, langsam)", () => base("idle")],
  ["listening", "Session arbeitet (cyan, pulsierend)", () => base("working")],
  ["approval_pending", "Freigabe nötig (amber) + Ticker", approval],
  ["executing", "Freigabe bestätigt, läuft (cyan, Ring)", () => ({ ...base("working"), state: "executing" })],
  ["success", "Operation fertig (Cyan-Flash)", () => ({ ...base("working"), state: "success" })],
  ["error", "Session-Fehler (rot, Glitch-Loop)", () => base("error")],
  ["offline", "Hub/Heartbeat weg (schläft, gedimmt)", () => ({ ...base("idle"), state: "offline" })],
  ["idle", "Zurück zu idle", () => base("idle")],
];

for (const [name, desc, make] of args.part2 ? [] : steps) {
  console.log(`\n=== ${name}: ${desc} (${holdMs / 1000}s)`);
  latest = make();
  bridge.onAggregate(latest);
  if (name === "listening") bridge.onNotification("tour", "info", { title: "Ticker-Test", body: "Äpfel, Öl, Übung, Straße — Umlaute ok?" });
  if (name === "error") bridge.onNotification("tour", "error", { title: "Fehler-Ticker", body: "Build fehlgeschlagen: 3 Tests rot" });
  if (name === "success") bridge.onNotification("tour", "success", { title: "Fertig", body: "Alle Gates grün" });
  await sleep(holdMs);
}

// --- Teil 2: interaktiv und session-bewusst (ADR-0009) ----------------------------------
// Chatter-Takt für die Tour verkürzt; produktiv erzwingt das Config-Schema minGapS >= 60 (W12).
interaction = new Interaction(
  {
    setFocus: (v) => bridge.setFocus(v),
    showBubble: (b) => {
      console.log(`  -> Blase ${b.id}: "${b.title}" | ${b.body.slice(0, 60)}`);
      bridge.showBubble(b);
    },
    ackBubble: (id) => bridge.ackBubble(id),
    hasCriticalBubble: () => bridge.hasCriticalBubble(),
  },
  { focusHoldS: 30, tapHoldS: 8, staleAfterS: 30, chatter: { enabled: true, minGapS: 3, jitterS: 2 } },
  Math.random,
  Date.now() - 10_000,
);
const sess = (id, status) => ({ id, status });
const pend = (id, sessionId, tool, summary) => ({
  id,
  sessionId,
  status: "pending",
  class: "write",
  summary,
  action: summary,
  tool,
  reasonRequired: false,
  timeoutAt: new Date(Date.now() + 120_000).toISOString(),
});
const push = (sessions, approvals) => {
  latest = aggregate({ sessions, approvals, now: now(), hubUp: true });
  bridge.onAggregate(latest);
  interaction.onHub({ sessions, approvals, agg: latest, hubUp: true }, Date.now());
};
const scene = async (title, hint, fn, ms = holdMs) => {
  console.log(`\n=== ${title}: ${hint} (${ms / 1000}s)`);
  await fn();
  await sleep(ms);
};

if (args.taponly) {
  // Nur Tap-Diagnose: ein ruhiger Zustand, lange warten, alle Firmware-Logs und ui_actions zeigen.
  console.log(`\n=== TAP-TEST: ${args.wait ?? 90} s lang auf Nyx (Mitte) und auf den Indikator oben rechts tippen`);
  push([sess("tour0001", "working"), sess("tour0002", "idle")], []);
  await sleep(Number(args.wait ?? 90) * 1000);
  console.log("\nTap-Test beendet.");
  bridge.stop();
  device?.stop();
  await link.close?.();
  process.exit(0);
}

await scene("Typewriter-Blase", "Text erscheint Zeichen für Zeichen rechts, Nyx rückt nach links", () => {
  push([sess("tour0001", "idle")], []);
  bridge.showBubble({
    id: "tour-typewriter",
    level: "info",
    title: "Hallo vom Hub",
    body: "Dieser Text tippt sich Zeichen für Zeichen, auch Umlaute: Äpfel, Öl, Übung.",
    holdS: 10,
    ackRequired: false,
  });
}, 12_000);

await scene("Freigabe mit Buttons", "Vollbild FREIGABE, ACCEPT/DECLINE antippen (wirkt am echten Hub)", () =>
  push([sess("tour0001", "waiting_approval")], [pend(randomUUID(), "tour0001", "Edit", "Datei schreiben: Tour")]),
);

await scene("Offene Frage", "Bildschirm FRAGE ohne Buttons: „Am Rechner beantworten“", () =>
  push([sess("tour0001", "waiting_approval")], [pend(randomUUID(), "tour0001", "AskUserQuestion", "Welche Variante nehmen?")]),
);

await scene("Idle-Chatter", "Nyx sagt von selbst einen lokalen Satz (nur im Leerlauf)", async () => {
  push([sess("tour0001", "idle")], []);
}, 0);
{
  const until = Date.now() + 14_000;
  while (Date.now() < until) {
    interaction.tick(Date.now());
    await sleep(1000);
  }
}

await scene("Tap-Status", device ? "FakeDevice tippt auf Nyx" : "TIPPE jetzt auf Nyx: Blase mit Session-Status", () => {
  push([sess("tour0001", "working")], []);
  device?.uiAction("status_tap");
}, 20_000);

await scene("Sessions + Auto-Fokus", "3 Sessions: Indikator 1/3 oben rechts (arbeitet)", () =>
  push([sess("tour0001", "working"), sess("tour0002", "idle"), sess("tour0003", "idle")], []),
);
await scene("Manueller Wechsel", device ? "FakeDevice tippt den Indikator" : "TIPPE auf den Indikator oben rechts", () => {
  device?.uiAction("focus_next");
}, 12_000);
await scene("Auto-Fokus", "Session 3 meldet einen Fehler: Indikator springt auf 3/3 (rot-Symbol x)", () =>
  push([sess("tour0001", "working"), sess("tour0002", "idle"), sess("tour0003", "error")], []),
);
await scene("Freigabe in anderer Session", "Vollbild-Freigabe hat Vorrang vor dem Indikator (fokus-unabhängig)", () =>
  push(
    [sess("tour0001", "working"), sess("tour0002", "idle"), sess("tour0003", "waiting_approval")],
    [pend(randomUUID(), "tour0003", "Edit", "Datei schreiben: Fokus")],
  ),
);
push([sess("tour0001", "idle")], []);
await sleep(2000);

if (device) {
  const n = (t) => device.receivedOfType(t).length;
  console.log(`\nGerät hat empfangen: bubble=${n("bubble")} session_focus=${n("session_focus")} snapshot=${n("snapshot")}`);
  for (const b of device.receivedOfType("bubble")) console.log(`  bubble ${b.level} "${b.payload?.title}" | ${String(b.payload?.body).slice(0, 50)}`);
  for (const f of device.receivedOfType("session_focus")) console.log(`  session_focus ${f.idx}/${f.total} ${f.status} ref=${f.ref}`);
}

console.log(`\nTour fertig. tx=${bridge.counters.tx} rx=${bridge.counters.rx} parse_err=${bridge.counters.parse_err}`);
bridge.stop();
device?.stop();
await link.close?.();
process.exit(0);
