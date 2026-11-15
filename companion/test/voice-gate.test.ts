import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
import assert from "node:assert/strict";
import { isCueCurrent } from "../src/voice_gate.ts";

test("BUG-0012: state_change-Cue ist aktuell, solange der Zustand gleich bleibt", () => {
  const cue = { event: "state_change" as const, state: "listening" };
  assert.equal(isCueCurrent(cue, { state: "listening", approvalId: null }), true);
});

test("BUG-0012: state_change-Cue ist veraltet, wenn der Zustand weitergewechselt hat", () => {
  const cue = { event: "state_change" as const, state: "listening" };
  assert.equal(isCueCurrent(cue, { state: "idle", approvalId: null }), false);
  assert.equal(isCueCurrent(cue, { state: "approval_pending", approvalId: "a1" }), false);
});

test("BUG-0012: attention-Cue ist aktuell, solange dieselbe Approval offen ist", () => {
  const cue = { event: "attention" as const, state: "approval_pending", approvalId: "a1" };
  assert.equal(isCueCurrent(cue, { state: "approval_pending", approvalId: "a1" }), true);
});

test("BUG-0012: attention-Cue ist veraltet bei Entscheidung, Ablauf oder Nachfolger", () => {
  const cue = { event: "attention" as const, state: "approval_pending", approvalId: "a1" };
  assert.equal(isCueCurrent(cue, { state: "executing", approvalId: null }), false, "decided/expired");
  assert.equal(isCueCurrent(cue, { state: "approval_pending", approvalId: "a2" }), false, "neue Approval hat abgelöst");
});

test("BUG-0012-Verdrahtung: maybeSpeak prüft Cue-Aktualität vor dem Broadcast", () => {
  const src = readFileSync(join(here, "../src/main.ts"), "utf8");
  assert.ok(src.includes("isCueCurrent(cueRef, now)"), "isCueCurrent-Aufruf fehlt");
  assert.ok(src.includes("voice:skipped_stale"), "Stale-Skip-Log fehlt");
  assert.ok(src.indexOf("isCueCurrent(cueRef, now)") < src.indexOf("broadcastVoice({ id, state, phrase, error: false })"), "Prüfung muss vor dem Broadcast stehen");
});
