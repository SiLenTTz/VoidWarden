// Tabellentests für aggregate() (EPIC-P1 T1.2, docs/testing.md §3).
import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregate, type ApprovalInput, type SessionInput } from "../src/aggregate.ts";

const NOW = "2026-11-03T12:00:00.000Z";

function session(status: string, extra: Partial<SessionInput> = {}): SessionInput {
  return { status, ...extra };
}

function approval(extra: Partial<ApprovalInput> = {}): ApprovalInput {
  return {
    id: "0e0f1e2e-3b4c-4d5e-8f9a-a1b2c3d4e5f6",
    sessionId: "sess-1",
    status: "pending",
    class: "write",
    summary: "Paket installieren",
    action: "bash.exec",
    tool: "npm install",
    reasonRequired: false,
    timeoutAt: "2026-11-03T12:02:00.000Z",
    ...extra,
  };
}

test("Tabelle: jeder SessionStatus einzeln", () => {
  const cases: Array<[string, string]> = [
    ["idle", "idle"],
    ["starting", "listening"],
    ["working", "listening"],
    ["waiting_approval", "approval_pending"],
    ["parked", "idle"],
    ["stopping", "listening"],
    ["stopped", "idle"],
    ["interrupted", "idle"],
    ["error", "error"],
  ];
  for (const [status, expected] of cases) {
    const r = aggregate({ sessions: [session(status)], approvals: [], now: NOW, hubUp: true });
    assert.equal(r.state, expected, `status=${status}`);
    assert.deepEqual(r.unknownStatuses, [], `status=${status} darf nicht unbekannt sein`);
  }
});

test("leerer Hub → idle, Null-Zähler", () => {
  const r = aggregate({ sessions: [], approvals: [], now: NOW, hubUp: true });
  assert.equal(r.state, "idle");
  assert.deepEqual(r.sessions, { total: 0, working: 0, waiting: 0, error: 0 });
  assert.equal(r.approval, null);
  assert.equal(r.pendingCount, 0);
});

test("Mischung working+error → error", () => {
  const r = aggregate({
    sessions: [session("working"), session("error")],
    approvals: [],
    now: NOW,
    hubUp: true,
  });
  assert.equal(r.state, "error");
  assert.deepEqual(r.sessions, { total: 2, working: 1, waiting: 0, error: 1 });
});

test("Mischung pending Approval + error → approval_pending", () => {
  const r = aggregate({
    sessions: [session("working"), session("error")],
    approvals: [approval()],
    now: NOW,
    hubUp: true,
  });
  assert.equal(r.state, "approval_pending");
});

test("Approval timed_out → Rückfall auf Hub-Zustand", () => {
  const r = aggregate({
    sessions: [session("working")],
    approvals: [approval({ status: "timed_out" })],
    now: NOW,
    hubUp: true,
  });
  assert.equal(r.state, "listening");
  assert.equal(r.pendingCount, 0);
});

test("pending, aber timeoutAt vorbei → ignoriert (Hub entscheidet, nicht wir)", () => {
  const r = aggregate({
    sessions: [],
    approvals: [approval({ timeoutAt: "2026-11-03T11:59:00.000Z" })],
    now: NOW,
    hubUp: true,
  });
  assert.equal(r.state, "idle");
  assert.equal(r.approval, null);
});

test("mehrere Approvals: älteste (kürzeste Restzeit) zuerst, +N korrekt", () => {
  const r = aggregate({
    sessions: [],
    approvals: [
      approval({ id: "a".repeat(8) + "-1", timeoutAt: "2026-11-03T12:03:00.000Z" }),
      approval({ id: "b".repeat(8) + "-2", timeoutAt: "2026-11-03T12:01:30.000Z" }),
      approval({ id: "c".repeat(8) + "-3", timeoutAt: "2026-11-03T12:05:00.000Z" }),
    ],
    now: NOW,
    hubUp: true,
  });
  assert.equal(r.pendingCount, 3);
  assert.ok(r.approval);
  assert.equal(r.approval?.action_id, "b".repeat(8) + "-2");
  // Restzeit = 90 s bis 12:01:30
  assert.equal(r.approval?.timeout_s, 90);
});

test("decidable: nur write ohne reasonRequired (ADR-0001)", () => {
  const decidable = aggregate({
    sessions: [], approvals: [approval()], now: NOW, hubUp: true,
  });
  assert.equal(decidable.approval?.decidable, true);

  const destructive = aggregate({
    sessions: [], approvals: [approval({ class: "destructive" })], now: NOW, hubUp: true,
  });
  assert.equal(destructive.approval?.decidable, false);

  const reason = aggregate({
    sessions: [], approvals: [approval({ reasonRequired: true })], now: NOW, hubUp: true,
  });
  assert.equal(reason.approval?.decidable, false);
});

test("Frage (AskUserQuestion) ist nie entscheidbar und als kind=question markiert (ADR-0001, ADR-0009)", () => {
  const q = aggregate({
    sessions: [], approvals: [approval({ tool: "AskUserQuestion" })], now: NOW, hubUp: true,
  });
  assert.equal(q.approval?.kind, "question");
  assert.equal(q.approval?.decidable, false);
  const normal = aggregate({ sessions: [], approvals: [approval()], now: NOW, hubUp: true });
  assert.equal(normal.approval?.kind, "approval");
});

test("unbekannter Session-Status → Protokollfehler-Pfad, nie idle (K9)", () => {
  const r = aggregate({
    sessions: [session("zombie")],
    approvals: [],
    now: NOW,
    hubUp: true,
  });
  assert.equal(r.state, "error");
  assert.deepEqual(r.unknownStatuses, ["zombie"]);
});

test("Hub down → offline schlägt alles (W6)", () => {
  const r = aggregate({
    sessions: [session("error"), session("waiting_approval")],
    approvals: [approval()],
    now: NOW,
    hubUp: false,
  });
  assert.equal(r.state, "offline");
});

test("archivierte Sessions zählen nicht", () => {
  const r = aggregate({
    sessions: [session("error", { archived: true }), session("working")],
    approvals: [],
    now: NOW,
    hubUp: true,
  });
  assert.equal(r.state, "listening");
  assert.deepEqual(r.sessions, { total: 1, working: 1, waiting: 0, error: 0 });
});

test("payload: summary→title, action·tool→body (roh, sanitize ist T1.4)", () => {
  const r = aggregate({ sessions: [], approvals: [approval()], now: NOW, hubUp: true });
  assert.equal(r.approval?.payload.title, "Paket installieren");
  assert.equal(r.approval?.payload.body, "bash.exec · npm install");
});
