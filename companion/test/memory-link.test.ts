// MemoryLink-Paar (EPIC-P1 T1.3): deterministische Duplex-Verbindung für
// Tests und Simulator; Close propagiert auf beide Enden.
import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryLink } from "../src/link.ts";

test("Paar verbindet beide Richtungen", async () => {
  const [a, b] = MemoryLink.pair();
  await a.open();
  await b.open();
  const got: string[] = [];
  b.onLine((l) => got.push(l));
  a.writeLine('{"v":1,"type":"resync","last_seq":3}');
  assert.deepEqual(got, ['{"v":1,"type":"resync","last_seq":3}']);
  const gotA: string[] = [];
  a.onLine((l) => gotA.push(l));
  b.writeLine('{"v":1,"type":"hello"}');
  assert.equal(gotA.length, 1);
  await a.close();
  assert.equal(a.isOpen, false);
  assert.equal(b.isOpen, false);
});

test("write auf geschlossenem Link wirft (Fail loud)", async () => {
  const [a, b] = MemoryLink.pair();
  await a.open();
  await b.open();
  await a.close();
  assert.throws(() => b.writeLine("x"));
});

test("onClose feuert am eigenen Ende", async () => {
  const [a, b] = MemoryLink.pair();
  await a.open();
  await b.open();
  let closed = 0;
  b.onClose(() => (closed += 1));
  await b.close();
  assert.equal(closed, 1);
});
