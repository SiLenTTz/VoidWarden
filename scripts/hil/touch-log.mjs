#!/usr/bin/env node
/**
 * T3.8 Punktraster-Hilfe: liest `log`-Zeilen "touch raw=… px=…" vom Board und gibt sie aus.
 * Aufruf: node scripts/hil/touch-log.mjs [sekunden=60] [port]. Berührt wird von Hand; die
 * Ausgabe (Rohwerte je Eckpunkt) kommt in den Messlauf-Bericht, nicht ins Repo-Log.
 */
import { SerialPort } from "serialport";

const seconds = Number(process.argv[2] ?? 60);
const path = process.argv[3] ?? "/dev/ttyUSB0";
const port = new SerialPort({ path, baudRate: 921600, autoOpen: false });
let buf = "";
port.on("data", (d) => {
  buf += d.toString("latin1");
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    const m = /touch raw=(-?\d+),(-?\d+) px=(-?\d+),(-?\d+)/.exec(line);
    if (m) console.log(`touch raw=(${m[1]},${m[2]}) px=(${m[3]},${m[4]})`);
  }
});
await new Promise((resolve, reject) => port.open((e) => (e ? reject(e) : resolve())));
console.log(`höre ${seconds} s auf Berührungen (${path}) …`);
await new Promise((r) => setTimeout(r, seconds * 1000));
await new Promise((r) => port.close(r));
