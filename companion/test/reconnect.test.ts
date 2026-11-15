// EPIC-P4 T4.4: Reconnect-Härtung gegen MemoryLink + FakeClock — ESP-Brownout (zweites hello),
// Hub-Restart (down → up) und Companion-Restart (neue Bridge, gleicher Link). Immer gilt:
// nach der Rückkehr kommt ein snapshot mit dem aktuellen Zustand (K7), seq beginnt neu.
import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryLink } from "../src/link.ts";
import { FakeClock } from "../src/clock.ts";
import { Bridge } from "../src/bridge.ts";
import { decodeLine, type Frame } from "../src/frames.ts";
import type { AggregateResult } from "../src/aggregate.ts";

const HELLO =
  '{"v":1,"type":"hello","fw":"0.2.0","proto":1,"screen":{"w":320,"h":240},"reset_reason":"BROWNOUT_RESET","heap_free":244160}';

function agg(state: AggregateResult["state"]): AggregateResult {
  return {
    state,
    sessions: { total: 1, working: 0, waiting: state === "approval_pending" ? 1 : 0, error: 0 },
    approval: null,
    pendingCount: 0,
    unknownStatuses: [],
  };
}

async function setup(initial: AggregateResult) {
  const [companionSide, device] = MemoryLink.pair();
  await companionSide.open();
  await device.open();
  const clock = new FakeClock();
  const lines: string[] = [];
  device.onLine((l) => lines.push(l));
  const current = { value: initial as AggregateResult | null };
  const make = () => {
    const b = new Bridge({
      link: companionSide,
      clock,
      getAggregate: () => current.value,
      log: () => {},
    });
    b.start();
    return b;
  };
  const frames = (): Frame[] =>
    lines.map((l) => decodeLine(l)).flatMap((r) => (r.ok ? [r.frame] : []));
  return { device, clock, lines, current, make, frames };
}

test("ESP-Brownout: zweites hello mitten im Betrieb liefert snapshot mit aktuellem Zustand, seq neu", async () => {
  const h = await setup(agg("approval_pending"));
  h.make();
  h.device.writeLine(HELLO);
  h.clock.advance(5000);
  h.device.writeLine(HELLO); // Gerät startete neu
  const snaps = h.frames().filter((f) => f.type === "snapshot");
  assert.equal(snaps.length, 2);
  for (const s of snaps) {
    assert.equal(s.type === "snapshot" ? s.state : "", "approval_pending");
    assert.equal(s.type === "snapshot" ? s.seq : 0, 1, "seq startet je Link-Sitzung neu");
  }
});

test("Hub-Restart: heartbeat hub down, dann up mit Zustand über state_change, nie grün dazwischen", async () => {
  const h = await setup(agg("listening"));
  const b = h.make();
  h.device.writeLine(HELLO);
  h.current.value = agg("offline");
  b.onAggregate(agg("offline"));
  h.clock.advance(5000);
  const down = h.frames().filter((f) => f.type === "heartbeat").at(-1);
  assert.equal(down?.type === "heartbeat" ? down.hub : "", "down");
  h.current.value = agg("listening");
  b.onAggregate(agg("listening"));
  h.clock.advance(5000);
  const up = h.frames().filter((f) => f.type === "heartbeat").at(-1);
  assert.equal(up?.type === "heartbeat" ? up.hub : "", "up");
  const changes = h
    .frames()
    .flatMap((f) => (f.type === "state_change" ? [f.state] : []));
  assert.deepEqual(changes, ["offline", "listening"]);
});

test("Companion-Restart: neue Bridge, Gerät sendet resync/hello → frischer snapshot, kein Altzustand", async () => {
  const h = await setup(agg("executing"));
  const first = h.make();
  h.device.writeLine(HELLO);
  first.stop();
  h.current.value = agg("idle"); // Zustand änderte sich während des Neustarts
  h.make();
  h.device.writeLine('{"v":1,"type":"resync","last_seq":9}');
  const last = h.frames().filter((f) => f.type === "snapshot").at(-1);
  assert.equal(last?.type === "snapshot" ? last.state : "", "idle");
  assert.equal(last?.type === "snapshot" ? last.seq : 0, 1);
});

test("Hello-Sturm (Flapping): jedes hello bekommt genau einen snapshot, kein Absturz", async () => {
  const h = await setup(agg("idle"));
  h.make();
  for (let i = 0; i < 20; i++) {
    h.device.writeLine(HELLO);
    h.clock.advance(50);
  }
  assert.equal(h.frames().filter((f) => f.type === "snapshot").length, 20);
});
