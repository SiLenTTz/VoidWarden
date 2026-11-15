// EPIC-P7 T7.12 / P8 T8.11-T8.12 (vorgezogen, ADR-0009): Orchestrierung von Fokus, Tap-Status, Wechsel,
// Ack und Idle-Chatter. Senke, Zeit und Zufall sind injiziert; kein Test hängt von echter Zeit ab.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Interaction, type InteractionSink } from "../src/interaction.ts";
import { aggregate, type ApprovalInput, type SessionInput } from "../src/aggregate.ts";
import type { BubbleSpec } from "../src/bridge.ts";
import type { FocusView } from "../src/focus.ts";

const T0 = Date.parse("2026-11-05T12:00:00.000Z");
const OPTS = { focusHoldS: 30, tapHoldS: 8, staleAfterS: 30, chatter: { enabled: true, minGapS: 90, jitterS: 60 } };

class Sink implements InteractionSink {
  focus: Array<FocusView | null> = [];
  bubbles: BubbleSpec[] = [];
  acks: string[] = [];
  reports: Array<{ sessionId: string; title: string; body: string }> = [];
  critical = false;
  setReport(r: { sessionId: string; title: string; body: string }): void {
    this.reports.push(r);
  }
  setFocus(v: FocusView | null): void {
    this.focus.push(v);
  }
  showBubble(b: BubbleSpec): void {
    this.bubbles.push(b);
  }
  ackBubble(id: string): void {
    this.acks.push(id);
  }
  hasCriticalBubble(): boolean {
    return this.critical;
  }
}

const apr = (sessionId: string, extra: Partial<ApprovalInput> = {}): ApprovalInput => ({
  id: "0e0f1e2e-3b4c-4d5e-8f9a-a1b2c3d4e5f6",
  sessionId,
  status: "pending",
  class: "write",
  summary: "Datei schreiben",
  action: "write",
  tool: "Edit",
  reasonRequired: false,
  timeoutAt: new Date(T0 + 120_000).toISOString(),
  ...extra,
});

function setup(rng: () => number = () => 0) {
  const sink = new Sink();
  const it = new Interaction(sink, OPTS, rng, T0);
  const feed = (sessions: SessionInput[], approvals: ApprovalInput[], nowMs: number, hubUp = true) =>
    it.onHub({ sessions, approvals, agg: aggregate({ sessions, approvals, now: new Date(nowMs).toISOString(), hubUp }), hubUp }, nowMs);
  return { sink, it, feed };
}

const S = (id: string, status: string): SessionInput => ({ id, status });

test("onHub: Auto-Fokus liegt auf der Session mit Freigabe", () => {
  const { sink, feed } = setup();
  feed([S("aaaaaa-1", "working"), S("bbbbbb-2", "waiting_approval")], [apr("bbbbbb-2")], T0);
  assert.deepEqual(sink.focus.at(-1), { idx: 2, total: 2, ref: "bbbbbb", name: "Agent bbbbbb", status: "approval", pinned: false });
});

test("focus_next wechselt, fixiert und fällt nach focusHoldS auf den Auto-Fokus zurück", () => {
  const { sink, it, feed } = setup();
  const sessions = [S("aaaaaa-1", "working"), S("bbbbbb-2", "idle")];
  feed(sessions, [], T0);
  it.onUiAction({ action: "focus_next" }, T0 + 1000);
  assert.deepEqual(sink.focus.at(-1), { idx: 2, total: 2, ref: "bbbbbb", name: "Agent bbbbbb", status: "idle", pinned: true });
  feed(sessions, [], T0 + 29_000);
  assert.equal(sink.focus.at(-1)?.ref, "bbbbbb");
  feed(sessions, [], T0 + 31_001);
  assert.deepEqual(sink.focus.at(-1), { idx: 1, total: 2, ref: "aaaaaa", name: "Agent aaaaaa", status: "working", pinned: false });
});

test("keine Sessions → Fokus null", () => {
  const { sink, feed } = setup();
  feed([], [], T0);
  assert.equal(sink.focus.at(-1), null);
});

test("status_tap: Blase info mit Alias, Position und Gesamtzeile; Halten = tapHoldS; keine Bestätigung nötig", () => {
  const { sink, it, feed } = setup();
  feed([S("aaaaaa-1", "working"), S("bbbbbb-2", "idle")], [], T0);
  it.onUiAction({ action: "status_tap" }, T0 + 500);
  assert.equal(sink.bubbles.length, 1);
  const b = sink.bubbles[0] as BubbleSpec;
  assert.equal(b.level, "info");
  assert.equal(b.ackRequired, false);
  assert.equal(b.holdS, 8);
  assert.equal(b.title, "Agent aaaaaa (1/2)");
  assert.equal(b.body, "Arbeitet. Gesamt: 1 arbeitet.");
});

test("status_tap bei offener Freigabe: ignoriert (Freigabe-Modal bleibt, ADR-0009 §3)", () => {
  const { sink, it, feed } = setup();
  feed([S("aaaaaa-1", "waiting_approval")], [apr("aaaaaa-1")], T0);
  it.onUiAction({ action: "status_tap" }, T0 + 500);
  assert.equal(sink.bubbles.length, 0);
});

test("status_tap verdeckt keine kritische Blase", () => {
  const { sink, it, feed } = setup();
  feed([S("aaaaaa-1", "working")], [], T0);
  sink.critical = true;
  it.onUiAction({ action: "status_tap" }, T0 + 500);
  assert.equal(sink.bubbles.length, 0);
});

test("status_tap ohne Session sagt es ehrlich; Hub weg wird benannt", () => {
  const { sink, it, feed } = setup();
  feed([], [], T0);
  it.onUiAction({ action: "status_tap" }, T0 + 100);
  assert.deepEqual([sink.bubbles[0]?.title, sink.bubbles[0]?.body], ["Nyx", "Keine aktive Session."]);

  const b = setup();
  b.feed([S("aaaaaa-1", "working")], [], T0, false);
  b.it.onUiAction({ action: "status_tap" }, T0 + 130_000);
  assert.match(b.sink.bubbles[0]?.body ?? "", /^Hub nicht erreichbar\. Letzter Stand vor 2 Min: Arbeitet\./);
});

test("status_tap zeigt einen veralteten Stand als solchen", () => {
  const { sink, it, feed } = setup();
  feed([S("aaaaaa-1", "working")], [], T0);
  it.onUiAction({ action: "status_tap" }, T0 + 45_000);
  assert.match(sink.bubbles[0]?.body ?? "", /^Stand veraltet\. Letzter Stand vor 45 s: Arbeitet\./);
});

test("bubble_ack reicht die bubble_id an die Senke; ohne ref passiert nichts", () => {
  const { sink, it } = setup();
  it.onUiAction({ action: "bubble_ack", ref: "b-0007" }, T0);
  it.onUiAction({ action: "bubble_ack" }, T0);
  assert.deepEqual(sink.acks, ["b-0007"]);
});

test("Chatter: nach minGap im Zustand idle eine info-Blase von Nyx, danach erst nach erneutem Abstand", () => {
  const { sink, it, feed } = setup();
  feed([S("aaaaaa-1", "idle")], [], T0);
  it.tick(T0 + 89_000);
  assert.equal(sink.bubbles.length, 0);
  it.tick(T0 + 90_000);
  assert.equal(sink.bubbles.length, 1);
  const b = sink.bubbles[0] as BubbleSpec;
  assert.deepEqual([b.title, b.level, b.ackRequired, b.holdS], ["Nyx", "info", false, 6]);
  it.tick(T0 + 120_000);
  assert.equal(sink.bubbles.length, 1, "nicht zweimal innerhalb des Abstands");
  it.tick(T0 + 181_000);
  assert.equal(sink.bubbles.length, 2);
});

test("Chatter schweigt bei Arbeit, Freigabe, Frage, kritischer Blase und laufender Blase", () => {
  const cases: Array<[string, (c: ReturnType<typeof setup>) => void]> = [
    ["listening", (c) => c.feed([S("aaaaaa-1", "working")], [], T0)],
    ["Freigabe", (c) => c.feed([S("aaaaaa-1", "waiting_approval")], [apr("aaaaaa-1")], T0)],
    ["Frage", (c) => c.feed([S("aaaaaa-1", "waiting_approval")], [apr("aaaaaa-1", { tool: "AskUserQuestion" })], T0)],
    ["kritisch", (c) => { c.feed([S("aaaaaa-1", "idle")], [], T0); c.sink.critical = true; }],
    ["Hub weg", (c) => c.feed([S("aaaaaa-1", "idle")], [], T0, false)],
  ];
  for (const [name, arrange] of cases) {
    const c = setup();
    arrange(c);
    c.it.tick(T0 + 10_000_000);
    assert.equal(c.sink.bubbles.length, 0, name);
  }
  // laufende Tap-Blase (8 s) blockiert den Chatter bis zum Ablauf
  const c = setup();
  c.feed([S("aaaaaa-1", "idle")], [], T0);
  c.it.onUiAction({ action: "status_tap" }, T0 + 95_000);
  c.it.tick(T0 + 99_000);
  assert.equal(c.sink.bubbles.length, 1, "während der Tap-Blase kein Chatter");
});

test("Chatter aus (enabled=false) und vor dem ersten Hub-Stand: nie", () => {
  const sink = new Sink();
  const off = new Interaction(sink, { ...OPTS, chatter: { ...OPTS.chatter, enabled: false } }, () => 0, T0);
  off.tick(T0 + 10_000_000);
  assert.equal(sink.bubbles.length, 0);
  const noHub = setup();
  noHub.it.tick(T0 + 10_000_000);
  assert.equal(noHub.sink.bubbles.length, 0, "ohne Hub-Stand ist der Zustand unbekannt");
});

// ADR-0010: letzte Agent-Nachricht der fokussierten Session läuft im Tickerband und steht im Tap-Status.
test("setLastMessage: fokussierte Session → Report mit Namen als Titel; gleicher Text nur einmal", () => {
  const { sink, it, feed } = setup();
  feed([{ id: "aaaaaa-1", status: "idle", project: "/p/voidwarden" }], [], T0);
  it.setLastMessage("aaaaaa-1", "Merge fertig.");
  it.setLastMessage("aaaaaa-1", "Merge fertig.");
  assert.deepEqual(sink.reports, [{ sessionId: "aaaaaa-1", title: "voidwarden", body: "Merge fertig." }]);
  it.setLastMessage("aaaaaa-1", "Neuer Stand.");
  assert.equal(sink.reports.length, 2);
});

test("Report einer nicht fokussierten Session wartet; Fokuswechsel liefert ihn nach", () => {
  const { sink, it, feed } = setup();
  feed([S("aaaaaa-1", "working"), S("bbbbbb-2", "idle")], [], T0);
  it.setLastMessage("bbbbbb-2", "B fertig.");
  assert.equal(sink.reports.length, 0);
  it.onUiAction({ action: "focus_next" }, T0 + 1000);
  assert.deepEqual(sink.reports.at(-1), { sessionId: "bbbbbb-2", title: "Agent bbbbbb", body: "B fertig." });
});

test("focusedSession liefert ID und Hub-seq der Fokus-Session für den Nachladen-Takt", () => {
  const { it, feed } = setup();
  assert.equal(it.focusedSessionId(), null);
  feed([S("aaaaaa-1", "working")], [], T0);
  assert.equal(it.focusedSessionId(), "aaaaaa-1");
});

test("status_tap nennt die letzte Nachricht und hält länger", () => {
  const { sink, it, feed } = setup();
  feed([S("aaaaaa-1", "idle")], [], T0);
  it.setLastMessage("aaaaaa-1", "Merge fertig, Gate grün.");
  it.onUiAction({ action: "status_tap" }, T0 + 500);
  const b = sink.bubbles[0] as BubbleSpec;
  assert.equal(b.body, "Im Leerlauf. Zuletzt: Merge fertig, Gate grün.");
  assert.equal(b.holdS, 14);
});
