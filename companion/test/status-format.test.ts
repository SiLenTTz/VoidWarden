// `voidwarden status` lesbar (observability.md §4): Ampel + eine Zeile je Befund, "n/a" statt 0.
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatStatus } from "../src/status-format.ts";

const base = {
  link_state: "connected",
  hub_state: "up",
  counters: {
    frames_tx: 120,
    frames_rx: 8,
    frames_dropped: 0,
    parse_err: 0,
    reconnects: 0,
    hub_errors: 0,
    hub_polls: 40,
    decisions_sent: 2,
    decisions_deduped: 1,
  },
  decision_latency_ms: { p50: 180, p95: 420, n: 2 },
  last_hello_ts: "2026-11-06T08:00:00.000Z",
  version: "0.1.0",
};

test("alles gut: Kopfzeile OK, Board und Hub in Klartext", () => {
  const out = formatStatus(base, Date.parse("2026-11-06T08:05:00.000Z"));
  assert.match(out.split("\n")[0] as string, /OK/);
  assert.match(out, /Board: +verbunden/);
  assert.match(out, /Hub: +erreichbar/);
  assert.match(out, /hello vor 5 Min/);
  assert.match(out, /Latenz p95 420 ms \(n=2\)/);
});

test("kein hello seit Start wird erklärt statt als null gezeigt", () => {
  const out = formatStatus({ ...base, last_hello_ts: null }, Date.now());
  assert.match(out, /kein hello seit Start/);
  assert.doesNotMatch(out, /null/);
});

test("Latenz ohne Messung ist n/a, nie 0", () => {
  const out = formatStatus({ ...base, decision_latency_ms: { p50: null, p95: null, n: 0 } }, Date.now());
  assert.match(out, /Latenz n\/a/);
});

test("Board getrennt oder Hub down: ACHTUNG mit Grund in der Kopfzeile", () => {
  const out = formatStatus({ ...base, link_state: "disconnected", hub_state: "down" }, Date.now());
  const head = out.split("\n")[0] as string;
  assert.match(head, /ACHTUNG/);
  assert.match(head, /Board/);
  assert.match(head, /Hub/);
});

test("Parse-Fehler und verworfene Frames machen die Kopfzeile ACHTUNG", () => {
  const out = formatStatus({ ...base, counters: { ...base.counters, parse_err: 3, frames_dropped: 1 } }, Date.now());
  assert.match(out.split("\n")[0] as string, /ACHTUNG/);
  assert.match(out, /3 Parse-Fehler/);
});

test("unbekannte Form (fehlende Felder) bricht nicht ab", () => {
  const out = formatStatus({}, Date.now());
  assert.match(out, /n\/a/);
});
