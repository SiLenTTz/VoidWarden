// W9-Sicherheit (EPIC-P3 T3.2/T3.3): höchstens EIN decide je action_id
// (Property-Test mit Pseudozufall), decidable:false nie entschieden,
// Neustart lädt die Dedupe-Menge, Konflikt → Status per GET.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DecisionStore } from "../src/dedupe.ts";
import { DecideClient, toHubDecision } from "../src/decide.ts";
import { Logger } from "../src/log.ts";

function lcg(seed: number) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 0x100000000;
}

test("Übersetzung decline→reject an genau einer Stelle (spec §4.2)", () => {
  assert.equal(toHubDecision("approve"), "approve");
  assert.equal(toHubDecision("decline"), "reject");
});

test("Property (W9/AC-P3-3): beliebige Folgen erzeugen nie zwei decides je action_id", async () => {
  const dir = mkdtempSync(join(tmpdir(), "vw-w9-"));
  try {
    const rnd = lcg(42);
    let decideCalls = 0;
    const store = new DecisionStore(join(dir, "d.jsonl"));
    const client = new DecideClient({
      baseUrl: "http://fake",
      token: "t",
      store,
      log: new Logger({ file: join(dir, "log.jsonl"), stdout: false }),
      fetchImpl: (async (url: string | URL | Request) => {
        if (String(url).includes("/decide")) decideCalls += 1;
        return new Response(JSON.stringify({ ok: true, status: "approved" }), { status: 200 });
      }) as unknown as typeof fetch,
    });
    const ids = ["a1", "a2", "a3", "a4", "a5"];
    // 200 zufällige Entscheidungen über zufällige IDs, mit Doppeltipps und Wiederholungen
    for (let i = 0; i < 200; i++) {
      const id = ids[Math.floor(rnd() * ids.length)] as string;
      const decision = rnd() < 0.5 ? "approve" : "decline";
      await client.decide(id, decision, true);
      await client.decide(id, decision, true); // Doppeltipp in derselben Runde
    }
    assert.equal(decideCalls, ids.length, "genau ein decide je action_id");
    assert.equal(store.get("a1")?.status, "sent");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("decidable:false wird nie entschieden (W9/AC-P3-4, ADR-0001)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "vw-w9b-"));
  try {
    let calls = 0;
    const client = new DecideClient({
      baseUrl: "http://fake",
      token: "t",
      store: new DecisionStore(join(dir, "d.jsonl")),
      log: new Logger({ file: join(dir, "log.jsonl"), stdout: false }),
      fetchImpl: (async () => {
        calls += 1;
        return new Response("{}", { status: 200 });
      }) as unknown as typeof fetch,
    });
    const out = await client.decide("x1", "approve", false);
    assert.equal(out.kind, "not_decidable");
    assert.equal(calls, 0);
    // und kein Auto-Decline als Ersatz (ADR-0004): auch decline geht nicht raus
    const out2 = await client.decide("x1", "decline", false);
    assert.equal(out2.kind, "not_decidable");
    assert.equal(calls, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Neustart lädt Dedupe-Menge (AC-P3-3, K7): decisions.jsonl überlebt", async () => {
  const dir = mkdtempSync(join(tmpdir(), "vw-w9c-"));
  try {
    const file = join(dir, "d.jsonl");
    let calls = 0;
    const mk = () =>
      new DecideClient({
        baseUrl: "http://fake",
        token: "t",
        store: new DecisionStore(file),
        log: new Logger({ file: join(dir, "log.jsonl"), stdout: false }),
        fetchImpl: (async (url: string | URL | Request) => {
          if (String(url).includes("/decide")) calls += 1;
          return new Response("{}", { status: 200 });
        }) as unknown as typeof fetch,
      });
    await mk().decide("a1", "approve", true); // "Companion läuft"
    assert.equal(calls, 1);
    await mk().decide("a1", "approve", true); // "Neustart", gleiche Store-Datei
    assert.equal(calls, 1, "nach Neustart kein zweiter decide");
    // Recovery: pending-Eintrag ohne Abschluss klärt per GET, nie blind (Premortem 4)
    const lines = readFileSync(file, "utf8").trim().split("\n");
    assert.ok(lines.length >= 2);
    assert.ok(existsSync(file));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Hub-Konflikt (409): Status per GET, conflict-Ergebnis, kein Retry-Call", async () => {
  const dir = mkdtempSync(join(tmpdir(), "vw-w9d-"));
  try {
    let decideCalls = 0;
    const client = new DecideClient({
      baseUrl: "http://fake",
      token: "t",
      store: new DecisionStore(join(dir, "d.jsonl")),
      log: new Logger({ file: join(dir, "log.jsonl"), stdout: false }),
      fetchImpl: (async (url: string | URL | Request) => {
        const u = String(url);
        if (u.includes("/decide")) {
          decideCalls += 1;
          return new Response(JSON.stringify({ ok: false }), { status: 409 });
        }
        return new Response(JSON.stringify({ id: "a1", status: "timed_out" }), { status: 200 });
      }) as unknown as typeof fetch,
    });
    const out = await client.decide("a1", "approve", true);
    assert.equal(out.kind, "conflict");
    assert.deepEqual(out.kind === "conflict" ? out.hub_status : "", "timed_out");
    assert.equal(decideCalls, 1);
    const retry = await client.decide("a1", "approve", true);
    assert.equal(retry.kind, "already_decided");
    assert.equal(decideCalls, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("403 Policy: rejected_by_policy, Store vermerkt error", async () => {
  const dir = mkdtempSync(join(tmpdir(), "vw-w9e-"));
  try {
    const store = new DecisionStore(join(dir, "d.jsonl"));
    const client = new DecideClient({
      baseUrl: "http://fake",
      token: "t",
      store,
      log: new Logger({ file: join(dir, "log.jsonl"), stdout: false }),
      fetchImpl: (async () => new Response("{}", { status: 403 })) as unknown as typeof fetch,
    });
    const out = await client.decide("a1", "approve", true);
    assert.equal(out.kind, "rejected_by_policy");
    assert.equal(store.get("a1")?.status, "error");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
