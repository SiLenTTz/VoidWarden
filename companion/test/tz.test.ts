// T4.7: utc_offset_min DST-korrekt (Grenzwerte Europe/Berlin 2026) und im Frame der Bridge.
import { test } from "node:test";
import assert from "node:assert/strict";
import { utcOffsetMin } from "../src/tz.ts";
import { MemoryLink } from "../src/link.ts";
import { Bridge } from "../src/bridge.ts";
import { FakeClock } from "../src/clock.ts";
import { aggregate } from "../src/aggregate.ts";

test("Offset an den Sommerzeit-Grenzen (Europe/Berlin 2026)", () => {
  // Umstellung 2026-03-29 01:00 UTC (02:00 → 03:00) und 2026-10-25 01:00 UTC (03:00 → 02:00)
  assert.equal(utcOffsetMin(new Date("2026-03-29T00:59:59Z"), "Europe/Berlin"), 60);
  assert.equal(utcOffsetMin(new Date("2026-03-29T01:00:00Z"), "Europe/Berlin"), 120);
  assert.equal(utcOffsetMin(new Date("2026-10-25T00:59:59Z"), "Europe/Berlin"), 120);
  assert.equal(utcOffsetMin(new Date("2026-10-25T01:00:00Z"), "Europe/Berlin"), 60);
});

test("Offset für halbe und Dreiviertelstunden und negative Zonen", () => {
  assert.equal(utcOffsetMin(new Date("2026-06-01T12:00:00Z"), "Asia/Kolkata"), 330);
  assert.equal(utcOffsetMin(new Date("2026-06-01T12:00:00Z"), "Asia/Kathmandu"), 345);
  assert.equal(utcOffsetMin(new Date("2026-01-15T12:00:00Z"), "America/New_York"), -300);
  assert.equal(utcOffsetMin(new Date("2026-06-01T12:00:00Z"), "UTC"), 0);
});

test("Bridge schreibt utc_offset_min in snapshot und heartbeat; ohne Funktion bleibt das Feld weg", async () => {
  const sent = async (withOffset: boolean) => {
    const [a, b] = MemoryLink.pair();
    await a.open();
    await b.open();
    const lines: string[] = [];
    b.onLine((l: string) => lines.push(l));
    const clock = new FakeClock(Date.parse("2026-07-01T10:00:00Z"));
    const bridge = new Bridge({
      link: a,
      clock,
      getAggregate: () => aggregate({ sessions: [], approvals: [], now: clock.now(), hubUp: true }),
      heartbeatMs: 1000,
      ...(withOffset ? { utcOffsetMin: (ts: string) => utcOffsetMin(new Date(ts), "Europe/Berlin") } : {}),
    });
    bridge.start();
    bridge.sendSnapshot();
    clock.advance(1000);
    bridge.stop();
    return lines.map((l) => JSON.parse(l) as Record<string, unknown>);
  };
  const withField = await sent(true);
  assert.ok(withField.some((f) => f["type"] === "snapshot" && f["utc_offset_min"] === 120));
  assert.ok(withField.some((f) => f["type"] === "heartbeat" && f["utc_offset_min"] === 120));
  assert.ok((await sent(false)).every((f) => !("utc_offset_min" in f)));
});
