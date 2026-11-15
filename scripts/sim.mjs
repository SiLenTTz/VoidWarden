#!/usr/bin/env node
/**
 * npm run sim (EPIC-P1 T1.7): Fake-ESP32 gegen den Companion — über MemoryLink,
 * Zustand aus einem Fake-Hub-Zustandsbild (idle→listening). Der Monitor zeigt
 * beide Richtungen; Fehlerinjektion (Müll, Überlänge, unbekannter Typ, Lücke)
 * am Ende. Für Läufe gegen den echten Hub: Companion via voidwarden.config.json
 * starten (T1.8 verdrahtet das).
 */
import { MemoryLink } from "../companion/src/link.ts";
import { FakeDevice } from "../companion/src/sim.ts";
import { Bridge } from "../companion/src/bridge.ts";
import { RealClock } from "../companion/src/clock.ts";
import { decodeLine } from "../companion/src/frames.ts";
import { aggregate } from "../companion/src/aggregate.ts";

function fakeAgg(status, now) {
  return aggregate({ sessions: [{ status }], approvals: [], now, hubUp: true });
}

function fmt(line) {
  const res = decodeLine(line);
  if (!res.ok) return `!! ${res.failure.kind}: ${res.failure.message.slice(0, 60)}`;
  return `${res.frame.type} ${Buffer.byteLength(line)}B`;
}

const monitor = (entry) => {
  const stamp = entry.ts.slice(11, 23);
  console.log(`[${stamp}] ${entry.dir === "rx" ? "ESP<PC" : "ESP>PC"} ${fmt(entry.line)}`);
};

const [companionSide, deviceSide] = MemoryLink.pair();
const clock = new RealClock();
let latest = fakeAgg("idle", new Date().toISOString());
const bridge = new Bridge({
  link: companionSide,
  clock,
  getAggregate: () => latest,
  log: (msg, fields) => console.log(`[bridge] ${msg} ${JSON.stringify(fields ?? {})}`),
});
const device = new FakeDevice({ link: deviceSide, monitor });

await companionSide.open();
await device.start();
bridge.start();
console.log("sim: Companion mit MemoryLink gestartet (Fake-Hub-Zustandsbild)");

device.hello("POWERON_RESET");
await new Promise((r) => setTimeout(r, 300));

latest = fakeAgg("listening", new Date().toISOString());
bridge.onAggregate(latest);
await new Promise((r) => setTimeout(r, 300));

device.stats();
await new Promise((r) => setTimeout(r, 300));

console.log("sim: Fehlerinjektion (Müll, Überlänge, unbekannter Typ, Lücke via resync)");
device.injectGarbage();
device.injectOversize();
device.injectUnknownType();
device.resync(999);
await new Promise((r) => setTimeout(r, 300));

console.log(`sim: parse_err=${bridge.counters.parse_err} rx=${bridge.counters.rx} tx=${bridge.counters.tx}`);
console.log("sim: fertig");
device.stop();
bridge.stop();
