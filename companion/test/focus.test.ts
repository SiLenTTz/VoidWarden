// EPIC-P7 T7.12 (vorgezogen, ADR-0009): Auto-Fokus-Priorität, Wechsel, Rückfallzeit. Uhr injiziert,
// kein Zufall im Code unter Test (die Property nutzt einen festen LCG-Seed).
import { test } from "node:test";
import assert from "node:assert/strict";
import { FocusController, toFocusSessions, type FocusSession, type FocusStatus } from "../src/focus.ts";
import type { ApprovalInput } from "../src/aggregate.ts";

const s = (ref: string, status: FocusStatus, timeoutS?: number): FocusSession =>
  timeoutS === undefined ? { ref, name: ref, status } : { ref, name: ref, status, timeoutS };

const HOLD = 30;
const ctl = () => new FocusController({ holdS: HOLD });

test("Priorität: Freigabe/Frage > Fehler > arbeitet > idle > Rest", () => {
  const cases: Array<[FocusSession[], string]> = [
    [[s("a", "idle"), s("b", "working"), s("c", "error"), s("d", "approval", 60)], "d"],
    [[s("a", "idle"), s("b", "working"), s("c", "error"), s("d", "question", 60)], "d"],
    [[s("a", "idle"), s("b", "working"), s("c", "error")], "c"],
    [[s("a", "idle"), s("b", "working")], "b"],
    [[s("a", "other"), s("b", "idle")], "b"],
    [[s("a", "other")], "a"],
  ];
  for (const [sessions, expected] of cases) {
    assert.equal(ctl().update(sessions, 0)?.ref, expected, JSON.stringify(sessions));
  }
});

test("Tie-Break: kürzeste Restzeit, dann Listenposition; Frage und Freigabe gleichrangig", () => {
  assert.equal(ctl().update([s("a", "approval", 90), s("b", "question", 20)], 0)?.ref, "b");
  assert.equal(ctl().update([s("a", "approval", 30), s("b", "approval", 30)], 0)?.ref, "a");
  assert.equal(ctl().update([s("a", "working"), s("b", "working")], 0)?.ref, "a");
  // ohne bekannte Restzeit ist eine Freigabe weniger dringend als eine mit Frist
  assert.equal(ctl().update([s("a", "approval"), s("b", "approval", 500)], 0)?.ref, "b");
});

test("Ansicht: idx 1-basiert in Listenreihenfolge, total, ref, status, pinned", () => {
  const v = ctl().update([s("a", "idle"), s("b", "working"), s("c", "idle")], 0);
  assert.deepEqual(v, { idx: 2, total: 3, ref: "b", name: "b", status: "working", pinned: false });
});

test("leere Liste → kein Fokus; next ohne Sessions ist ein No-op", () => {
  const c = ctl();
  assert.equal(c.update([], 0), null);
  assert.equal(c.next(0), null);
});

test("next wechselt in Listenreihenfolge zyklisch und fixiert", () => {
  const c = ctl();
  const list = [s("a", "working"), s("b", "idle"), s("c", "idle")];
  assert.equal(c.update(list, 0)?.ref, "a");
  assert.deepEqual(c.next(1000), { idx: 2, total: 3, ref: "b", name: "b", status: "idle", pinned: true });
  assert.equal(c.next(2000)?.ref, "c");
  assert.equal(c.next(3000)?.ref, "a");
  // ein Update ändert die Fixierung nicht
  assert.equal(c.update(list, 4000)?.ref, "a");
});

test("einzelne Session: next bleibt auf ihr und fixiert nichts", () => {
  const c = ctl();
  c.update([s("a", "idle")], 0);
  assert.deepEqual(c.next(10), { idx: 1, total: 1, ref: "a", name: "a", status: "idle", pinned: false });
});

test("Rückfallzeit: nach holdS gilt wieder der Auto-Fokus", () => {
  const c = ctl();
  const list = [s("a", "working"), s("b", "idle")];
  c.update(list, 0);
  c.next(0); // fixiert b
  assert.equal(c.update(list, HOLD * 1000 - 1)?.ref, "b");
  const back = c.update(list, HOLD * 1000);
  assert.equal(back?.ref, "a");
  assert.equal(back?.pinned, false);
});

test("neue Freigabe/Frage in anderer Session löst die Fixierung sofort", () => {
  const c = ctl();
  c.update([s("a", "working"), s("b", "idle")], 0);
  c.next(0); // fixiert b
  const v = c.update([s("a", "approval", 50), s("b", "idle")], 1000);
  assert.equal(v?.ref, "a");
  assert.equal(v?.pinned, false);
});

test("bereits bekannte Freigabe in anderer Session löst die Fixierung nicht", () => {
  const c = ctl();
  const list = [s("a", "approval", 50), s("b", "idle")];
  c.update(list, 0);
  assert.equal(c.next(0)?.ref, "b"); // Nutzer schaut bewusst auf b
  assert.equal(c.update(list, 1000)?.ref, "b");
});

test("neue Freigabe in der fixierten Session selbst löst nichts aus", () => {
  const c = ctl();
  c.update([s("a", "working"), s("b", "idle")], 0);
  c.next(0); // b
  const v = c.update([s("a", "working"), s("b", "approval", 40)], 1000);
  assert.equal(v?.ref, "b");
});

test("fixierte Session verschwindet → Auto-Fokus", () => {
  const c = ctl();
  c.update([s("a", "idle"), s("b", "working")], 0);
  c.next(0); // Auto-Fokus ist b (arbeitet), next fixiert a
  assert.equal(c.update([s("a", "idle"), s("b", "working")], 1)?.ref, "a");
  const v = c.update([s("b", "working")], 2); // a verschwindet
  assert.equal(v?.ref, "b");
  assert.equal(v?.pinned, false);
});

test("Property (fester Seed): Fokus ist immer eine vorhandene Session; ohne Fixierung nie niedriger als das Beste", () => {
  let seed = 4242;
  const rnd = (n: number) => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed % n;
  };
  const statuses: FocusStatus[] = ["approval", "question", "error", "working", "idle", "other"];
  const rank: Record<FocusStatus, number> = { approval: 0, question: 0, error: 1, working: 2, idle: 3, other: 4 };
  for (let i = 0; i < 400; i++) {
    const n = rnd(7);
    const list = Array.from({ length: n }, (_, k) => s(`r${k}`, statuses[rnd(statuses.length)] as FocusStatus, rnd(200)));
    const c = ctl();
    const v = c.update(list, i);
    if (n === 0) {
      assert.equal(v, null);
      continue;
    }
    assert.ok(v !== null && list.some((x) => x.ref === v.ref));
    const best = Math.min(...list.map((x) => rank[x.status]));
    assert.equal(rank[v.status], best);
    assert.deepEqual(c.update(list, i), v); // deterministisch, idempotent
  }
});

// --- Mapping Hub-Stand → Fokus-Sessions (ADR-0009) ---
const NOW_MS = Date.parse("2026-11-05T12:00:00.000Z");
const apr = (sessionId: string, extra: Partial<ApprovalInput> = {}): ApprovalInput => ({
  id: "0e0f1e2e-3b4c-4d5e-8f9a-a1b2c3d4e5f6",
  sessionId,
  status: "pending",
  class: "write",
  summary: "Datei schreiben",
  action: "write",
  tool: "Edit",
  reasonRequired: false,
  timeoutAt: "2026-11-05T12:01:00.000Z",
  ...extra,
});

test("Mapping: Status je Hub-Session, archivierte raus, ref = erste 6 Zeichen der ID", () => {
  const out = toFocusSessions(
    [
      { id: "aaaaaa11-0000", status: "working" },
      { id: "bbbbbb22-0000", status: "idle" },
      { id: "cccccc33-0000", status: "error" },
      { id: "dddddd44-0000", status: "parked" },
      { id: "eeeeee55-0000", status: "stopping" },
      { id: "ffffff66-0000", status: "working", archived: true },
      { id: "gggggg77-0000", status: "zombie" },
    ],
    [],
    NOW_MS,
  );
  assert.deepEqual(
    out.map((x) => [x.ref, x.status]),
    [
      ["aaaaaa", "working"],
      ["bbbbbb", "idle"],
      ["cccccc", "error"],
      ["dddddd", "other"],
      ["eeeeee", "working"],
      ["gggggg", "error"], // unbekannter Status ist ein Protokollfehler, nie idle (K9)
    ],
  );
});

test("Mapping: offene Freigabe → approval mit Restzeit und Summary; Frage → question", () => {
  const out = toFocusSessions(
    [
      { id: "aaaaaa11", status: "waiting_approval" },
      { id: "bbbbbb22", status: "waiting_approval" },
      { id: "cccccc33", status: "working" },
    ],
    [apr("aaaaaa11"), apr("bbbbbb22", { tool: "AskUserQuestion", summary: "Welche Variante?", timeoutAt: "2026-11-05T12:00:20.000Z" })],
    NOW_MS,
  );
  assert.deepEqual(out[0], { ref: "aaaaaa", name: "Agent aaaaaa", id: "aaaaaa11", status: "approval", timeoutS: 60, summary: "Datei schreiben" });
  assert.deepEqual(out[1], { ref: "bbbbbb", name: "Agent bbbbbb", id: "bbbbbb22", status: "question", timeoutS: 20, summary: "Welche Variante?" });
  assert.deepEqual(out[2], { ref: "cccccc", name: "Agent cccccc", id: "cccccc33", status: "working" });
});

test("Mapping: abgelaufene oder entschiedene Freigaben zählen nicht; waiting_approval ohne Freigabe bleibt approval", () => {
  const out = toFocusSessions(
    [
      { id: "aaaaaa11", status: "working" },
      { id: "bbbbbb22", status: "waiting_approval" },
    ],
    [apr("aaaaaa11", { timeoutAt: "2026-11-05T11:59:59.000Z" }), apr("aaaaaa11", { status: "approved" })],
    NOW_MS,
  );
  assert.equal(out[0]?.status, "working");
  assert.deepEqual(out[1], { ref: "bbbbbb", name: "Agent bbbbbb", id: "bbbbbb22", status: "approval" });
});

test("Mapping: mehrere Freigaben einer Session → die mit der kürzesten Restzeit", () => {
  const out = toFocusSessions(
    [{ id: "aaaaaa11", status: "waiting_approval" }],
    [apr("aaaaaa11", { summary: "später", timeoutAt: "2026-11-05T12:05:00.000Z" }), apr("aaaaaa11", { summary: "bald", timeoutAt: "2026-11-05T12:00:10.000Z" })],
    NOW_MS,
  );
  assert.equal(out[0]?.summary, "bald");
  assert.equal(out[0]?.timeoutS, 10);
});

test("Mapping: fehlende ID → ref s<Position>, doppelte Präfixe werden eindeutig", () => {
  const noId = toFocusSessions([{ status: "idle" }, { status: "idle" }], [], NOW_MS);
  assert.deepEqual(noId.map((x) => x.ref), ["s1", "s2"]);
  const dup = toFocusSessions([{ id: "abcdef-1111", status: "idle" }, { id: "abcdef-2222", status: "idle" }], [], NOW_MS);
  assert.equal(new Set(dup.map((x) => x.ref)).size, 2);
  for (const x of dup) assert.ok(x.ref.length <= 8);
});

// ADR-0008 §6: angezeigt wird der Titel nur bei titleSource=manual (bereinigt), sonst Adapter + Kurz-ID.
const SID = "4a19b97f-a8da-41b9-82f0-87642b77d004";

test("Alias ohne manuellen Titel: Adapter und Kurz-ID, nie der Prompt-Titel", () => {
  const [s] = toFocusSessions(
    [{ id: SID, status: "working", adapter: "claude", title: "Alle Nyx Features einbauen", titleSource: "ai" }],
    [],
    0,
  );
  assert.equal(s?.name, "claude 4a19b9");
  assert.doesNotMatch(String(s?.name), /Nyx/);
});

test("manueller Titel wird gezeigt, bereinigt und auf 16 Zeichen gekürzt", () => {
  const [s] = toFocusSessions(
    [{ id: SID, status: "idle", adapter: "claude", title: "  Mein\n Refactor\tmit   Umbruch und mehr ", titleSource: "manual" }],
    [],
    0,
  );
  assert.equal(s?.name, "Mein Refactor mi");
  assert.ok(String(s?.name).length <= 16);
});

test("Fehlende Angaben fallen auf den alten Alias zurück; leerer manueller Titel auch", () => {
  const [a] = toFocusSessions([{ id: SID, status: "idle" }], [], 0);
  assert.equal(a?.name, "Agent 4a19b9");
  const [b] = toFocusSessions([{ id: SID, status: "idle", adapter: "codex", title: "   ", titleSource: "manual" }], [], 0);
  assert.equal(b?.name, "codex 4a19b9");
});

test("Langer Adapter-Name wird gekürzt, der Alias bleibt ≤ 16 Zeichen", () => {
  const [s] = toFocusSessions([{ id: SID, status: "idle", adapter: "securesight-harnez" }], [], 0);
  assert.ok(String(s?.name).length <= 16, String(s?.name));
  assert.match(String(s?.name), /4a19b9$/);
});

test("FocusView trägt den Namen der fokussierten Session", () => {
  const c = new FocusController({ holdS: 30 });
  const sessions = toFocusSessions([{ id: SID, status: "working", adapter: "claude" }], [], 0);
  const v = c.update(sessions, 0);
  assert.equal(v?.name, "claude 4a19b9");
});

// ADR-0010: links oben steht der Projektname (Verzeichnisname des Hub-Felds `project`).
test("Projektname schlägt Adapter-Alias und manuellen Titel", () => {
  const [a] = toFocusSessions([{ id: SID, status: "idle", adapter: "claude", project: "/mnt/x/arbeitsbaeume/voidwarden" }], [], 0);
  assert.equal(a?.name, "voidwarden");
  const [b] = toFocusSessions(
    [{ id: SID, status: "idle", adapter: "claude", project: "/p/repo/", title: "Mein Titel", titleSource: "manual" }],
    [],
    0,
  );
  assert.equal(b?.name, "repo");
});

test("Projektname wird bereinigt und auf 16 Zeichen gekürzt; Unbrauchbares fällt zurück", () => {
  const [a] = toFocusSessions([{ id: SID, status: "idle", project: "/p/ein-sehr-langer-projektname-mit-ende" }], [], 0);
  assert.equal(a?.name, "ein-sehr-langer-");
  const [b] = toFocusSessions([{ id: SID, status: "idle", adapter: "codex", project: "/" }], [], 0);
  assert.equal(b?.name, "codex 4a19b9");
  const [c] = toFocusSessions([{ id: SID, status: "idle", project: "/p/a\u001b[31mb" }], [], 0);
  assert.ok(!String(c?.name).includes("\u001b"));
});

test("FocusSession trägt die Hub-ID (für den letzten Report)", () => {
  const [a] = toFocusSessions([{ id: SID, status: "idle" }], [], 0);
  assert.equal(a?.id, SID);
});
