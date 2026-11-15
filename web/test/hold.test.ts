// hold.ts (EPIC-P13 T13.5, Umsetzungsspezifikation §6): Halte-Zone als reine
// Zustandsmaschine — fire genau einmal nach ≥ 800 ms ununterbrochenem Halten
// desselben Zeigers, Abbruch (up/leave/cancel) ohne Senden, locked bis unlock.
// W9: „kein decide ohne vollendetes Halten" wird hier als Eigenschaft über
// zufällige Eingabefolgen mit festem Seed geprüft (Zeit und Zufall injiziert).
import { test } from "node:test";
import assert from "node:assert/strict";
import { HOLD_MS, holdDown, holdRelease, holdTick, holdProgress, holdUnlock, type HoldState } from "../src/hold.ts";

const idle: HoldState = { phase: "idle" };

// --- Zustandsmaschine: Tabelle aus §6 ----------------------------------------
test("holdDown: nur aus idle; zweiter Zeiger und locked werden ignoriert", () => {
  const h = holdDown(idle, 1000, 3);
  assert.deepEqual(h, { phase: "holding", startedAtMs: 1000, pointerId: 3 });
  assert.deepEqual(holdDown(h, 1100, 7), h, "zweiter Zeiger während holding ändert nichts");
  const locked: HoldState = { phase: "locked" };
  assert.deepEqual(holdDown(locked, 1200, 3), locked, "down im locked bleibt locked");
});

test("holdRelease: nur der haltende Zeiger bricht ab; fremde IDs und locked ändern nichts", () => {
  const h = holdDown(idle, 1000, 3);
  assert.deepEqual(holdRelease(h, 9), h, "fremde pointerId ignoriert");
  assert.deepEqual(holdRelease(h, 3), idle);
  const locked: HoldState = { phase: "locked" };
  assert.deepEqual(holdRelease(locked, 3), locked, "locked wird nicht per release geöffnet");
  assert.deepEqual(holdRelease(idle, 3), idle);
});

test("holdTick: fire genau beim ersten Tick ≥ 800 ms, dann nie wieder ohne neues down", () => {
  const h = holdDown(idle, 1000, 1);
  assert.deepEqual(holdTick(h, 1799), { state: h, fire: false });
  const fired = holdTick(h, 1800);
  assert.deepEqual(fired, { state: { phase: "locked" }, fire: true });
  assert.deepEqual(holdTick(fired.state, 5000), { state: { phase: "locked" }, fire: false });
});

test("holdProgress: 0 in idle, linear 0..1 beim Halten, 1 in locked", () => {
  assert.equal(holdProgress(idle, 9999), 0);
  const h = holdDown(idle, 1000, 1);
  assert.equal(holdProgress(h, 1000), 0);
  assert.equal(holdProgress(h, 1400), 0.5);
  assert.equal(holdProgress(h, 9999), 1, "über 800 ms geklemmt auf 1");
  assert.equal(holdProgress({ phase: "locked" }, 9999), 1);
});

test("holdUnlock: locked ⇒ idle, sonst unverändert", () => {
  assert.deepEqual(holdUnlock({ phase: "locked" }), idle);
  const h = holdDown(idle, 1, 1);
  assert.deepEqual(holdUnlock(h), h);
});

// --- Tastatur: gleiche 800 ms mit pointerId −1 -------------------------------
test("Tastatur: Space gehalten feuert wie ein Zeiger, keyup bricht ab", () => {
  const h = holdDown(idle, 2000, -1);
  assert.equal(holdTick(h, 2799).fire, false);
  assert.equal(holdTick(h, 2800).fire, true);
  assert.deepEqual(holdRelease(holdDown(idle, 2000, -1), -1), idle);
});

// --- 20 abgebrochene Halter ⇒ 0 decide (W11-Messlatte als Unit-Vorform) ------
test("W11: 20 vor 800 ms abgebrochene Halter erzeugen 0 fire (⇒ 0 decide)", () => {
  let decide = 0;
  for (let i = 0; i < 20; i++) {
    const t0 = i * 5000;
    let s = holdDown(idle, t0, 1);
    for (let t = t0 + 100; t <= t0 + HOLD_MS - 100; t += 100) {
      const r = holdTick(s, t);
      s = r.state;
      assert.equal(r.fire, false);
      if (r.fire) decide += 1;
    }
    s = holdRelease(s, 1); // losgelassen/aus der Zone gewischt
    assert.equal(s.phase, "idle");
    assert.equal(holdTick(s, t0 + HOLD_MS + 5000).fire, false, "nach Abbruch feuert auch später nichts");
  }
  assert.equal(decide, 0);
});

// --- Property-Test: zufällige Folgen down/up/leave/cancel/tick, fester Seed --
// Invarianten (AC-P13-3): fire nur nach ≥ 800 ms ununterbrochenem Halten
// desselben Zeigers; nie zweimal ohne neues down; nie im Zustand locked.
test("Property: kein decide ohne vollendetes Halten (fester Seed, 80 Läufe × 150 Ereignisse)", () => {
  let seed = 20261113;
  const rnd = (): number => {
    seed = (seed * 1103515245 + 12345) % 2147483647;
    return seed / 2147483647;
  };
  let totalDecides = 0;
  for (let run = 0; run < 80; run++) {
    let state: HoldState = idle;
    let now = Math.floor(rnd() * 1_000_000);
    let holdStart: number | null = null; // Spiegel: seit letztem down ohne release
    let holdPtr = 0;
    let armed = false; // seit letztem fire gab es ein down
    let decides = 0;
    for (let ev = 0; ev < 150; ev++) {
      const op = Math.floor(rnd() * 5); // 0 down, 1 up, 2 leave, 3 cancel, 4 tick
      if (op === 0) {
        const pid = 1 + Math.floor(rnd() * 3);
        const before = state;
        state = holdDown(state, now, pid);
        if (before.phase === "idle" && state.phase === "holding") {
          holdStart = now;
          holdPtr = pid;
          armed = true;
        }
      } else if (op >= 1 && op <= 3) {
        const pid = rnd() < 0.75 && state.phase === "holding" ? state.pointerId : 1 + Math.floor(rnd() * 3);
        const before = state;
        state = holdRelease(state, pid);
        if (before.phase === "holding" && state.phase === "idle") holdStart = null;
      } else {
        now += Math.floor(rnd() * 400);
        const before = state;
        const r = holdTick(state, now);
        state = r.state;
        if (r.fire) {
          // jedes fire ist ein decide — alle Invarianten hier geprüft
          assert.ok(before.phase === "holding", "fire nur aus holding");
          assert.ok(holdStart !== null, "fire nur mit laufendem, nicht abgebrochenem Halten");
          assert.ok(now - (holdStart as number) >= HOLD_MS, "fire frühestens 800 ms nach down");
          assert.equal((before as { pointerId?: number }).pointerId, holdPtr, "derselbe Zeiger ohne Unterbrechung");
          assert.ok(armed, "nie zweimal ohne neues down");
          armed = false;
          holdStart = null;
          decides += 1;
          assert.equal(state.phase, "locked", "nach fire ist locked");
        }
      }
      if (state.phase === "locked") assert.equal(holdTick(state, now).fire, false, "im locked nie fire");
    }
    totalDecides += decides;
  }
  assert.ok(totalDecides > 0, `Property-Test muss fire auch sehen (sah ${totalDecides})`);
});
