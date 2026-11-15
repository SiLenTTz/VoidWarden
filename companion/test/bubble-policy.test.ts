// EPIC-P8 T8.2: Policy mit Fake-Zeit (kein Timer), inkl. 30-ev/s-Flut (AC-P8-2, W12).
import { test } from "node:test";
import assert from "node:assert/strict";
import { BubblePolicy, messageHash } from "../src/bubble-policy.ts";

test("identische Meldung erscheint im Fenster nicht doppelt, danach wieder", () => {
  const p = new BubblePolicy();
  assert.equal(p.offer({ level: "info", text: "Build ok" }, 0).show, true);
  const dup = p.offer({ level: "info", text: "Build ok" }, 10_000);
  assert.deepEqual([dup.show, dup.reason], [false, "dedupe"]);
  assert.equal(p.offer({ level: "info", text: "Build ok" }, 31_000).show, true);
});

test("Haltezeiten je Level", () => {
  const p = new BubblePolicy();
  assert.equal(p.offer({ level: "info", text: "a" }, 0).holdS, 6);
  assert.equal(p.offer({ level: "success", text: "b" }, 1000).holdS, 4);
  assert.equal(p.offer({ level: "error", text: "c" }, 2000).holdS, 12);
});

test("Fehler wird gehalten: Info verdrängt ihn nicht, zweiter Fehler schaukelt nicht auf", () => {
  const p = new BubblePolicy();
  assert.equal(p.offer({ level: "error", text: "e1" }, 0).show, true);
  assert.equal(p.offer({ level: "info", text: "i" }, 5000).reason, "blocked_by_error");
  assert.equal(p.offer({ level: "error", text: "e2" }, 6000).reason, "blocked_by_error");
  assert.equal(p.offer({ level: "info", text: "i" }, 12_000).show, true, "nach 12 s frei");
});

test("resolveError beendet die Haltezeit früher", () => {
  const p = new BubblePolicy();
  p.offer({ level: "error", text: "e" }, 0);
  p.resolveError();
  assert.equal(p.offer({ level: "success", text: "fixed" }, 1000).show, true);
});

test("kritisch verlangt Ack, verdrängt Niedrigeres, weitere kritische warten und kommen nach Ack", () => {
  const p = new BubblePolicy();
  p.offer({ level: "info", text: "i" }, 0);
  const d = p.offer({ level: "critical", text: "Freigabe nötig" }, 1000);
  assert.deepEqual([d.show, d.ackRequired], [true, true]);
  assert.equal(p.offer({ level: "info", text: "x" }, 2000).reason, "blocked_by_critical");
  assert.equal(p.offer({ level: "error", text: "y" }, 3000).reason, "blocked_by_critical");
  assert.equal(p.offer({ level: "critical", text: "zweite" }, 4000).reason, "queued");
  assert.equal(p.pendingCritical, 1);
  assert.equal(p.ack(5000)?.text, "zweite");
  assert.equal(p.ack(6000), null);
  assert.equal(p.offer({ level: "info", text: "danach" }, 7000).show, true);
});

test("periodisch: nur nach periodicS und nur bei neuem Zustand", () => {
  const p = new BubblePolicy();
  assert.equal(p.periodic("2w1b", 0).show, true);
  assert.equal(p.periodic("2w1b", 30_000).reason, "periodic_too_early");
  assert.equal(p.periodic("2w1b", 60_000).reason, "no_new_state");
  assert.equal(p.periodic("3w0b", 120_000).show, true);
});

test("30 ev/s über 60 s: nichtkritische Blasen bleiben unter dem Limit, jede Ablehnung hat Grund", () => {
  const p = new BubblePolicy();
  let shown = 0;
  const reasons = new Set<string>();
  for (let i = 0; i < 30 * 60; i++) {
    const d = p.offer({ level: i % 2 === 0 ? "info" : "success", text: `ev ${i}` }, i * (1000 / 30));
    if (d.show) shown++;
    reasons.add(d.reason);
  }
  assert.ok(shown <= 6, `shown=${shown}`);
  assert.ok(reasons.has("rate_limit"));
});

test("Hash ist stabil und unterscheidet Texte", () => {
  assert.equal(messageHash("a"), messageHash("a"));
  assert.notEqual(messageHash("a"), messageHash("b"));
});
