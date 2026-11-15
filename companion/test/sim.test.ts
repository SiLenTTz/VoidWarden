// Simulator-Integration (EPIC-P1 T1.7): FakeDevice gegen Bridge über
// MemoryLink — der „Monitor" sieht snapshot/heartbeat/state_change, und die
// Fehlerinjektion schlägt sich in Zählern nieder (fail loud).
import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryLink } from "../src/link.ts";
import { FakeDevice } from "../src/sim.ts";
import { Bridge } from "../src/bridge.ts";
import { FakeClock } from "../src/clock.ts";
import { decodeLine } from "../src/frames.ts";
import type { AggregateResult } from "../src/aggregate.ts";

function agg(state: AggregateResult["state"]): AggregateResult {
  return {
    state,
    sessions: { total: 2, working: 1, waiting: 0, error: 0 },
    approval: null,
    pendingCount: 0,
    unknownStatuses: [],
  };
}

test("Sim-Abnahme: hello → snapshot im Monitor, Zustände als state_change, Heartbeat sichtbar", async () => {
  const [companionSide, deviceSide] = MemoryLink.pair();
  const clock = new FakeClock();
  const monitor: string[] = [];
  const state = { value: agg("idle") };

  const device = new FakeDevice({
    link: deviceSide,
    monitor: (e) => {
      const res = decodeLine(e.line);
      const type = res.ok ? res.frame.type : "?";
      monitor.push(`${e.dir} ${type}`);
    },
  });
  const bridge = new Bridge({
    link: companionSide,
    clock,
    getAggregate: () => state.value,
  });
  await companionSide.open();
  await device.start();
  bridge.start();

  device.hello();
  assert.ok(monitor.some((m) => m === "rx snapshot"), `Monitor sieht snapshot: ${JSON.stringify(monitor)}`);

  state.value = agg("listening");
  bridge.onAggregate(state.value);
  clock.advance(100);
  assert.ok(monitor.some((m) => m === "rx state_change"));

  clock.advance(5000);
  assert.ok(monitor.some((m) => m === "rx heartbeat"));
});

test("Fehlerinjektion: Müll/Überlänge/unbekannter Typ zählen parse_err, Companion bleibt lebendig", async () => {
  const [companionSide, deviceSide] = MemoryLink.pair();
  const clock = new FakeClock();
  const logs: string[] = [];
  const device = new FakeDevice({ link: deviceSide });
  const bridge = new Bridge({
    link: companionSide,
    clock,
    getAggregate: () => agg("idle"),
    log: (msg) => logs.push(msg),
  });
  await companionSide.open();
  await device.start();
  bridge.start();

  device.injectGarbage();
  device.injectOversize();
  device.injectUnknownType();
  assert.equal(bridge.counters.parse_err, 3, "alle drei Injektionen gezählt");

  // danach funktioniert das Protokoll weiterhin
  device.hello();
  assert.ok(
    device.received.some((l) => {
      const res = decodeLine(l);
      return res.ok && res.frame.type === "snapshot";
    }),
  );
  assert.ok(logs.filter((l) => l === "bridge:parse_error").length >= 3);
});

test("Sim: ROM-Präfix vor hello lässt hello und snapshot durch, Präfix ist gezählt (T2.9)", async () => {
  const [companionSide, deviceSide] = MemoryLink.pair();
  const clock = new FakeClock();
  const device = new FakeDevice({ link: deviceSide });
  const bridge = new Bridge({ link: companionSide, clock, getAggregate: () => agg("idle") });
  await companionSide.open();
  await device.start();
  bridge.start();
  device.injectRomPrefixThenHello();
  assert.equal(bridge.counters.line_prefix, 1);
  assert.equal(bridge.counters.parse_err, 0);
  assert.ok(device.received.some((l) => { const r = decodeLine(l); return r.ok && r.frame.type === "snapshot"; }), "hello → snapshot");
});
