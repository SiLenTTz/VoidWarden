// Backoff/Reconnect/Poller (EPIC-P1 T1.5) — pure Delay-Kette und
// Zustandsübergänge gegen FakeClock, deterministisch (rand fest).
import { test } from "node:test";
import assert from "node:assert/strict";
import { nextDelay, DEFAULT_BACKOFF, Poller, Reconnector, type ManagedConnection } from "../src/retry.ts";
import { FakeClock } from "../src/clock.ts";

test("Delay-Kette: 250 ms → 5 s exponentiell, gedeckelt, Jitter deterministisch", () => {
  const noJitter = { ...DEFAULT_BACKOFF, jitterRatio: 0 };
  assert.equal(nextDelay(0, noJitter), 250);
  assert.equal(nextDelay(1, noJitter), 500);
  assert.equal(nextDelay(2, noJitter), 1000);
  assert.equal(nextDelay(3, noJitter), 2000);
  assert.equal(nextDelay(4, noJitter), 4000);
  assert.equal(nextDelay(5, noJitter), 5000, "Deckel bei maxMs");
  assert.equal(nextDelay(20, noJitter), 5000);
  // rand=0 → −20 %, rand=1 → +20 %
  assert.equal(nextDelay(0, DEFAULT_BACKOFF, 0), 200);
  assert.equal(nextDelay(0, DEFAULT_BACKOFF, 1), 300);
});

test("Reconnector: connect ok → connected; close → retry nach Backoff (W5/W6)", async () => {
  const clock = new FakeClock();
  let failTimes = 2;
  let closeCb: (() => void) | null = null;
  const states: string[] = [];
  let connections = 0;
  const rec = new Reconnector(
    () =>
      new Promise<ManagedConnection>((resolve, reject) => {
        if (failTimes > 0) {
          failTimes -= 1;
          reject(new Error("kein Gerät"));
          return;
        }
        connections += 1;
        resolve({
          close: () => {},
          onClose: (cb) => {
            closeCb = cb;
          },
        });
      }),
    clock,
    { onState: (s) => states.push(s), ...{} },
    { ...DEFAULT_BACKOFF, jitterRatio: 0 },
  );
  rec.start();
  await new Promise((r) => setImmediate(r)); // asynchrone connect-Versuche
  assert.equal(rec.currentState, "reconnecting");
  clock.advance(250); // attempt 0: 250 ms
  await new Promise((r) => setImmediate(r));
  assert.equal(rec.currentState, "reconnecting");
  clock.advance(500); // attempt 1: 500 ms
  await new Promise((r) => setImmediate(r));
  assert.equal(connections, 1);
  assert.equal(rec.currentState, "connected");
  // Verbindung reißt: neuer Versuch wieder bei 250 ms (Reset nach Erfolg)
  (closeCb as unknown as () => void)?.();
  clock.advance(250);
  await new Promise((r) => setImmediate(r));
  assert.equal(connections, 2);
  assert.ok(states.includes("connected"));
});

test("Poller: Fehler wächst den Abstand, Erfolg resettet (Hub-Backoff)", async () => {
  const clock = new FakeClock();
  let shouldFail = false;
  let _polls = 0;
  const errors: number[] = [];
  const poller = new Poller(
    async () => {
      _polls += 1;
      if (shouldFail) throw new Error("hub down");
      return { ok: true };
    },
    clock,
    1500,
    { onError: (_e, n) => errors.push(n) },
    { ...DEFAULT_BACKOFF, jitterRatio: 0 },
  );
  poller.start();
  await new Promise((r) => setImmediate(r));
  assert.equal(poller.consecutiveErrors, 0);
  shouldFail = true;
  clock.advance(1500); // 1. Fehlversuch → nächster nach 250 ms
  await new Promise((r) => setImmediate(r));
  clock.advance(250); // 2. Fehlversuch → 500 ms
  await new Promise((r) => setImmediate(r));
  clock.advance(500); // 3. Fehlversuch → 1000 ms
  await new Promise((r) => setImmediate(r));
  assert.equal(poller.consecutiveErrors, 3);
  assert.deepEqual(errors, [1, 2, 3]);
  shouldFail = false;
  clock.advance(1000); // Erfolg → zurück auf 1500 ms
  await new Promise((r) => setImmediate(r));
  assert.equal(poller.consecutiveErrors, 0);
  assert.ok(poller.runs >= 2);
});
