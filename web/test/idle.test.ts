// Idle-Logik (EPIC-P10 T10.5): reine Funktionen, injizierte Zeit — Verfall,
// Ticker-Timing, kein Recycling, Tap-Verhalten. Alle Zeitangaben ms epoch.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isDecayed,
  tickDue,
  nextTickDelayMs,
  pickTickerSession,
  tapOnDecayedNyx,
  TICK_MIN_S,
  TICK_MAX_S,
  DECAY_S,
} from "../src/idle.ts";

const T0 = Date.parse("2026-11-06T12:00:00.000Z");
const MIN = 60_000;

test("Verfall: 45 min ohne Event → decayed; 44:59 nicht; neues Event hebt auf", () => {
  const last = T0;
  assert.equal(isDecayed({ nowMs: T0 + 44 * MIN + 59_000, lastActivityMs: last, lastTickMs: null, nextTickAtMs: null }), false);
  assert.equal(isDecayed({ nowMs: T0 + DECAY_S * 1000, lastActivityMs: last, lastTickMs: null, nextTickAtMs: null }), true);
  // neues Event vor dem Verfall: weiter frisch
  assert.equal(isDecayed({ nowMs: T0 + DECAY_S * 1000, lastActivityMs: T0 + 30 * MIN, lastTickMs: null, nextTickAtMs: null }), false);
});

test("Verfall ohne bekannte Aktivität: kein erzwungener Verfall", () => {
  assert.equal(isDecayed({ nowMs: T0 + 10 * 60 * MIN, lastActivityMs: null, lastTickMs: null, nextTickAtMs: null }), false);
});

test("Tick 5–15 min: tag-geseedet deterministisch, Grenzen eingehalten", () => {
  const d1 = nextTickDelayMs(T0, 0);
  const d2 = nextTickDelayMs(T0, 0);
  assert.equal(d1, d2, "gleiche Zeit + Schritt → gleiches Intervall (Tag-Seed)");
  for (let step = 0; step < 50; step++) {
    const d = nextTickDelayMs(T0, step);
    assert.ok(d >= TICK_MIN_S * 1000 && d <= TICK_MAX_S * 1000, `Intervall außerhalb 5–15 min: ${d / MIN} min`);
  }
  // anderer Tag → anderer Seed → (fast sicher) anderes Intervall
  const other = nextTickDelayMs(T0 + 86_400_000, 0);
  assert.notEqual(other, d1);
});

test("tickDue: nur geplant + fällig + nicht verfallen", () => {
  const next = T0 + 10 * MIN;
  assert.equal(tickDue({ nowMs: T0 + 9 * MIN, lastActivityMs: T0, lastTickMs: null, nextTickAtMs: next }), false);
  assert.equal(tickDue({ nowMs: T0 + 10 * MIN, lastActivityMs: T0, lastTickMs: null, nextTickAtMs: next }), true);
  // verfallen: kein Tick, selbst wenn fällig
  const old = T0 - 60 * MIN;
  assert.equal(tickDue({ nowMs: T0, lastActivityMs: old, lastTickMs: null, nextTickAtMs: T0 - 30 * MIN }), false);
  // nichts geplant
  assert.equal(tickDue({ nowMs: T0, lastActivityMs: T0, lastTickMs: null, nextTickAtMs: null }), false);
});

test("Ticker: kein Recycling — nur Sessions mit Aktivität seit letztem Tick", () => {
  const sessions = [
    { id: "a", name: "alt", updatedAt: new Date(T0 - 30 * MIN).toISOString(), lastAssistantMessage: "alte Nachricht" },
    { id: "b", name: "neu", updatedAt: new Date(T0 - 2 * MIN).toISOString(), lastAssistantMessage: "frische Antwort" },
  ];
  const lastTick = T0 - 10 * MIN;
  const pick = pickTickerSession(sessions, lastTick);
  assert.ok(pick !== null);
  assert.equal(pick.session.id, "b", "nur die aktive Session wird getickt");

  // letzte Aktivität VOR dem letzten Tick → kein Tick-Inhalt
  const none = pickTickerSession(sessions, T0 + MIN);
  assert.equal(none, null);
});

test("Ticker: bevorzugt zuletzt aktiv mit Nachricht; ohne Nachricht trotzdem wählbar", () => {
  const sessions = [
    { id: "a", name: "neu-ohne-msg", updatedAt: new Date(T0 - 1 * MIN).toISOString(), lastAssistantMessage: null },
    { id: "b", name: "aelter-mit-msg", updatedAt: new Date(T0 - 5 * MIN).toISOString(), lastAssistantMessage: "antwort" },
  ];
  const pick = pickTickerSession(sessions, T0 - 10 * MIN);
  assert.ok(pick !== null);
  assert.equal(pick.session.id, "b", "Nachricht-Session gewinnt vor neuerer ohne");
});

test("Tap auf Nyx im Verfall: Status read-only, Ticker wird NICHT reaktiviert", () => {
  const decayedInput = { nowMs: T0, lastActivityMs: T0 - 60 * MIN, lastTickMs: null, nextTickAtMs: null };
  const res = tapOnDecayedNyx(decayedInput);
  assert.equal(res.phase, "decayed");
  assert.equal(res.showStatus, true);
  assert.equal(res.reviveTicker, false, "Tap darf den Ticker nicht reaktivieren");
  // und frisch bleibt frisch
  const fresh = tapOnDecayedNyx({ nowMs: T0, lastActivityMs: T0, lastTickMs: null, nextTickAtMs: null });
  assert.equal(fresh.phase, "fresh");
});
