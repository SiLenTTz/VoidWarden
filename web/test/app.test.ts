// App-Klasse (EPIC-P10 T10.4/T10.5): WS-Verbindung, seq-Dedupe (W6),
// Verfall + Ticker über Fake-Uhr/-Timer — kein echtes Netzwerk.
import { test } from "node:test";
import assert from "node:assert/strict";
import { App, type AppCallbacks } from "../src/app.ts";
import type { WebServerFrame, PendingApproval } from "../src/types.ts";

class FakeWs {
  static instances: FakeWs[] = [];
  sent: string[] = [];
  open = false;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  constructor() {
    FakeWs.instances.push(this);
  }
  triggerOpen(): void {
    this.open = true;
    this.onopen?.();
  }
  triggerClose(): void {
    this.open = false;
    this.onclose?.();
  }
  receive(frame: WebServerFrame): void {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.open = false;
  }
}

class FakeTimers {
  handles = new Map<number, () => void>();
  next = 1;
  setTimeout(fn: () => void, ms?: number): unknown {
    const id = this.next++;
    this.handles.set(id, () => {
      this.handles.delete(id);
      fn();
    });
    void ms;
    return id;
  }
  clearTimeout(handle: unknown): void {
    this.handles.delete(handle as number);
  }
  runAll(): void {
    // eine Runde: alle due-Timer ausführen (vereinfacht: alle)
    for (const fn of [...this.handles.values()]) fn();
  }
}

function callbacks(log: string[]): AppCallbacks {
  return {
    onFrame: (f) => log.push(`frame:${f.type}`),
    onOfflineChange: (o) => log.push(`offline:${o}`),
    onTicker: (name) => log.push(`ticker:${name}`),
    onDecayChange: (d) => log.push(`decay:${d}`),
    onAttention: (t) => log.push(`attention:${t}`),
  };
}

const snapFrame = (seq: number, updatedAt: string, approval: PendingApproval | null = null): Extract<WebServerFrame, { type: "snapshot" }> => ({
  type: "snapshot",
  seq,
  ts: "2026-11-06T19:00:00.000Z",
  state: "idle",
  sessions: { total: 1, working: 0, waiting: 0, error: 0 },
  sessionList: [
    { id: "s1", name: "voidwarden", status: "idle", updatedAt, lastActivityAt: null, lastAssistantMessage: "letzte Antwort", attention: false },
  ],
  approval,
  hub: "up",
});

test("App: snapshot wird verarbeitet, veralteter seq ignoriert (W6-Dedupe)", () => {
  const log: string[] = [];
  const timers = new FakeTimers();
  const app = new App(
    { now: () => Date.parse("2026-11-06T19:00:00.000Z"), connectWs: () => new FakeWs() as unknown as WebSocket, setTimeoutFn: timers.setTimeout.bind(timers), clearTimeoutFn: timers.clearTimeout.bind(timers) },
    callbacks(log),
  );
  app.start();
  const ws = FakeWs.instances[FakeWs.instances.length - 1]!;
  ws.triggerOpen();
  ws.receive(snapFrame(5, "2026-11-06T18:59:00.000Z"));
  assert.ok(log.includes("frame:snapshot"));
  // alter seq nach Reconnect: kein Duplikat-Processing
  ws.receive(snapFrame(3, "2026-11-06T18:59:00.000Z"));
  const frameCount = log.filter((l) => l === "frame:snapshot").length;
  assert.equal(frameCount, 1, "veralteter seq darf nicht durchkommen");
  app.stop();
});

test("App: neue Approval → onAttention genau einmal", () => {
  const log: string[] = [];
  const timers = new FakeTimers();
  const app = new App(
    { now: () => Date.parse("2026-11-06T19:00:00.000Z"), connectWs: () => new FakeWs() as unknown as WebSocket, setTimeoutFn: timers.setTimeout.bind(timers), clearTimeoutFn: timers.clearTimeout.bind(timers) },
    callbacks(log),
  );
  app.start();
  const ws = FakeWs.instances[FakeWs.instances.length - 1]!;
  ws.triggerOpen();
  const approval = {
    action_id: "0e0f1e2e-3b4c-4d5e-8f9a-a1b2c3d4e5f6",
    kind: "approval" as const,
    agent_id: "s1",
    class: "write" as const,
    payload: { title: "Paket installieren", body: "npm install" },
    timeout_s: 100,
    decidable: true,
  };
  ws.receive(snapFrame(1, "2026-11-06T19:00:00.000Z", approval));
  ws.receive(snapFrame(2, "2026-11-06T19:00:01.000Z", approval));
  const attentions = log.filter((l) => l.startsWith("attention:"));
  assert.equal(attentions.length, 1, "gleiche Approval nur einmal melden");
  app.stop();
});

test("App: decide sendet decide-Frame", () => {
  const log: string[] = [];
  const timers = new FakeTimers();
  const app = new App(
    { now: () => 0, connectWs: () => new FakeWs() as unknown as WebSocket, setTimeoutFn: timers.setTimeout.bind(timers), clearTimeoutFn: timers.clearTimeout.bind(timers) },
    callbacks(log),
  );
  app.start();
  const ws = FakeWs.instances[FakeWs.instances.length - 1]!;
  ws.triggerOpen();
  app.decide("0e0f1e2e-3b4c-4d5e-8f9a-a1b2c3d4e5f6", "approve");
  assert.equal(ws.sent.length, 1);
  assert.deepEqual(JSON.parse(ws.sent[0]!), { type: "decide", action_id: "0e0f1e2e-3b4c-4d5e-8f9a-a1b2c3d4e5f6", decision: "approve" });
  app.stop();
});

test("App: decide_result wird an onFrame durchgereicht (T10.6 sichtbar)", () => {
  const log: string[] = [];
  const timers = new FakeTimers();
  const app = new App(
    { now: () => 0, connectWs: () => new FakeWs() as unknown as WebSocket, setTimeoutFn: timers.setTimeout.bind(timers), clearTimeoutFn: timers.clearTimeout.bind(timers) },
    callbacks(log),
  );
  app.start();
  const ws = FakeWs.instances[FakeWs.instances.length - 1]!;
  ws.triggerOpen();
  ws.receive({
    type: "decide_result",
    ts: "2026-11-06T19:00:05.000Z",
    action_id: "0e0f1e2e-3b4c-4d5e-8f9a-a1b2c3d4e5f6",
    outcome: "rejected_by_policy",
    hub_status: null,
  });
  assert.ok(log.includes("frame:decide_result"), "decide_result darf nicht still versickern");
  app.stop();
});

test("App: Idle-Ticker feuert nach Ablauf des Intervalls (Kontrolle, T10.5)", () => {
  const log: string[] = [];
  const timers = new FakeTimers();
  let nowMs = Date.parse("2026-11-06T19:00:00.000Z");
  const app = new App(
    { now: () => nowMs, connectWs: () => new FakeWs() as unknown as WebSocket, setTimeoutFn: timers.setTimeout.bind(timers), clearTimeoutFn: timers.clearTimeout.bind(timers) },
    callbacks(log),
  );
  app.start();
  const ws = FakeWs.instances[FakeWs.instances.length - 1]!;
  ws.triggerOpen();
  ws.receive(snapFrame(1, "2026-11-06T19:00:00.000Z"));
  nowMs += 16 * 60 * 1000; // > max. Tick-Intervall (15 min), < Verfall (45 min)
  timers.runAll();
  assert.ok(log.some((l) => l.startsWith("ticker:")), "Ticker muss im Nicht-Verfall feuern");
  app.stop();
});

test("App: ui.idleTicker:false schaltet den Idle-Ticker ab (web.idleTickerEnabled)", () => {
  const log: string[] = [];
  const timers = new FakeTimers();
  let nowMs = Date.parse("2026-11-06T19:00:00.000Z");
  const app = new App(
    { now: () => nowMs, connectWs: () => new FakeWs() as unknown as WebSocket, setTimeoutFn: timers.setTimeout.bind(timers), clearTimeoutFn: timers.clearTimeout.bind(timers) },
    callbacks(log),
  );
  app.start();
  const ws = FakeWs.instances[FakeWs.instances.length - 1]!;
  ws.triggerOpen();
  const frame = { ...snapFrame(1, "2026-11-06T19:00:00.000Z"), ui: { idleTicker: false } };
  ws.receive(frame);
  nowMs += 16 * 60 * 1000;
  timers.runAll();
  assert.ok(!log.some((l) => l.startsWith("ticker:")), "kein automatischer Ticker bei ui.idleTicker:false");
  app.stop();
});

test("App: close → offline-Meldung + Reconnect-Planung", () => {
  const log: string[] = [];
  const timers = new FakeTimers();
  const app = new App(
    { now: () => 0, connectWs: () => new FakeWs() as unknown as WebSocket, setTimeoutFn: timers.setTimeout.bind(timers), clearTimeoutFn: timers.clearTimeout.bind(timers) },
    callbacks(log),
  );
  app.start();
  const ws = FakeWs.instances[FakeWs.instances.length - 1]!;
  ws.triggerOpen();
  ws.triggerClose();
  assert.ok(log.includes("offline:true"), "Verlust sichtbar machen");
  timers.runAll(); // Reconnect-Timer feuert → neue WS-Instanz
  assert.ok(FakeWs.instances.length >= 2, "Reconnect baut neue Verbindung auf");
  app.stop();
});
