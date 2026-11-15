// EPIC-P8 T8.11 (vorgezogen, ADR-0009): Tap-Status der fokussierten Session — nur Hub-Zahlen und
// bereinigte Anzeige-Felder, nichts erfunden (AC-P8-1, W10). Titel ≤ 40, Body ≤ 160 (2×80, K5).
import { test } from "node:test";
import assert from "node:assert/strict";
import { composeSessionStatus, type SessionStatusInput } from "../src/composer.ts";

const base: SessionStatusInput = {
  focus: { idx: 1, total: 1, ref: "3f9a2c", status: "working" },
  working: 1,
  blocked: 0,
  error: 0,
  hubUp: true,
  dataAgeS: 2,
};

test("Tabelle: Text je Fokus-Status", () => {
  const cases: Array<[Partial<SessionStatusInput>, string]> = [
    [{}, "Arbeitet."],
    [{ focus: { ...base.focus!, status: "idle" } }, "Im Leerlauf."],
    [{ focus: { ...base.focus!, status: "error" }, working: 0, error: 1 }, "Meldet einen Fehler."],
    [{ focus: { ...base.focus!, status: "other" } }, "Pausiert oder beendet."],
    [{ focus: { ...base.focus!, status: "approval" }, pendingSummary: "Paket installieren", working: 0, blocked: 1 }, "Wartet auf Freigabe: Paket installieren."],
    [{ focus: { ...base.focus!, status: "question" }, pendingSummary: "Welche Variante?", working: 0, blocked: 1 }, "Hat eine Frage: Welche Variante? Antwort am Rechner."],
  ];
  for (const [patch, expected] of cases) {
    assert.equal(composeSessionStatus({ ...base, ...patch }).body, expected);
  }
});

test("Titel nennt Alias und Position, nie Session-Titel", () => {
  assert.equal(composeSessionStatus(base).title, "Agent 3f9a2c");
  const multi = composeSessionStatus({ ...base, focus: { idx: 2, total: 3, ref: "3f9a2c", status: "working" } });
  assert.equal(multi.title, "Agent 3f9a2c (2/3)");
});

test("mehrere Sessions: Gesamtzeile nur mit Zahlen aus der Eingabe, Nullen entfallen", () => {
  const b = composeSessionStatus({ ...base, focus: { idx: 1, total: 4, ref: "a1", status: "working" }, working: 2, blocked: 1, error: 0 });
  assert.equal(b.body, "Arbeitet. Gesamt: 2 arbeiten, 1 wartet.");
});

test("ohne Session: ehrliche Aussage, nicht erfunden", () => {
  const b = composeSessionStatus({ ...base, focus: null, working: 0 });
  assert.deepEqual(b, { title: "Nyx", body: "Keine aktive Session." });
});

test("Hub weg oder Stand veraltet wird benannt statt geraten", () => {
  const down = composeSessionStatus({ ...base, hubUp: false, dataAgeS: 130 });
  assert.equal(down.body, "Hub nicht erreichbar. Letzter Stand vor 2 Min: Arbeitet.");
  const old = composeSessionStatus({ ...base, dataAgeS: 45 });
  assert.equal(old.body, "Stand veraltet. Letzter Stand vor 45 s: Arbeitet.");
});

test("Summary wird bereinigt, Befehlstext bleibt Anzeige; Grenzen 40/160 halten", () => {
  const b = composeSessionStatus({
    ...base,
    focus: { idx: 1, total: 1, ref: "r".repeat(40), status: "approval" },
    pendingSummary: "\x1b[31mrm -rf /\x1b[0m\u0007 " + "x".repeat(300),
    blocked: 1,
  });
  // eslint-disable-next-line no-control-regex -- prüft gerade die Abwesenheit von Steuerzeichen
  assert.ok(!/[\u0000-\u001f\u007f]/.test(b.title + b.body));
  assert.ok([...b.title].length <= 40, b.title);
  assert.ok([...b.body].length <= 160, b.body);
  assert.ok(b.body.includes("rm -rf /"));
});

test("Property (fester Seed): Grenzen immer eingehalten, Zahlen nur aus der Eingabe, nie Prozent", () => {
  let seed = 99;
  const rnd = (n: number) => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed % n;
  };
  const statuses = ["approval", "question", "error", "working", "idle", "other"] as const;
  for (let i = 0; i < 500; i++) {
    const total = 1 + rnd(9);
    const input: SessionStatusInput = {
      focus: rnd(8) === 0 ? null : { idx: 1 + rnd(total), total, ref: "s" + rnd(100000), status: statuses[rnd(statuses.length)]! },
      working: rnd(20),
      blocked: rnd(10),
      error: rnd(5),
      hubUp: rnd(4) !== 0,
      dataAgeS: rnd(10000),
    };
    if (rnd(2) === 0) input.pendingSummary = "Aktion " + rnd(1000) + " ".repeat(rnd(3)) + "y".repeat(rnd(200));
    const b = composeSessionStatus(input);
    assert.ok([...b.title].length >= 1 && [...b.title].length <= 40, b.title);
    assert.ok([...b.body].length <= 160, b.body);
    assert.ok(!b.body.includes("%"));
    const allowed = new Set<string>(
      [input.working, input.blocked, input.error, input.dataAgeS, input.focus?.idx ?? 0, input.focus?.total ?? 0].flatMap((n) => [
        String(n),
        String(Math.floor(n / 60)),
        String(Math.floor(n / 3600)),
      ]),
    );
    const own = (input.focus?.ref ?? "") + " " + (input.pendingSummary ?? "");
    const text = (b.title + " " + b.body).replace(own.trim(), "").replace(/\s+/g, " ");
    for (const m of (b.title + " " + b.body).match(/\d+/g) ?? []) {
      assert.ok(allowed.has(m) || own.includes(m), `${m} nicht aus Eingabe: ${text}`);
    }
  }
});

// ADR-0010: der Tap-Status nennt, was zuletzt erledigt wurde (letzte Agent-Nachricht, nur Anzeige).
test("letzte Nachricht folgt dem Kerntext; Body bleibt ≤ 160 und bereinigt", () => {
  const idle = { ...base, focus: { ...base.focus!, status: "idle" as const }, working: 0 };
  const b = composeSessionStatus({ ...idle, lastMessage: "Merge fertig,\n  Gate grün." });
  assert.equal(b.body, "Im Leerlauf. Zuletzt: Merge fertig, Gate grün.");
  const long = composeSessionStatus({ ...idle, lastMessage: "x".repeat(400) });
  assert.equal(long.body.length, 160);
  assert.ok(long.body.endsWith("…"));
  const ansi = composeSessionStatus({ ...idle, lastMessage: "ok\u001b[31m rot" });
  assert.ok(!ansi.body.includes("\u001b"));
});

test("ohne letzte Nachricht bleibt der Text unverändert; Titel nutzt den Namen, wenn vorhanden", () => {
  assert.equal(composeSessionStatus({ ...base, lastMessage: "  " }).body, "Arbeitet.");
  const t = composeSessionStatus({ ...base, focus: { ...base.focus!, name: "voidwarden" } });
  assert.equal(t.title, "voidwarden");
});
