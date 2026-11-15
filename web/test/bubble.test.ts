// EPIC-P11 T11.2/T11.3: Sprechblasen-Queue + Fokus-Session — reine Funktionen.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  pushBubble, tickBubble, dismissBubble, initialBubbleState,
  focusSession, statusToNyxState, statusBubbleFor, BUBBLE_QUEUE_MAX,
} from "../src/bubble.ts";
import type { WebSessionItem } from "../src/types.ts";

const item = (over: Partial<WebSessionItem>): WebSessionItem => ({
  id: "s1", name: "alpha", status: "working",
  updatedAt: "2026-11-07T10:00:00.000Z", lastActivityAt: null,
  lastAssistantMessage: null, attention: false, ...over,
});

test("pushBubble: erste Blase sofort sichtbar, weitere queue", () => {
  let s = initialBubbleState();
  s = pushBubble(s, { kind: "ticker", title: "a", body: "x", atMs: 1000 });
  assert.equal(s.visible?.title, "a");
  s = pushBubble(s, { kind: "status", title: "b", body: "y", atMs: 2000 });
  assert.equal(s.visible?.title, "a"); // max 1 sichtbar
  assert.equal(s.queue.length, 1);
});

test("tickBubble: auto-hide nach BUBBLE_HIDE_MS, nächste rückt nach", () => {
  let s = initialBubbleState();
  s = pushBubble(s, { kind: "ticker", title: "a", body: "x", atMs: 1000 });
  s = pushBubble(s, { kind: "status", title: "b", body: "y", atMs: 1500 });
  assert.equal(s.visible?.title, "a");
  s = tickBubble(s, 8999); // hide = atMs + 8000 = 9000
  assert.equal(s.visible?.title, "a"); // noch nicht fällig
  s = tickBubble(s, 9000);
  assert.equal(s.visible?.title, "b"); // nächste nachgezogen
  s = tickBubble(s, 9500 + 1); // b: 1500 + 8000 = 9500
  assert.equal(s.visible, null);
  assert.equal(s.queue.length, 0);
});

test("pushBubble: Queue begrenzt — Überhang zählt in dropped, nie still", () => {
  let s = initialBubbleState();
  for (let i = 0; i <= BUBBLE_QUEUE_MAX + 2; i++) {
    s = pushBubble(s, { kind: "hint", title: `t${String(i)}`, body: "", atMs: 1000 + i });
  }
  assert.equal(s.queue.length, BUBBLE_QUEUE_MAX);
  assert.equal(s.dropped, 2);
});

test("dismissBubble: Tap blendet aus, nächste sofort sichtbar", () => {
  let s = initialBubbleState();
  s = pushBubble(s, { kind: "ticker", title: "a", body: "x", atMs: 1000 });
  s = pushBubble(s, { kind: "status", title: "b", body: "y", atMs: 2000 });
  s = dismissBubble(s);
  assert.equal(s.visible?.title, "b");
});

test("focusSession: zuletzt aktive Session gewinnt", () => {
  const a = item({ id: "a", updatedAt: "2026-11-07T10:00:00.000Z" });
  const b = item({ id: "b", updatedAt: "2026-11-07T11:30:00.000Z" });
  const c = item({ id: "c", updatedAt: "2026-11-07T09:00:00.000Z" });
  assert.equal(focusSession([a, b, c])?.id, "b");
  assert.equal(focusSession([]), null);
});

test("statusToNyxState: Hub-Status mappen, unbekannt → idle", () => {
  assert.equal(statusToNyxState("working"), "executing");
  assert.equal(statusToNyxState("waiting"), "approval_pending");
  assert.equal(statusToNyxState("error"), "error");
  assert.equal(statusToNyxState("success"), "success");
  assert.equal(statusToNyxState("irgendwas"), "idle");
});

test("statusBubbleFor: Fokus-Session → Status-Blase mit Δt oder Nachricht", () => {
  const now = Date.parse("2026-11-07T10:05:00.000Z");
  const b1 = statusBubbleFor(item({ updatedAt: "2026-11-07T10:00:00.000Z" }), now);
  assert.match(b1.body, /seit 5 min/);
  const b2 = statusBubbleFor(item({ lastAssistantMessage: "Zug beendet" }), now);
  assert.equal(b2.body, "Zug beendet");
  assert.equal(b2.kind, "status");
});
