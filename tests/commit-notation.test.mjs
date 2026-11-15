import { test } from "node:test";
import assert from "node:assert/strict";
import { checkSubject } from "../scripts/commit-notation.mjs";

test("gültige Subjects passieren", () => {
  assert.equal(checkSubject("^ F companion: Heartbeat alle 5 s senden"), null);
  assert.equal(checkSubject(". d adr: ADR-0002 ergänzt"), null);
  assert.equal(checkSubject("! B firmware: Touch-Zone nach Dimmen korrekt entprellt"), null);
  assert.equal(checkSubject("@ F protocol: Zwischenstand Parser"), null);
});

test("Subjects ohne Notation werden abgelehnt", () => {
  assert.ok(checkSubject("add heartbeat"));
  assert.ok(checkSubject("feat: heartbeat"));
  assert.ok(checkSubject(""));
});

test("falsche Risiko-/Absicht-Zeichen werden abgelehnt", () => {
  assert.ok(checkSubject("x F companion: falsches Risiko"));
  assert.ok(checkSubject("^ X companion: falsche Absicht"));
  assert.ok(checkSubject("^ F Companion: Bereich muss kleinbuchstabil sein"));
});

test("überlange Zusammenfassungen werden abgelehnt", () => {
  assert.ok(checkSubject(`^ F companion: ${"x".repeat(95)}`));
});
