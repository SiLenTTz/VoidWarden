// tile-text.ts (EPIC-P13 T13.3): Titel-, Aktivitäts- und Bedarfsfeld für
// sessionList[] — reine Abbildung aus Hub-Daten, bereinigt, nur Anzeige
// (spec.md §10.2: nie roher Agenten-Text als Befehl).
import { test } from "node:test";
import assert from "node:assert/strict";
import { tileTitle, tileActivity, needsFor } from "../src/tile-text.ts";
import type { ApprovalInput } from "../src/aggregate.ts";

test("T13.3 tileTitle: bereinigt auf 40, leer/fehlt → null (Feld weglassen)", () => {
  assert.equal(tileTitle("Fix memory leak"), "Fix memory leak");
  assert.equal(tileTitle(null), null);
  assert.equal(tileTitle(undefined), null);
  assert.equal(tileTitle("   "), null);
  assert.equal(tileTitle(""), null);
});

test("T13.3 tileTitle: 40/41 Zeichen — Kürzung auf 39 + „…", () => {
  assert.equal(tileTitle("a".repeat(40)), "a".repeat(40));
  const cut = tileTitle("a".repeat(41));
  assert.equal(cut, "a".repeat(39) + "…");
  assert.equal(cut?.length, 40);
});

test("T13.3 tileTitle: Steuerzeichen und ANSI werden entfernt", () => {
  assert.equal(tileTitle("vor\u001b[31m nach\u0007"), "vor nach");
});

test("T13.3 tileActivity: jede Tabellenzeile", () => {
  assert.equal(tileActivity("tool_use", "Werkzeug: npm install"), "npm install");
  assert.equal(tileActivity("tool_use", "npm install"), "npm install"); // ohne Präfix unverändert
  assert.equal(tileActivity("assistant", undefined), "antwortet");
  assert.equal(tileActivity("user", undefined), "hat deinen Auftrag");
  assert.equal(tileActivity("gate", undefined), "wartet auf dich");
  assert.equal(tileActivity("error", undefined), "Fehler");
  assert.equal(tileActivity("system", "Zug beendet — wartet auf dich"), "Zug beendet — wartet auf dich");
});

test("T13.3 tileActivity: fehlt/unbekannt → null (Feld weglassen)", () => {
  assert.equal(tileActivity(undefined, "irgendwas"), null);
  assert.equal(tileActivity("geheimnisvoll", "x"), null);
  assert.equal(tileActivity("tool_use", undefined), null);
  assert.equal(tileActivity("system", "  "), null);
});

test("T13.3 tileActivity: tool_use-Text bereinigt und auf 40 gekürzt", () => {
  assert.equal(tileActivity("tool_use", "Werkzeug: \u001b[1meslint\u001b[0m ."), "eslint .");
  assert.equal(tileActivity("tool_use", "Werkzeug: " + "b".repeat(45)), "b".repeat(39) + "…");
  const system = tileActivity("system", "c".repeat(41));
  assert.equal(system !== null && system.length, 40);
});

const approvalInput = (over: Partial<ApprovalInput>): ApprovalInput => ({
  id: "ap1",
  sessionId: "s1",
  status: "pending",
  class: "write",
  summary: "Paket installieren",
  action: "tool.question",
  tool: "AskUserQuestion",
  reasonRequired: false,
  timeoutAt: "2026-11-12T12:00:00.000Z",
  ...over,
});

test("T13.3 needsFor: ohne Freigabe undefined, Frage → question, Freigabe → approval", () => {
  assert.equal(needsFor([], "s1"), undefined);
  assert.equal(needsFor([approvalInput({})], "s1"), "question");
  assert.equal(needsFor([approvalInput({ tool: null, action: "bash.exec" })], "s1"), "approval");
  // andere Session interessiert nicht
  assert.equal(needsFor([approvalInput({ sessionId: "s2" })], "s1"), undefined);
});

test("T13.3 needsFor: bei mehreren gewinnt approval", () => {
  const both = [
    approvalInput({ id: "q1" }),
    approvalInput({ id: "a1", tool: null, action: "bash.exec" }),
  ];
  assert.equal(needsFor(both, "s1"), "approval");
  assert.equal(needsFor([approvalInput({ id: "q1" }), approvalInput({ id: "q2" })], "s1"), "question");
});
