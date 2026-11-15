#!/usr/bin/env node
/**
 * T3.4/T3.9 Handprobe: schickt eine Test-Freigabe (snapshot mit approval, 300 s) an das Board und
 * druckt Touch-Rohwerte und `action_response`. Ohne Hub, ohne Companion — der Companion darf
 * dabei nicht laufen (ein Port). Aufruf: node scripts/hil/approval-demo.mjs [sekunden=120] [port]
 */
import { SerialPort } from "serialport";

const seconds = Number(process.argv[2] ?? 120);
const path = process.argv[3] ?? "/dev/ttyUSB0";
const port = new SerialPort({ path, baudRate: 921600, autoOpen: false });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lines = [];
let buf = "";
port.on("data", (d) => {
  buf += d.toString("latin1");
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const l = buf.slice(0, i);
    buf = buf.slice(i + 1);
    lines.push(l);
    if (/action_response|touch raw|approval|"log"/.test(l)) console.log(new Date().toISOString().slice(11, 19), l);
  }
});
await new Promise((resolve, reject) => port.open((e) => (e ? reject(e) : resolve())));
await port.set({ dtr: false, rts: true });
await sleep(100);
await port.set({ dtr: false, rts: false });
const t0 = Date.now();
while (Date.now() - t0 < 6000 && !lines.some((l) => l.includes('"hello"'))) await sleep(20);
if (!lines.some((l) => l.includes('"hello"'))) console.log("kein hello vom Board (Reset ohne Antwort)");
port.write(
  JSON.stringify({
    v: 1,
    type: "snapshot",
    seq: 1,
    state: "approval_pending",
    sessions: { total: 1, working: 0, waiting: 1, error: 0 },
    approval: {
      action_id: "11111111-1111-4111-8111-111111111111",
      agent_id: "demo",
      class: "write",
      payload: { title: "Datei schreiben README", body: "Demo" },
      timeout_s: 300,
      decidable: true,
    },
    hub: "up",
    ts: new Date().toISOString(),
    utc_offset_min: 60,
  }) + "\n",
);
console.log(`Freigabe gesendet; ${seconds} s Zeit zum Tippen (GENEHMIGEN rechts, ABLEHNEN links)`);
await sleep(seconds * 1000);
await new Promise((r) => port.close(r));
