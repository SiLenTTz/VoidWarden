#!/usr/bin/env node
/**
 * test:hub (EPIC-P1 T1.8): Companion-Verifikation gegen den echten AncientVoid-Hub.
 * Lesende Checks mit dem agent:voidwarden-Token (Least Privilege, ADR-0001):
 * alle Routen aus spec.md §4.5. Ohne Config/Token/Hub: sichtbarer SKIP.
 */
import { existsSync, readFileSync } from "node:fs";

const CONFIG = "voidwarden.config.json";

if (!existsSync(CONFIG)) {
  console.log(`SKIP: ${CONFIG} fehlt (Vorlage: voidwarden.config.example.json).`);
  process.exit(0);
}

let config;
try {
  config = JSON.parse(readFileSync(CONFIG, "utf8"));
} catch (err) {
  console.log(`SKIP: ${CONFIG} unlesbar (${err.message}).`);
  process.exit(0);
}
if (!existsSync(config.hub?.tokenFile ?? "")) {
  console.log(`SKIP: Token-Datei ${config.hub?.tokenFile} fehlt (hubctl token issue voidwarden --agent).`);
  process.exit(0);
}
const token = readFileSync(config.hub.tokenFile, "utf8").trim();
const base = config.hub.url;

const checks = [
  ["GET /api/health", "/api/health"],
  ["GET /api/ready", "/api/ready"],
  ["GET /api/sessions", "/api/sessions"],
  ["GET /api/approvals?status=pending", "/api/approvals?status=pending"],
  ["GET /api/notifications?limit=1", "/api/notifications?limit=1"],
];

let failed = 0;
for (const [label, path] of checks) {
  try {
    const res = await fetch(base + path, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status !== 200) {
      console.log(`FAIL: ${label} -> ${res.status}`);
      failed += 1;
      continue;
    }
    await res.json();
    console.log(`ok:   ${label} -> 200`);
  } catch (err) {
    console.log(`FAIL: ${label} -> ${err.message}`);
    failed += 1;
  }
}

// Display-Akteur (EPIC-P3, AV-D1/ADR-0048): lesen erlaubt, decide erlaubt.
// Unbekannte ID -> 403 "Nicht am Display entscheidbar" (fail-closed, kein
// Info-Leak; Hub-Verhalten 2026-11-11, vorher irrtümlich "not 403" erwartet).
if (existsSync(config.hub?.decideTokenFile ?? "")) {
  const dt = readFileSync(config.hub.decideTokenFile, "utf8").trim();
  const res = await fetch(`${base}/api/sessions`, { headers: { Authorization: `Bearer ${dt}` } });
  console.log(`ok:   GET /api/sessions (display) -> ${res.status}`);
  const dec = await fetch(`${base}/api/approvals/00000000-0000-4000-8000-000000000000/decide`, {
    method: "POST",
    headers: { Authorization: `Bearer ${dt}`, "Content-Type": "application/json" },
    body: JSON.stringify({ decision: "approve" }),
  });
  const body = await dec.text();
  if (dec.status === 403 && body.includes("Nicht am Display entscheidbar")) {
    console.log("ok:   POST decide (display, unbekannte ID) -> 403 (fail-closed, kein Info-Leak)");
  } else {
    console.log(`FAIL: display decide (unbekannte ID) -> ${dec.status} (${body.slice(0, 80)}) — erwartet 403 nach ADR-0048`);
    failed += 1;
  }
} else {
  console.log("SKIP: kein hub.decideTokenFile — Display-Akteur nicht konfiguriert (P3 read-only).");
}

// Least-Privilege-Nachweis: decide muss als agent 403 sein (ADR-0001).
try {
  const res = await fetch(`${base}/api/approvals/00000000-0000-4000-8000-000000000000/decide`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ decision: "approve" }),
  });
  if (res.status === 403) {
    console.log("ok:   POST decide (agent) -> 403 (Least Privilege belegt)");
  } else {
    console.log(`FAIL: POST decide (agent) -> ${res.status}, erwartet 403`);
    failed += 1;
  }
} catch (err) {
  console.log(`FAIL: POST decide -> ${err.message}`);
  failed += 1;
}

// T3.10: Konflikt-Codes (spec.md §4.5, live belegt 2026-11-11) — doppelter
// decide und decide nach Ablauf sind beide 422 ("already rejected" bzw.
// "already timed_out"), kein 409. Die Probe-Approval wird als
// session.create-REQUEST angelegt (202): ohne menschliches Approve startet
// nichts; das Skript rejected sie selbst bzw. lässt sie bis timeoutAt
// auslaufen. Es entscheidet nie echte Sessions; Projekt aus bestehender
// Session übernommen, damit der Request sicher in projectRoots liegt.
if (existsSync(config.hub?.decideTokenFile ?? "")) {
  const dt = readFileSync(config.hub.decideTokenFile, "utf8").trim();
  const post = (path, tok, body) =>
    fetch(base + path, {
      method: "POST",
      headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  let project = null;
  try {
    const res = await fetch(`${base}/api/sessions`, { headers: { Authorization: `Bearer ${token}` } });
    project = (await res.json()).find((s) => typeof s.project === "string" && s.project)?.project ?? null;
  } catch {
    /* unten als SKIP behandelt */
  }
  if (!project) {
    console.log("SKIP: keine bestehende Session mit project — Konflikt-Codes (T3.10) nicht prüfbar.");
  } else {
    const requestDummy = async (label) => {
      const res = await post("/api/sessions", token, {
        adapter: "claude",
        project,
        title: `test:hub T3.10 Dummy (${label})`,
        prompt: "test:hub-Dummy: nicht genehmigen — läuft von allein ab",
      });
      const body = await res.json();
      return res.status === 202 && typeof body.approvalId === "string" ? body.approvalId : null;
    };
    const decideDummy = async (id) => {
      const res = await post(`/api/approvals/${id}/decide`, dt, { decision: "reject" });
      return { status: res.status, detail: (await res.json())?.detail };
    };

    // (a) „schon entschieden": reject -> 200, zweiter decide -> 422 "already rejected".
    const first = await requestDummy("schon-entschieden-Probe");
    if (!first) {
      console.log("FAIL: POST /api/sessions (agent, Request) -> erwartet 202 mit approvalId");
      failed += 1;
    } else {
      const one = await decideDummy(first);
      if (one.status !== 200) {
        console.log(`FAIL: decide #1 (display, Dummy) -> ${one.status}, erwartet 200`);
        failed += 1;
      } else {
        const two = await decideDummy(first);
        if (two.status === 422 && two.detail === "already rejected") {
          console.log('ok:   POST decide #2 (doppelt) -> 422 "already rejected"');
        } else {
          console.log(`FAIL: decide #2 (doppelt) -> ${two.status} ${two.detail ?? ""}, erwartet 422 "already rejected"`);
          failed += 1;
        }
      }
    }

    // (b) „abgelaufen": zweite Probe bis timeoutAt (Hub-Default 60 s) auslaufen
    // lassen, dann decide. Wurde sie in der Wartezeit extern entschieden,
    // ist der Code hier nicht provozierbar — sichtbarer SKIP, kein Pass.
    const second = await requestDummy("ablauf-Probe");
    if (!second) {
      console.log("FAIL: POST /api/sessions (agent, Ablauf-Probe) -> erwartet 202 mit approvalId");
      failed += 1;
    } else {
      let state = "pending";
      const deadline = Date.now() + 90_000;
      while (state === "pending" && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 3000));
        const res = await fetch(`${base}/api/approvals/${second}`, { headers: { Authorization: `Bearer ${token}` } });
        state = (await res.json())?.status ?? "pending";
      }
      if (state === "timed_out") {
        const after = await decideDummy(second);
        if (after.status === 422 && after.detail === "already timed_out") {
          console.log('ok:   POST decide (abgelaufen) -> 422 "already timed_out"');
        } else {
          console.log(`FAIL: decide (abgelaufen) -> ${after.status} ${after.detail ?? ""}, erwartet 422 "already timed_out"`);
          failed += 1;
        }
      } else {
        console.log(`SKIP: Ablauf-Probe wurde in der Wartezeit extern "${state}" — decide nach timeoutAt nicht provozierbar.`);
        if (state === "approved") {
          console.log("      Hinweis: approved startet die markierte Dummy-Session — bitte von Hand stoppen.");
        }
      }
    }
  }
} else {
  console.log("SKIP: kein hub.decideTokenFile — Konflikt-Codes (T3.10) nicht prüfbar.");
}

if (failed > 0) {
  console.error(`test:hub: ${failed} Check(s) fehlgeschlagen`);
  process.exit(1);
}
console.log("test:hub: alle Checks grün gegen " + base);
