#!/usr/bin/env node
/**
 * Messlauf P1 (T1.8): recovery (W5), hubdown (W6), Hub-Last 30 ev/s (W2),
 * Ressourcen im Idle (W7) — Companion über MemoryLink gegen einen steuerbaren
 * Fake-Hub (node:http). Echte Millisekunden (RealClock), Ergebnis nach
 * docs/messlauf/2026-11-03-p1-companion.md übernehmen.
 */
import { createServer } from "node:http";
import { performance } from "node:perf_hooks";
import { MemoryLink } from "../companion/src/link.ts";
import { FakeDevice } from "../companion/src/sim.ts";
import { startCompanion } from "../companion/src/main.ts";
import { decodeLine } from "../companion/src/frames.ts";

// --- Fake-Hub ---------------------------------------------------------------
class FakeHub {
  constructor(port) {
    this.port = port;
    this.status = "idle"; // Session-Status der einen Fake-Session
    this.server = null;
    this.up = false;
    this.notifications = []; // {id, sessionId, level, title, detail, createdAt}
    this.nextNotifId = 1;
    this.emitNotifications = false;
  }
  /** Emittiert count Notification-Events in die Liste (Hub-Last). */
  emitNotificationBurst(count) {
    for (let i = 0; i < count; i++) {
      this.notifications.push({
        id: this.nextNotifId++,
        sessionId: "fake-1",
        level: "info",
        title: "Last-Ereignis " + this.nextNotifId,
        detail: null,
        createdAt: new Date().toISOString(),
      });
    }
    if (this.notifications.length > 500) this.notifications = this.notifications.slice(-500);
  }
  async start() {
    this.server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://fake");
      res.setHeader("content-type", "application/json");
      if (url.pathname === "/api/sessions") {
        res.end(JSON.stringify([{ id: "fake-1", status: this.status, archived: false }]));
      } else if (url.pathname === "/api/approvals") {
        res.end(JSON.stringify([]));
      } else if (url.pathname === "/api/notifications") {
        const limit = Number(url.searchParams.get("limit") ?? 10);
        res.end(JSON.stringify(this.notifications.slice(-limit)));
      } else if (url.pathname === "/api/health" || url.pathname === "/api/ready") {
        res.end(JSON.stringify({ ok: true }));
      } else {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: "not found" }));
      }
    });
    await new Promise((r) => this.server.listen(this.port, r));
    this.up = true;
  }
  async stop() {
    this.up = false;
    if (this.server) await new Promise((r) => this.server.close(r));
    this.server = null;
  }
}

const PORT = 7391;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.ceil((q / 100) * sorted.length) - 1)];

function framesOfType(device, type) {
  return device.received.filter((l) => {
    const r = decodeLine(l);
    return r.ok && r.frame.type === type;
  });
}

async function buildCompanion() {
  const [companionSide, deviceSide] = MemoryLink.pair();
  const receivedAt = [];
  const device = new FakeDevice({ link: deviceSide, monitor: (e) => { receivedAt.push({ line: e.line, at: performance.now() }); } });
  device.receivedAt = receivedAt;
  await device.start();
  const runtime = await startCompanion({
    configPath: "voidwarden.config.messlauf.json",
    linkOverride: companionSide,
  });
  return { device, runtime };
}

const results = { recovery: [], hubdown: [], load: null, resources: null };

// --- Szenario 1: Recovery (W5/AC-P1-3), je 5 Läufe --------------------------
const hub = new FakeHub(PORT);

// Config für den Messlauf (eigene Datei, zeigt auf Fake-Hub)
const { writeFileSync, rmSync, readFileSync } = await import("node:fs");
writeFileSync(
  "voidwarden.config.messlauf.json",
  JSON.stringify(
    {
      hub: { url: `http://127.0.0.1:${PORT}`, tokenFile: "data/agent-token.txt" },
      serial: { path: "auto", baud: 921600 },
      poll: { intervalMs: 500 },
    },
    null,
    2,
  ),
);

await hub.start();
hub.status = "working";

// 1a: ESP-Reset (hello nach Reconnect) → snapshot ≤ 3 s
for (let i = 0; i < 5; i++) {
  const { device, runtime } = await buildCompanion();
  await sleep(1200); // erster Poll
  const t0 = performance.now();
  device.hello("SW_RESET");
  await sleep(50);
  const snap = framesOfType(device, "snapshot");
  const dt = snap.length > 0 ? performance.now() - t0 : Infinity;
  results.recovery.push({ case: "esp_reset", run: i + 1, ms: Math.round(dt) });
  await runtime.stop();
}
rmSync("data/voidwarden.sock", { force: true });

// 1b: Hub-Restart → erster hub:up-Heartbeat ≤ 3 s nach Rückkehr
for (let i = 0; i < 5; i++) {
  const { device, runtime } = await buildCompanion();
  await sleep(1000);
  await hub.stop();
  await sleep(2500); // 2 Folgehfehler → down
  hub.status = "working";
  const watermark = device.received.length; // nur Frames danach zählen
  const t0 = performance.now();
  await hub.start();
  const deadline = t0 + 5000;
  let ms = Infinity;
  while (performance.now() < deadline) {
    await sleep(50);
    // Kriterium (W5): Zustand wieder identisch — offline -> listening als state_change NACH dem Restart
    const recovered = device.received.slice(watermark).some((l) => {
      const f = decodeLine(l);
      return f.ok && f.frame.type === "state_change" && f.frame.state === "listening";
    });
    if (recovered) {
      ms = performance.now() - t0;
      break;
    }
  }
  results.recovery.push({ case: "hub_restart", run: i + 1, ms: Math.round(ms) });
  await runtime.stop();
  await hub.stop();
  await hub.start();
  rmSync("data/voidwarden.sock", { force: true });
}

// --- Szenario 1c: Companion-Neustart → Zustand wieder da ≤ 3 s (AC-P1-3) -----
{
  for (let i = 0; i < 5; i++) {
    const first = await buildCompanion();
    await sleep(800);
    await first.runtime.stop(); // Companion "crasht"
    rmSync("data/voidwarden.sock", { force: true });
    const t0 = performance.now();
    const second = await buildCompanion(); // frischer Prozess-Zustand, neues Link-Paar
    second.device.hello("SW_RESET"); // Gerät meldet sich nach Link-Wiederkehr
    const deadline = t0 + 5000;
    let ms = Infinity;
    while (performance.now() < deadline) {
      await sleep(20);
      const hit = second.device.received.some((l) => {
        const f = decodeLine(l);
        return f.ok && f.frame.type === "snapshot" && f.frame.state === "listening";
      });
      if (hit) {
        ms = performance.now() - t0;
        break;
      }
    }
    results.recovery.push({ case: "companion_restart", run: i + 1, ms: Math.round(ms) });
    await second.runtime.stop();
    rmSync("data/voidwarden.sock", { force: true });
  }
}

// --- Szenario 2: Hub down → hub:"down" ≤ 10 s (W6/AC-P1-4) ------------------
{
  const { device, runtime } = await buildCompanion();
  await sleep(1000);
  const t0 = performance.now();
  await hub.stop();
  const deadline = t0 + 12000;
  let ms = Infinity;
  while (performance.now() < deadline) {
    await sleep(100);
    const beats = framesOfType(device, "heartbeat");
    const last = beats.at(-1);
    if (last) {
      const f = decodeLine(last);
      if (f.ok && f.frame.hub === "down") {
        ms = performance.now() - t0;
        break;
      }
    }
  }
  results.hubdown = { ms: Math.round(ms), limit_ms: 10000 };
  await runtime.stop();
  rmSync("data/voidwarden.sock", { force: true });
  await hub.start();
}

// --- Szenario 3: 30 ev/s Hub-Last (W2/AC-P1-5) ------------------------------
{
  const { device, runtime } = await buildCompanion();
  await sleep(1000);
  const durationMs = 20000;
  const changes = [];
  const toggler = setInterval(() => {
    hub.status = hub.status === "working" ? "idle" : "working";
    changes.push({ status: hub.status, at: performance.now() });
  }, 1000 / 30); // 30 Wechsel/s
  const framesBefore = device.received.length;
  await sleep(durationMs);
  clearInterval(toggler);
  await sleep(2500); // letzter Poll + Coalesce abwarten
  const frames = device.received.slice(framesBefore);
  const receivedAfter = device.receivedAt;
  const stateChanges = frames.filter((l) => {
    const r = decodeLine(l);
    return r.ok && r.frame.type === "state_change";
  });
  const fps = (frames.length / (durationMs / 1000)).toFixed(2);
  // p95 (W2): Zeit vom letzten Hub-Wechsel bis zum passenden state_change beim Gerät.
  const latencies = [];
  for (const line of stateChanges) {
    const f = decodeLine(line);
    const recv = receivedAfter.find((e) => e.line === line)?.at;
    if (recv === undefined) continue;
    const trigger = changes.filter((c) => c.at <= recv && c.status === f.frame.state).at(-1);
    if (trigger === undefined) continue;
    latencies.push(recv - trigger.at);
  }
  const sorted = [...latencies].sort((a, b) => a - b);
  results.load_raw_p95 = sorted.length > 0 ? Math.round(pct(sorted, 95)) : null;
  results.load = {
    events_per_s: 30,
    duration_s: durationMs / 1000,
    frames_on_link: frames.length,
    frames_per_s: Number(fps),
    state_changes: stateChanges.length,
    latency_p95_ms: sorted.length > 0 ? Math.round(pct(sorted, 95)) : null,
    limit_frames_per_s: 10,
    limit_p95_ms: 2500,
  };
  await runtime.stop();
  rmSync("data/voidwarden.sock", { force: true });
}

// --- Szenario 3b: überlebende Einzel-Änderung unter Dauerlast (W2) -----------
{
  // 30 ev/s Notification-Rauschen (zählt als Hub-Last), aber der Session-Status
  // wechselt nur alle 2 s — so überlebt jede Änderung bis zum Poll und die
  // Latenz ist einzeln messbar (n=10).
  const latencies = [];
  for (let i = 0; i < 10; i++) {
    const { device, runtime } = await buildCompanion();
    hub.status = "idle";
    await sleep(1200);
    // ECHTE Hub-Last: 30 Notification-Events/s parallel zur Messung (Review B1).
    // Der Companion verarbeitet daraus ~20/s (Poll 500 ms × 10 gesehene Events)
    // und stapelt sie in den Ticker — die Messung läuft unter realer Last.
    const noise = setInterval(() => hub.emitNotificationBurst(1), 1000 / 30);
    const watermark = device.received.length;
    const t0 = performance.now();
    hub.status = "working"; // die zu messende Änderung
    const deadline = t0 + 5000;
    let ms = Infinity;
    while (performance.now() < deadline) {
      await sleep(20);
      const hit = device.received.slice(watermark).some((l) => {
        const f = decodeLine(l);
        return f.ok && f.frame.type === "state_change" && f.frame.state === "listening";
      });
      if (hit) {
        ms = performance.now() - t0;
        break;
      }
    }
    latencies.push(ms);
    clearInterval(noise);
    const notesSeen = device.received.slice(watermark).filter((l) => {
      const f = decodeLine(l);
      return f.ok && f.frame.type === "notification";
    }).length;
    results[`notes_run_${i + 1}`] = notesSeen;
    await runtime.stop();
    rmSync("data/voidwarden.sock", { force: true });
  }
  const sorted = [...latencies].sort((a, b) => a - b);
  results.change_latency = {
    runs: latencies.map((m) => Math.round(m)),
    p50_ms: Math.round(pct(sorted, 50)),
    p95_ms: Math.round(pct(sorted, 95)),
    limit_p95_ms: 2500,
    poll_interval_ms: 500,
    hub_load_events_per_s: 30,
  };
}

// --- Szenario 4: Ressourcen im Idle (W7/AC-P1-7) -----------------------------
{
  hub.status = "idle";
  const { runtime } = await buildCompanion();
  await sleep(1000);
  // CPU via /proc/self/stat: process.cpuUsage() meldet unter Node 26.7
  // unrealistische Werte (siehe Messlauf-Bericht) — OS-Wahrheit statt Selbstauskunft.
  const readProcCpu = () => {
    const parts = readFileSync("/proc/self/stat", "utf8").trim().split(" ");
    return { utime: Number(parts[13]), stime: Number(parts[14]) };
  };
  const cpu0 = readProcCpu();
  const t0 = performance.now();
  await sleep(60000);
  const cpu1 = readProcCpu();
  const wallS = (performance.now() - t0) / 1000;
  const cpuPercent = ((cpu1.utime - cpu0.utime + (cpu1.stime - cpu0.stime)) / 100 / wallS) * 100;
  results.resources = {
    idle_s: Math.round(wallS),
    cpu_percent: Number(cpuPercent.toFixed(2)),
    rss_mb: Number((process.memoryUsage().rss / 1024 / 1024).toFixed(1)),
    limit_cpu_percent: 15,
    limit_rss_mb: 150,
    cpu_source: "/proc/self/stat (CLK_TCK=100)",
  };
  await runtime.stop();
  rmSync("data/voidwarden.sock", { force: true });
}

await hub.stop();
rmSync("voidwarden.config.messlauf.json", { force: true });
console.log(JSON.stringify(results, null, 2));
