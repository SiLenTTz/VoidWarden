// Metrics + Status-Socket (EPIC-P1 T1.6): Zähler, p95-Histogramm (W1),
// Reconnect-Fenster-Warnung, Unix-Socket-Antwort.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Metrics } from "../src/metrics.ts";
import { StatusServer, fetchStatus } from "../src/status-server.ts";

test("Percentile: p50/p95 über Latenzstichproben (W1)", () => {
  const m = new Metrics();
  for (let i = 1; i <= 100; i++) m.noteDecisionLatency(i);
  assert.equal(m.percentile(50), 50);
  assert.equal(m.percentile(95), 95);
  assert.equal(m.snapshot().decision_latency_ms.n, 100);
});

test("Reconnect-Warnung ab > 5 in 10 Minuten (Link instabil)", () => {
  let t = 0;
  const m = new Metrics("test", () => t);
  for (let i = 0; i < 5; i++) {
    t += 60_000;
    const r = m.noteReconnect();
    assert.equal(r.warn, false);
  }
  t += 60_000;
  const r = m.noteReconnect();
  assert.equal(r.warn, true, "sechster Reconnect im Fenster warnt");
  assert.equal(r.inWindow, 6);
  // Fenster rückt weiter: alte Einträge fliegen raus
  t += 11 * 60_000;
  const after = m.noteReconnect();
  assert.equal(after.inWindow, 1);
  assert.equal(after.warn, false);
});

test("StatusServer bedient Snapshot über Unix-Socket; fetchStatus liest ihn", async () => {
  const dir = mkdtempSync(join(tmpdir(), "vw-sock-"));
  const sock = join(dir, "voidwarden.sock");
  const m = new Metrics("0.1.0-test");
  m.frames_tx = 7;
  const server = new StatusServer({ socketPath: sock, getSnapshot: () => m.snapshot() });
  await server.start();
  try {
    const raw = await fetchStatus(sock);
    assert.ok(raw !== null);
    const parsed = JSON.parse(raw) as { counters: { frames_tx: number }; version: string };
    assert.equal(parsed.counters.frames_tx, 7);
    assert.equal(parsed.version, "0.1.0-test");
  } finally {
    await server.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("fetchStatus liefert null, wenn kein Companion läuft", async () => {
  const raw = await fetchStatus(join(tmpdir(), "vw-nicht-da.sock"), 300);
  assert.equal(raw, null);
});
