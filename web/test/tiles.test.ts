// tiles.ts (EPIC-P13 T13.4, Umsetzungsspezifikation §4.3): Zustandspunkt und
// Kacheltexte als reine Abbildung — Punkt in Farbe/Form/Bewegung (Klasse),
// Titel-Rückfall auf den Projektnamen, Aktivitätszeile, Sortierung
// „braucht dich zuerst". Kein DOM, keine Uhr außer übergebenen Millisekunden.
import { test } from "node:test";
import assert from "node:assert/strict";
import { tileDot, tileName, tileSecondLine, sortTiles, TILE_DONE_WINDOW_MS, type TileDot } from "../src/tiles.ts";
import type { WebSessionItem } from "../src/types.ts";

const NOW = Date.parse("2026-11-12T12:00:00.000Z");
const FRESH = "2026-11-12T11:30:00.000Z"; // 30 min vor NOW

const mk = (over: Partial<WebSessionItem> = {}): WebSessionItem => ({
  id: "s1",
  name: "voidwarden",
  status: "parked",
  updatedAt: FRESH,
  lastActivityAt: null,
  lastAssistantMessage: null,
  attention: false,
  ...over,
});

// --- Punkt-Tabelle aus §4.3: erste zutreffende Zeile gewinnt ----------------
const dotTable: Array<{ name: string; item: WebSessionItem; dot: TileDot }> = [
  { name: "status error ⇒ err (eckig, rot)", item: mk({ status: "error" }), dot: "err" },
  { name: "needs question ⇒ ask (blau, Hof)", item: mk({ needs: "question", status: "working" }), dot: "ask" },
  { name: "needs approval ⇒ call (Amber, Hof)", item: mk({ needs: "approval", status: "idle" }), dot: "call" },
  { name: "attention ⇒ call", item: mk({ attention: true }), dot: "call" },
  { name: "status working ⇒ work (atmet)", item: mk({ status: "working" }), dot: "work" },
  { name: "status starting ⇒ work", item: mk({ status: "starting" }), dot: "work" },
  { name: "status stopping ⇒ work", item: mk({ status: "stopping" }), dot: "work" },
  { name: "status idle und frisch ⇒ done (offener Ring)", item: mk({ status: "idle", updatedAt: "2026-11-12T11:44:59.000Z" }), dot: "done" },
  { name: "status idle und alt ⇒ calm", item: mk({ status: "idle", updatedAt: "2026-11-12T10:00:00.000Z" }), dot: "calm" },
  { name: "status parked ⇒ calm", item: mk({ status: "parked" }), dot: "calm" },
  { name: "unbekannter Status ⇒ calm", item: mk({ status: "teleporting" }), dot: "calm" },
];

for (const row of dotTable) {
  test(`T13.4 Punkt: ${row.name}`, () => {
    assert.equal(tileDot(row.item, NOW), row.dot);
  });
}

test("T13.4 Punkt: Grenze 45 min genau — idle ist nicht mehr jünger ⇒ calm", () => {
  const at45 = new Date(NOW - TILE_DONE_WINDOW_MS).toISOString();
  assert.equal(tileDot(mk({ status: "idle", updatedAt: at45 }), NOW), "calm");
  const justBefore = new Date(NOW - TILE_DONE_WINDOW_MS + 1).toISOString();
  assert.equal(tileDot(mk({ status: "idle", updatedAt: justBefore }), NOW), "done");
});

test("T13.4 Punkt-Vorrang: error schlägt needs und attention", () => {
  assert.equal(tileDot(mk({ status: "error", needs: "approval", attention: true }), NOW), "err");
});

test("T13.4 Punkt-Vorrang: needs question schlägt working", () => {
  assert.equal(tileDot(mk({ status: "working", needs: "question" }), NOW), "ask");
});

// --- Titel-Rückfall und Aktivitätszeile -------------------------------------
test("T13.4 Titel: gesetzt ⇒ Titel, leer/fehlend ⇒ Projektname", () => {
  assert.equal(tileName(mk({ title: "Fix memory leak" })), "Fix memory leak");
  assert.equal(tileName(mk({ title: "" })), "voidwarden");
  assert.equal(tileName(mk()), "voidwarden");
});

test("T13.4 Zweite Zeile: Aktivität · Zeit, ohne Aktivität nur Zeit", () => {
  assert.equal(tileSecondLine(mk({ activity: "npm install" }), "vor 2 min"), "npm install · vor 2 min");
  assert.equal(tileSecondLine(mk({ activity: "" }), "vor 2 min"), "vor 2 min");
  assert.equal(tileSecondLine(mk(), "vor 2 min"), "vor 2 min");
});

// --- Sortierung: „braucht dich" zuerst --------------------------------------
test("T13.4 Sortierung: needs zuerst (älteste zuerst), dann error, dann Rest nach updatedAt absteigend", () => {
  const list = [
    mk({ id: "work-new", status: "working", updatedAt: "2026-11-12T11:58:00.000Z" }),
    mk({ id: "need-old", needs: "approval", updatedAt: "2026-11-12T10:00:00.000Z" }),
    mk({ id: "err-old", status: "error", updatedAt: "2026-11-12T09:00:00.000Z" }),
    mk({ id: "need-new", needs: "question", updatedAt: "2026-11-12T11:00:00.000Z" }),
    mk({ id: "work-old", status: "working", updatedAt: "2026-11-12T11:10:00.000Z" }),
    mk({ id: "err-new", status: "error", updatedAt: "2026-11-12T11:40:00.000Z" }),
  ];
  assert.deepEqual(sortTiles(list).map((s) => s.id), ["need-old", "need-new", "err-old", "err-new", "work-new", "work-old"]);
});

test("T13.4 Sortierung: verändert die Eingabe nicht", () => {
  const list = [mk({ id: "b", updatedAt: "2026-11-12T11:00:00.000Z" }), mk({ id: "a", updatedAt: "2026-11-12T11:30:00.000Z" })];
  sortTiles(list);
  assert.deepEqual(list.map((s) => s.id), ["b", "a"]);
});
