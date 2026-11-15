// stage.ts (EPIC-P13 T13.1): Zustand→Darstellung der Bühne als reine
// Funktion — Auswahl des Anzeigezustands („Dringendes schlägt Fokus",
// ADR-0009 Punkt 2) und Abbildung auf Sprite/Aura/Farbe/Zeile/Satz nach
// docs/p13-umsetzungsspezifikation.md §3. Kein DOM, keine Uhr außer
// übergebenen Millisekunden.
import { test } from "node:test";
import assert from "node:assert/strict";
import { stageView, applyVoiceSentence, formatClockLocal, type StageInput } from "../src/stage.ts";
import type { PendingApproval, SessionSummary, WebSessionItem } from "../src/types.ts";

const sessions = (over: Partial<SessionSummary> = {}): SessionSummary => ({ total: 1, working: 0, waiting: 0, error: 0, ...over });

const approval = (kind: "approval" | "question"): PendingApproval => ({
  action_id: "a1",
  kind,
  agent_id: "s1",
  class: "write",
  payload: { title: "Paket installieren", body: "npm install" },
  timeout_s: 100,
  decidable: true,
});

const item = (status: string): WebSessionItem => ({
  id: "s1",
  name: "voidwarden",
  status,
  updatedAt: "2026-11-12T10:00:00.000Z",
  lastActivityAt: null,
  lastAssistantMessage: null,
  attention: false,
});

const input = (over: Partial<StageInput> = {}): StageInput => ({
  wsOffline: false,
  decayed: false,
  frameState: "idle",
  hub: "up",
  approval: null,
  focus: null,
  sessions: sessions(),
  hubDownSinceMs: null,
  ...over,
});

// --- Abbildung display → Darstellung: jede Tabellenzeile aus §3 ----------
const table = [
  { display: "ws_offline", sprite: "offline", colorVar: "--st-offline", aura: "off", line: "GETRENNT", sentence: "Keine Verbindung zum Companion." },
  { display: "offline", sprite: "offline", colorVar: "--st-offline", aura: "off", line: "SCHLÄFT", sentence: "Hub nicht erreichbar." },
  { display: "approval", sprite: "approval_pending", colorVar: "--st-approval", aura: "still", line: "FREIGABE", sentence: "Dein Wort wird verlangt." },
  { display: "question", sprite: "listening", colorVar: "--st-question", aura: "still", line: "FRAGE", sentence: "Eine Wahl steht aus." },
  { display: "error", sprite: "error", colorVar: "--st-error", aura: "still", line: "FEHLER", sentence: "Etwas ist zerbrochen." },
  { display: "executing", sprite: "executing", colorVar: "--st-executing", aura: "breathe", line: "ARBEITET", sentence: "Die Fäden ziehen sich." },
  { display: "success", sprite: "success", colorVar: "--st-success", aura: "breathe", line: "ERLEDIGT", sentence: "So sei es." },
  { display: "listening", sprite: "listening", colorVar: "--st-listening", aura: "breathe", line: "HORCHT", sentence: "Ich höre." },
  { display: "idle", sprite: "idle", colorVar: "--st-idle", aura: "breathe", line: "RUHE", sentence: "Stille im Void." },
  { display: "asleep", sprite: "idle", colorVar: "--st-idle", aura: "off", line: "RUHT", sentence: "Tippe für den letzten Status." },
] as const;

const reach = {
  ws_offline: (): StageInput => input({ wsOffline: true }),
  offline: (): StageInput => input({ hub: "down", frameState: "offline", hubDownSinceMs: null }),
  approval: (): StageInput => input({ approval: approval("approval") }),
  question: (): StageInput => input({ approval: approval("question") }),
  error: (): StageInput => input({ frameState: "error" }),
  executing: (): StageInput => input({ frameState: "executing" }),
  success: (): StageInput => input({ frameState: "success" }),
  listening: (): StageInput => input({ frameState: "listening" }),
  idle: (): StageInput => input({ frameState: "idle" }),
  asleep: (): StageInput => input({ decayed: true }),
};

for (const row of table) {
  test(`T13.1 Tabelle: ${row.display} → ${row.sprite}/${row.colorVar}/${row.aura}/„${row.line}"`, () => {
    const view = stageView(reach[row.display]());
    assert.equal(view.display, row.display);
    assert.equal(view.sprite, row.sprite);
    assert.equal(view.colorVar, row.colorVar);
    assert.equal(view.aura, row.aura);
    assert.equal(view.line, row.line);
    assert.equal(view.sentence, row.sentence);
  });
}

// --- Vorrang: Zeile 1 schlägt 2 schlägt 3 … ------------------------------
test("T13.1 Vorrang: wsOffline schlägt hub down und Freigabe", () => {
  const view = stageView(input({ wsOffline: true, hub: "down", frameState: "offline", approval: approval("approval") }));
  assert.equal(view.display, "ws_offline");
});

test("T13.1 Vorrang: hub down schlägt Frage und Fehler", () => {
  const view = stageView(input({ hub: "down", frameState: "error", approval: approval("question") }));
  assert.equal(view.display, "offline");
});

test("T13.1 Vorrang: Frage schlägt normale Freigabe nur bei kind=question", () => {
  assert.equal(stageView(input({ approval: approval("question"), frameState: "error" })).display, "question");
  assert.equal(stageView(input({ approval: approval("approval"), frameState: "error" })).display, "approval");
});

test("T13.1 Vorrang: Freigabe schlägt Fehler, Fehler schlägt Verfall, Verfall schlägt Fokus", () => {
  assert.equal(stageView(input({ approval: approval("approval"), frameState: "error" })).display, "approval");
  assert.equal(stageView(input({ frameState: "error", decayed: true })).display, "error");
  assert.equal(stageView(input({ decayed: true, focus: item("working") })).display, "asleep");
});

test("T13.1 Fokus-Session: Status → Anzeigezustand; approval_pending gilt als idle", () => {
  assert.equal(stageView(input({ focus: item("working") })).display, "executing");
  assert.equal(stageView(input({ focus: item("error") })).display, "error");
  assert.equal(stageView(input({ focus: item("success") })).display, "success");
  assert.equal(stageView(input({ focus: item("listening") })).display, "listening");
  assert.equal(stageView(input({ focus: item("parked") })).display, "idle");
  // waiting_approval am Fokus ohne projiziertes Approval-Objekt: keine falsche Freigabe-Anzeige
  assert.equal(stageView(input({ focus: item("waiting_approval") })).display, "idle");
});

test("T13.1 asleep nie bei offener Freigabe (AC-P13-1)", () => {
  for (const kind of ["approval", "question"] as const) {
    assert.equal(stageView(input({ decayed: true, approval: approval(kind) })).display, kind === "question" ? "question" : "approval");
  }
});

// --- Zähler-Suffixe an den Grenzen 0/1/2 ---------------------------------
test("T13.1 Zähler: FREIGABE · +N erst ab waiting > 1 (N = waiting − 1)", () => {
  assert.equal(stageView(input({ approval: approval("approval"), sessions: sessions({ waiting: 0 }) })).line, "FREIGABE");
  assert.equal(stageView(input({ approval: approval("approval"), sessions: sessions({ waiting: 1 }) })).line, "FREIGABE");
  assert.equal(stageView(input({ approval: approval("approval"), sessions: sessions({ waiting: 2 }) })).line, "FREIGABE · +1");
});

test("T13.1 Zähler: FRAGE · +N wie Freigabe", () => {
  assert.equal(stageView(input({ approval: approval("question"), sessions: sessions({ waiting: 2 }) })).line, "FRAGE · +1");
});

test("T13.1 Zähler: ARBEITET · N erst ab working > 1", () => {
  assert.equal(stageView(input({ frameState: "executing", sessions: sessions({ working: 1 }) })).line, "ARBEITET");
  assert.equal(stageView(input({ frameState: "executing", sessions: sessions({ working: 2 }) })).line, "ARBEITET · 2");
});

test("T13.1 Zähler: FEHLER · N erst ab error > 1", () => {
  assert.equal(stageView(input({ frameState: "error", sessions: sessions({ error: 1 }) })).line, "FEHLER");
  assert.equal(stageView(input({ frameState: "error", sessions: sessions({ error: 2 }) })).line, "FEHLER · 2");
});

// --- Offline-Satz mit Zeitpunkt ------------------------------------------
test("T13.1 Offline-Satz nennt die Uhrzeit aus hubDownSinceMs (lokale Zeit)", () => {
  const at = Date.UTC(2026, 10, 12, 9, 5, 0);
  const view = stageView(input({ hub: "down", frameState: "offline", hubDownSinceMs: at }));
  assert.equal(view.sentence, `Hub nicht erreichbar seit ${formatClockLocal(at)}`);
});

test("T13.1 formatClockLocal: HH:MM zweistellig", () => {
  // lokale Zeit konstruiert, nicht UTC — Erwartung bleibt in jeder Zeitzone stabil
  assert.equal(formatClockLocal(new Date(2026, 0, 1, 23, 59).getTime()), "23:59");
});

// --- Voice-Satz-Regel (§3): nur ohne Fehler und bei gleichem sprite ------
test("T13.2 Voice-Satz ersetzt den Satz nur bei gleichem Zustand und ohne Fehler", () => {
  const base = stageView(input({ frameState: "idle" }));
  const hit = applyVoiceSentence(base, { state: "idle", phrase: "Ich wache über dich.", error: false });
  assert.equal(hit.sentence, "Ich wache über dich.");
  const miss = applyVoiceSentence(base, { state: "executing", phrase: "Ich arbeite.", error: false });
  assert.equal(miss.sentence, base.sentence);
  const err = applyVoiceSentence(base, { state: "idle", phrase: "TTS kaputt", error: true });
  assert.equal(err.sentence, base.sentence);
});
