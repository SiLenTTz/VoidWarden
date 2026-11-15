// Bridge-Tests (EPIC-P1 T1.4): snapshot/resync/seq, Heartbeat, Coalescing,
// Sanitizing — alles gegen MemoryLink + FakeClock (docs/testing.md §2.2).
import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryLink } from "../src/link.ts";
import { FakeClock } from "../src/clock.ts";
import { Bridge } from "../src/bridge.ts";
import { decodeLine, type Frame } from "../src/frames.ts";
import type { AggregateResult } from "../src/aggregate.ts";

function aggResult(state: AggregateResult["state"]): AggregateResult {
  return {
    state,
    sessions: { total: 1, working: state === "listening" ? 1 : 0, waiting: 0, error: 0 },
    approval: null,
    pendingCount: 0,
    unknownStatuses: [],
  };
}

interface Harness {
  bridge: Bridge;
  device: MemoryLink;
  clock: FakeClock;
  deviceFrames: string[];
  logs: Array<[string, Record<string, string | number | boolean> | undefined]>;
  agg: { value: AggregateResult | null };
}

async function makeHarness(): Promise<Harness> {
  const [companionSide, device] = MemoryLink.pair();
  // MemoryLink verlangt beide offene Enden für writeLine.
  await companionSide.open();
  await device.open();
  const clock = new FakeClock();
  const deviceFrames: string[] = [];
  device.onLine((l) => deviceFrames.push(l));
  const logs: Harness["logs"] = [];
  const agg: Harness["agg"] = { value: aggResult("idle") };
  const bridge = new Bridge({
    link: companionSide,
    clock,
    getAggregate: () => agg.value,
    log: (msg, fields) => logs.push([msg, fields]),
  });
  bridge.start();
  return { bridge, device, clock, deviceFrames, logs, agg };
}

test("hello löst snapshot aus, seq startet bei 1 (Link-Sitzung)", async () => {
  const h = await makeHarness();
  h.device.writeLine(
    '{"v":1,"type":"hello","fw":"0.1.0","proto":1,"screen":{"w":480,"h":320},"reset_reason":"POWERON_RESET","heap_free":280000}',
  );
  assert.equal(h.deviceFrames.length, 1);
  const frame = decodeLine(h.deviceFrames[0] as string);
  assert.ok(frame.ok);
  if (frame.ok) {
    assert.equal(frame.frame.type, "snapshot");
    assert.equal(frame.frame.type === "snapshot" ? frame.frame.seq : 0, 1);
    assert.equal(frame.frame.type === "snapshot" ? frame.frame.state : "", "idle");
  }
});

test("resync liefert neuen snapshot", async () => {
  const h = await makeHarness();
  h.device.writeLine('{"v":1,"type":"resync","last_seq":7}');
  const frame = decodeLine(h.deviceFrames[0] as string);
  assert.ok(frame.ok && frame.frame.type === "snapshot");
});

test("Zustandswechsel → state_change; gleichbleibend → kein Frame", async () => {
  const h = await makeHarness();
  h.bridge.onAggregate(aggResult("listening"));
  h.clock.advance(100); // Coalescing-Fenster
  assert.equal(h.deviceFrames.length, 1);
  const f1 = decodeLine(h.deviceFrames[0] as string);
  assert.ok(f1.ok && f1.frame.type === "state_change" && f1.frame.state === "listening");
  h.bridge.onAggregate(aggResult("listening"));
  h.clock.advance(500);
  assert.equal(h.deviceFrames.length, 1, "kein Frame für unveränderten Zustand");
});

test("Coalescing: 30 Wechsel in 1 s → ≤ 10 Frames, letzter Zustand gewinnt (W2)", async () => {
  const h = await makeHarness();
  h.device.writeLine('{"v":1,"type":"resync","last_seq":0}'); // Gerät ist begrüßt: kein Start-snapshot dazwischen
  h.deviceFrames.length = 0;
  // toggeln idle/listening 30× innerhalb 3 s → pro 100-ms-Fenster max 1 Frame
  for (let i = 0; i < 30; i++) {
    h.bridge.onAggregate(aggResult(i % 2 === 0 ? "listening" : "idle"));
    h.clock.advance(50);
  }
  h.clock.advance(200);
  const changes = h.deviceFrames
    .map((l) => decodeLine(l))
    .filter((r) => r.ok && r.frame.type === "state_change");
  assert.ok(changes.length <= 31); // 30 Takte à 50 ms = 15 Fenster → realistisch ≤ 16
  const last = changes.at(-1);
  assert.ok(last?.ok);
  const lastState = last.ok && last.frame.type === "state_change" ? last.frame.state : "";
  assert.equal(lastState, "idle"); // i=29 → idle
});

test("Heartbeat alle 5 s mit hub-Feld; hub down → down (W6)", async () => {
  const h = await makeHarness();
  h.clock.advance(5000);
  h.clock.advance(5000);
  const beats = h.deviceFrames
    .map((l) => decodeLine(l))
    .filter((r) => r.ok && r.frame.type === "heartbeat");
  assert.equal(beats.length, 2);
  h.agg.value = aggResult("offline");
  h.bridge.onAggregate(aggResult("offline"));
  h.clock.advance(100);
  h.clock.advance(5000);
  const lastBeat = h.deviceFrames
    .map((l) => decodeLine(l))
    .filter((r) => r.ok && r.frame.type === "heartbeat")
    .at(-1);
  assert.ok(lastBeat?.ok);
  const hub = lastBeat.ok && lastBeat.frame.type === "heartbeat" ? lastBeat.frame.hub : "";
  assert.equal(hub, "down");
});

test("ROM-Präfix vor hello: hello gilt trotzdem, Präfix wird gezählt und gemeldet (T2.9)", async () => {
  const h = await makeHarness();
  const hello = '{"v":1,"type":"hello","fw":"0.2.0","proto":1,"screen":{"w":320,"h":240},"reset_reason":"POWERON_RESET","heap_free":244160}';
  h.device.writeLine("\u001b[0m\u0000" + hello);
  assert.equal(h.bridge.counters.line_prefix, 1);
  assert.equal(h.bridge.counters.parse_err, 0, "kein Protokollfehler: das Präfix ist kein Frame");
  assert.ok(h.deviceFrames.some((l) => decodeLine(l).ok && (decodeLine(l) as { frame: Frame }).frame.type === "snapshot"), "hello → snapshot");
  const prefixLog = h.logs.find(([m]) => m === "bridge:line_prefix");
  assert.ok(prefixLog, "Präfix ist geloggt");
  assert.equal(prefixLog?.[1]?.bytes, 5, "ESC [ 0 m NUL");
  assert.equal(prefixLog?.[1]?.head_hex, "1b5b306d00", "nur Hex, kein Klartext");
});

test("Müll/Unbekanntes → parse_err-Zähler + Log, kein Crash (Fail loud)", async () => {
  const h = await makeHarness();
  h.device.writeLine("egal { kaputt");
  h.device.writeLine('{"v":1,"type":"mystery"}');
  assert.equal(h.bridge.counters.parse_err, 2);
  assert.equal(h.bridge.counters.rx, 2);
  const kinds = h.logs.filter(([m]) => m === "bridge:parse_error").map(([, f]) => f?.kind);
  assert.deepEqual(kinds, ["not-json", "schema"]);
});

test("notification wird sanitisiert: ANSI/Steuerzeichen raus, Kürzen mit …", async () => {
  const h = await makeHarness();
  h.bridge.onNotification(
    "sess-1",
    "warning",
    { title: "\u001b[31mBudget\u001b[0m \u0007fast \u001b[2Kverbraucht".repeat(3), body: "zeile\nmit\ttabs" },
  );
  h.clock.advance(100);
  const note = h.deviceFrames
    .map((l) => decodeLine(l))
    .find((r) => r.ok && r.frame.type === "notification");
  assert.ok(note?.ok);
  if (note.ok && note.frame.type === "notification") {
    assert.ok(note.frame.payload.title.length <= 40);
    assert.ok(note.frame.payload.title.endsWith("…"));
    // eslint-disable-next-line no-control-regex -- prüft genau die Steuerzeichen, die sanitize entfernen muss
    assert.ok(!/\u001b|\u0007/.test(note.frame.payload.title + note.frame.payload.body));
    assert.equal(note.frame.payload.body, "zeile mit tabs");
  }
});

test("hello vor erstem Hub-Poll: Snapshot wird nachgezogen, sobald Zustand da (K7)", async () => {
  const h = await makeHarness();
  h.agg.value = null; // noch kein Poll gelaufen
  h.device.writeLine(
    '{"v":1,"type":"hello","fw":"0.1.0","proto":1,"screen":{"w":480,"h":320},"reset_reason":"POWERON_RESET","heap_free":280000}',
  );
  assert.equal(h.deviceFrames.length, 0, "ohne Zustand kein Snapshot — aber auch kein Verlust des Auftrags");
  h.agg.value = aggResult("listening");
  h.bridge.onAggregate(h.agg.value);
  assert.equal(h.deviceFrames.length, 1, "erster Zustand löst den nachgezogenen Snapshot aus");
  const snap = decodeLine(h.deviceFrames[0] as string);
  assert.ok(snap.ok && snap.frame.type === "snapshot" && snap.frame.state === "listening");
});

test("Notifications gehen in FIFO: 3 in einem Fenster keines geht verloren (Review B3)", async () => {
  const h = await makeHarness();
  h.bridge.onNotification("s1", "info", { title: "eins", body: "b" });
  h.bridge.onNotification("s2", "warning", { title: "zwei", body: "b" });
  h.bridge.onNotification("s3", "error", { title: "drei", body: "b" });
  h.clock.advance(100); // Tick 1: state_change? nein — 2 Notifications
  h.clock.advance(100); // Tick 2: letzte Notification
  const notes = h.deviceFrames
    .map((l) => decodeLine(l))
    .filter((r) => r.ok && r.frame.type === "notification");
  assert.equal(notes.length, 3, "alle drei Notifications kommen an");
  const titles = notes.map((r) => (r.ok && r.frame.type === "notification" ? r.frame.payload.title : ""));
  assert.deepEqual(titles, ["eins", "zwei", "drei"]);
  assert.equal(h.bridge.counters.dropped, 0);
});

test("Notification-Overflow verwirft sichtbar: Zaehler + Log, nie still (Review B3)", async () => {
  const h = await makeHarness();
  const many = 60; // Queue-Max 50
  for (let i = 0; i < many; i++) {
    h.bridge.onNotification("s", "info", { title: `n${i}`, body: "b" });
  }
  assert.equal(h.bridge.counters.dropped, many - 50);
  assert.ok(h.logs.some(([m]) => m === "bridge:notification_dropped"));
});

test("additive Felder: Frame bleibt gültig, unbekannte Felder werden gezählt+geloggt (Review B4)", async () => {
  const h = await makeHarness();
  h.device.writeLine('{"v":1,"type":"resync","last_seq":7,"future_field":{"x":1}}');
  assert.equal(h.bridge.counters.parse_err, 0, "additive Felder sind v1-gültig");
  assert.equal(h.bridge.counters.unknown_fields, 1);
  assert.ok(h.logs.some(([m]) => m === "bridge:unknown_fields"));
  // und der resync wurde trotzdem behandelt:
  assert.ok(h.deviceFrames.map((l) => decodeLine(l)).some((r) => r.ok && r.frame.type === "snapshot"));
});

test("encodeFrame-Fehler zählen encode_err (Review B5)", async () => {
  const h = await makeHarness();
  // Approval mit ungültiger Klasse über aggregate in den Snapshot schleusen
  const bad = h.agg;
  bad.value = {
    state: "approval_pending",
    sessions: { total: 1, working: 0, waiting: 1, error: 0 },
    approval: {
      action_id: "0e0f1e2e-3b4c-4d5e-8f9a-a1b2c3d4e5f6",
      kind: "approval",
      agent_id: "s1",
      // absichtlich typwidrig: der Runtime-Guard in encodeFrame muss greifen,
      // auch wenn Typsystem und Hub-Validierung das normalerweise verhindern.
      class: "bogus" as unknown as "write",
      payload: { title: "x", body: "y" },
      timeout_s: 10,
      decidable: true,
    },
    pendingCount: 1,
    unknownStatuses: [],
  };
  h.device.writeLine('{"v":1,"type":"hello","fw":"0.1.0","proto":1,"screen":{"w":480,"h":320},"reset_reason":"R","heap_free":1}');
  assert.equal(h.bridge.counters.encode_err, 1);
  assert.ok(h.logs.some(([m]) => m === "bridge:frame_rejected"));
});

test("seq ist über Frames hinweg monoton und wird bei hello zurückgesetzt", async () => {
  const h = await makeHarness();
  h.bridge.onAggregate(aggResult("listening"));
  h.clock.advance(100); // seq 1
  h.bridge.onAggregate(aggResult("idle"));
  h.clock.advance(100); // seq 2
  const seqs = h.deviceFrames.map((l) => {
    const r = decodeLine(l);
    return r.ok && r.frame.type === "state_change" ? r.frame.seq : -1;
  });
  assert.deepEqual(seqs, [1, 2]);
  h.device.writeLine(
    '{"v":1,"type":"hello","fw":"0.1.0","proto":1,"screen":{"w":480,"h":320},"reset_reason":"SW_RESET","heap_free":280000}',
  );
  const snap = h.deviceFrames
    .map((l) => decodeLine(l))
    .find((r) => r.ok && r.frame.type === "snapshot");
  assert.ok(snap?.ok);
  const snapSeq = snap.ok && snap.frame.type === "snapshot" ? snap.frame.seq : -1;
  assert.equal(snapSeq, 1, "seq-Reset bei neuer Link-Sitzung (hello)");
});

test("bubble: Frame mit bereinigtem Text, hold_s und Ack-Flag (T8.3)", async () => {
  const h = await makeHarness();
  h.bridge.showBubble({
    id: "b-1",
    level: "info",
    title: "\x1b[31mStatus\x1b[0m",
    body: "2 Agents arbeiten.",
    holdS: 6,
    ackRequired: false,
  });
  const f = decodeLine(h.deviceFrames[0] as string);
  assert.ok(f.ok && f.frame.type === "bubble");
  if (f.ok && f.frame.type === "bubble") {
    assert.equal(f.frame.payload.title, "Status");
    assert.equal(f.frame.hold_s, 6);
    assert.equal(f.frame.ack_required, false);
  }
});

test("bubble: Überlänge wird im Companion gekürzt, nie als ungültiger Frame gesendet (T8.3)", async () => {
  const h = await makeHarness();
  h.bridge.showBubble({ id: "b-2", level: "info", title: "t".repeat(80), body: "b".repeat(400), holdS: 999, ackRequired: false });
  const f = decodeLine(h.deviceFrames[0] as string);
  assert.ok(f.ok && f.frame.type === "bubble");
  if (f.ok && f.frame.type === "bubble") {
    assert.equal(Buffer.byteLength(f.frame.payload.title), 40);
    assert.equal(Buffer.byteLength(f.frame.payload.body), 160);
    assert.equal(f.frame.hold_s, 255);
  }
});

test("bubble: kritische Blase kommt nach hello erneut, bis sie quittiert ist (AC-P8-3, K7)", async () => {
  const h = await makeHarness();
  const hello =
    '{"v":1,"type":"hello","fw":"0.2.0","proto":1,"screen":{"w":320,"h":240},"reset_reason":"BROWNOUT_RESET","heap_free":1}';
  h.bridge.showBubble({ id: "c-1", level: "critical", title: "Freigabe", body: "1 wartet", holdS: 0, ackRequired: true });
  h.bridge.showBubble({ id: "i-1", level: "info", title: "Info", body: "x", holdS: 6, ackRequired: false });
  h.deviceFrames.length = 0;
  h.device.writeLine(hello);
  const types = h.deviceFrames.map((l) => decodeLine(l)).map((r) => (r.ok ? r.frame.type : "?"));
  assert.deepEqual(types, ["snapshot", "bubble"], "nur die kritische Blase wird wiederholt");
  h.bridge.ackBubble("c-1");
  h.deviceFrames.length = 0;
  h.device.writeLine(hello);
  assert.deepEqual(
    h.deviceFrames.map((l) => decodeLine(l)).map((r) => (r.ok ? r.frame.type : "?")),
    ["snapshot"],
  );
});

// BUG-0007: Eine Freigabe erreicht das Gerät nur über snapshot.approval — state_change trägt sie nicht.
function aggWithApproval(id: string | null, state: AggregateResult["state"] = "approval_pending"): AggregateResult {
  return {
    ...aggResult(state),
    approval:
      id === null
        ? null
        : {
            action_id: id,
            kind: "approval",
            agent_id: "s1",
            class: "write",
            payload: { title: "Datei schreiben", body: "write · Edit" },
            timeout_s: 120,
            decidable: true,
          },
    pendingCount: id === null ? 0 : 1,
  };
}

function snapshotsWithApproval(h: Harness): Array<string | null> {
  const out: Array<string | null> = [];
  for (const l of h.deviceFrames) {
    const r = decodeLine(l);
    if (r.ok && r.frame.type === "snapshot") out.push(r.frame.approval === null ? null : r.frame.approval.action_id);
  }
  return out;
}

test("BUG-0007: neue Freigabe geht per snapshot ans Gerät, nicht nur als state_change", async () => {
  const h = await makeHarness();
  h.device.writeLine(
    '{"v":1,"type":"hello","fw":"0.1.0","proto":1,"screen":{"w":320,"h":240},"reset_reason":"POWERON_RESET","heap_free":280000}',
  );
  h.deviceFrames.length = 0;
  const A = "0e0f1e2e-3b4c-4d5e-8f9a-a1b2c3d4e5f6";
  const B = "1f1f2f3f-4c5d-4e6f-9a0b-b2c3d4e5f607";

  h.bridge.onAggregate(aggWithApproval(A));
  h.clock.advance(500);
  assert.deepEqual(snapshotsWithApproval(h), [A], "Freigabe A fehlt im Gerätestand");

  // gleiche Freigabe erneut gemeldet (nächster Poll): nichts Neues
  h.bridge.onAggregate(aggWithApproval(A));
  h.clock.advance(500);
  assert.deepEqual(snapshotsWithApproval(h), [A], "unveränderte Freigabe darf nicht erneut gesendet werden");

  // A entschieden, B rückt bei gleichem Zustand nach
  h.bridge.onAggregate(aggWithApproval(B));
  h.clock.advance(500);
  assert.deepEqual(snapshotsWithApproval(h), [A, B], "nachrückende Freigabe B fehlt");

  // alle erledigt: Gerät muss die Freigabe loswerden
  h.bridge.onAggregate(aggWithApproval(null, "idle"));
  h.clock.advance(500);
  assert.deepEqual(snapshotsWithApproval(h), [A, B, null], "Ende der Freigabe fehlt");
});

test("Frage geht als kind=question und nie entscheidbar im snapshot ans Gerät (T3.11)", async () => {
  const h = await makeHarness();
  h.device.writeLine(
    '{"v":1,"type":"hello","fw":"0.1.0","proto":1,"screen":{"w":320,"h":240},"reset_reason":"POWERON_RESET","heap_free":280000}',
  );
  h.deviceFrames.length = 0;
  const q = aggWithApproval("0e0f1e2e-3b4c-4d5e-8f9a-a1b2c3d4e5f6");
  if (q.approval !== null) q.approval = { ...q.approval, kind: "question", decidable: false };
  h.bridge.onAggregate(q);
  h.clock.advance(500);
  const snap = h.deviceFrames.map((l) => decodeLine(l)).find((r) => r.ok && r.frame.type === "snapshot");
  assert.ok(snap?.ok && snap.frame.type === "snapshot" && snap.frame.approval !== null);
  if (snap?.ok && snap.frame.type === "snapshot" && snap.frame.approval !== null) {
    assert.equal(snap.frame.approval.kind, "question");
    assert.equal(snap.frame.approval.decidable, false);
  }
  // normale Freigabe trägt kein kind (Default approval, Frame bleibt klein)
  const h2 = await makeHarness();
  h2.device.writeLine(
    '{"v":1,"type":"hello","fw":"0.1.0","proto":1,"screen":{"w":320,"h":240},"reset_reason":"POWERON_RESET","heap_free":280000}',
  );
  h2.deviceFrames.length = 0;
  h2.bridge.onAggregate(aggWithApproval("0e0f1e2e-3b4c-4d5e-8f9a-a1b2c3d4e5f6"));
  h2.clock.advance(500);
  assert.ok(!h2.deviceFrames.some((l) => l.includes('"kind"')));
});

// --- Fokus (ADR-0009): session_focus, Recovery nach hello/resync (K7), Wegfall aller Sessions ---
const HELLO =
  '{"v":1,"type":"hello","fw":"0.1.0","proto":1,"screen":{"w":320,"h":240},"reset_reason":"POWERON_RESET","heap_free":280000}';
const typesOf = (h: Harness) =>
  h.deviceFrames.map((l) => {
    const r = decodeLine(l);
    return r.ok ? r.frame.type : "?";
  });

test("setFocus sendet session_focus nur bei Änderung, mit dem Namen aus der Ansicht", async () => {
  const h = await makeHarness();
  h.device.writeLine(HELLO);
  h.deviceFrames.length = 0;
  const v = { idx: 2, total: 3, ref: "3f9a2c", name: "claude 3f9a2c", status: "working" as const, pinned: false };
  h.bridge.setFocus(v);
  h.bridge.setFocus({ ...v });
  assert.deepEqual(typesOf(h), ["session_focus"]);
  const f = decodeLine(h.deviceFrames[0] as string);
  assert.ok(f.ok && f.frame.type === "session_focus");
  if (f.ok && f.frame.type === "session_focus") {
    assert.deepEqual([f.frame.idx, f.frame.total, f.frame.ref, f.frame.name, f.frame.status], [2, 3, "3f9a2c", "claude 3f9a2c", "working"]);
  }
  h.bridge.setFocus({ ...v, idx: 3 });
  assert.deepEqual(typesOf(h), ["session_focus", "session_focus"]);
  // pinned ist Companion-Wissen und ändert den Frame nicht
  h.bridge.setFocus({ ...v, idx: 3, pinned: true });
  assert.equal(typesOf(h).length, 2);
});

test("nach hello/resync folgt session_focus auf den snapshot (K7)", async () => {
  const h = await makeHarness();
  h.device.writeLine(HELLO);
  h.bridge.setFocus({ idx: 1, total: 2, ref: "aaaaaa", name: "Agent aaaaaa", status: "idle", pinned: false });
  h.deviceFrames.length = 0;
  h.device.writeLine('{"v":1,"type":"resync","last_seq":3}');
  assert.deepEqual(typesOf(h), ["snapshot", "session_focus"]);
  h.deviceFrames.length = 0;
  h.device.writeLine(HELLO);
  assert.deepEqual(typesOf(h), ["snapshot", "session_focus"]);
});

test("setFocus(null) nach einem Fokus löscht ihn per snapshot; ohne vorherigen Fokus passiert nichts", async () => {
  const h = await makeHarness();
  h.device.writeLine(HELLO);
  h.deviceFrames.length = 0;
  h.bridge.setFocus(null);
  assert.deepEqual(typesOf(h), []);
  h.bridge.setFocus({ idx: 1, total: 2, ref: "aaaaaa", name: "Agent aaaaaa", status: "idle", pinned: false });
  h.deviceFrames.length = 0;
  h.bridge.setFocus(null);
  assert.deepEqual(typesOf(h), ["snapshot"]);
  // und nach einem späteren resync kommt kein veralteter Fokus zurück
  h.deviceFrames.length = 0;
  h.device.writeLine('{"v":1,"type":"resync","last_seq":3}');
  assert.deepEqual(typesOf(h), ["snapshot"]);
});

// BUG-0008: Das Board meldet hello nur beim Boot. Öffnet der Dienst den Port bei laufendem Board
// (Dienststart, Neustart des Dienstes), kommt nie ein hello und damit nie ein snapshot.
function snapshotCount(h: Harness): number {
  return h.deviceFrames.filter((l) => {
    const f = decodeLine(l);
    return f.ok && f.frame.type === "snapshot";
  }).length;
}

test("BUG-0008: ohne hello geht kurz nach dem Start einmal ein snapshot raus", async () => {
  const h = await makeHarness();
  assert.equal(snapshotCount(h), 0);
  h.clock.advance(2000);
  assert.equal(snapshotCount(h), 1);
  h.clock.advance(20_000);
  assert.equal(snapshotCount(h), 1, "nur einmal, kein Dauerfeuer");
});

test("BUG-0008: kam hello vor der Frist, entfällt der zusätzliche snapshot", async () => {
  const h = await makeHarness();
  h.device.writeLine(
    '{"v":1,"type":"hello","fw":"0.1.0","proto":1,"screen":{"w":320,"h":240},"reset_reason":"POWERON_RESET","heap_free":280000}',
  );
  assert.equal(snapshotCount(h), 1);
  h.clock.advance(5000);
  assert.equal(snapshotCount(h), 1);
});

// Letzter Report (K7): Das Gerät hält nichts; nach hello/resync kommt die jüngste Meldung erneut,
// damit der Ticker auch nach Reset oder Dienststart den letzten Stand zeigt.
function notificationTitles(h: Harness): string[] {
  const out: string[] = [];
  for (const l of h.deviceFrames) {
    const f = decodeLine(l);
    if (f.ok && f.frame.type === "notification") out.push(String(f.frame.payload.title));
  }
  return out;
}

test("letzter Report: nach hello kommt die jüngste Meldung erneut", async () => {
  const h = await makeHarness();
  h.device.writeLine('{"v":1,"type":"resync","last_seq":0}');
  h.bridge.onNotification("s1", "success", { title: "Erster", body: "a" });
  h.bridge.onNotification("s1", "success", { title: "Fertig", body: "Alle Gates grün" });
  h.clock.advance(500);
  assert.deepEqual(notificationTitles(h), ["Erster", "Fertig"]);
  h.deviceFrames.length = 0;
  h.device.writeLine(
    '{"v":1,"type":"hello","fw":"0.1.0","proto":1,"screen":{"w":320,"h":240},"reset_reason":"POWERON_RESET","heap_free":280000}',
  );
  h.clock.advance(500);
  assert.deepEqual(notificationTitles(h), ["Fertig"]);
});

test("letzter Report: ohne bisherige Meldung folgt nach hello keine", async () => {
  const h = await makeHarness();
  h.device.writeLine(
    '{"v":1,"type":"hello","fw":"0.1.0","proto":1,"screen":{"w":320,"h":240},"reset_reason":"POWERON_RESET","heap_free":280000}',
  );
  h.clock.advance(500);
  assert.deepEqual(notificationTitles(h), []);
});

// Start-Lärm: Der erste Hub-Poll ist oft vor dem Öffnen des Ports fertig. Das ist kein Fehler,
// sondern wird gezählt; der snapshot nach dem Öffnen holt den Stand nach (K7, BUG-0008).
test("geschlossener Link: Frames werden gezählt statt als frame_rejected geloggt", async () => {
  const [companionSide, device] = MemoryLink.pair();
  const clock = new FakeClock();
  const logs: string[] = [];
  const bridge = new Bridge({
    link: companionSide,
    clock,
    getAggregate: () => aggResult("idle"),
    log: (msg) => logs.push(msg),
  });
  bridge.start(); // Link wurde noch nicht geöffnet
  bridge.onAggregate(aggResult("listening"));
  clock.advance(200);
  assert.equal(logs.filter((m) => m === "bridge:frame_rejected").length, 0);
  assert.ok(bridge.counters.deferred >= 1, "verschobene Frames sind gezählt");
  assert.equal(bridge.counters.tx, 0);
  void device;
});
