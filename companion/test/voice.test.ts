// EPIC-P11 T11.4: Voice-Phrase-Pool — deterministisch, deutsch, je State 3 Sätze.
import { test } from "node:test";
import assert from "node:assert/strict";
import { VOICE_PHRASES, pickPhrase, voiceDaySeed } from "../src/voice.ts";

const STATES = ["idle", "listening", "approval_pending", "executing", "success", "error", "offline"] as const;

test("Pool: jeder State hat 6 Redewendungen, deutsch, düster-knapp", () => {
  for (const st of STATES) {
    const pool = VOICE_PHRASES[st];
    assert.equal(pool.length, 6, `${st}: sechs Sätze (T11.10)`);
    for (const p of pool) {
      assert.ok(p.length > 5 && p.length < 80, `${st}: knapp (${p.length} Zeichen)`);
      assert.ok(/[a-zäöüß]/i.test(p), `${st}: deutsch`);
    }
  }
});

test("pickPhrase: deterministisch für (state, seed, counter)", () => {
  for (const st of STATES) {
    for (let c = 0; c < 5; c++) {
      assert.equal(pickPhrase(st, 42, c), pickPhrase(st, 42, c));
      // T11.12: Phrase beginnt mit einem klaren Kernsatz — Poesie ist Anhang
      const core = pickPhrase(st, 42, c).split(". ")[0]!.trim();
      assert.ok(core.length > 3, `Kernsatz zu kurz: "${core}"`);
    }
  }
});

test("pickPhrase: countered Variation — nicht immer derselbe Satz", () => {
  const picks = new Set([0, 1, 2, 3, 4, 5].map((c) => pickPhrase("idle", 7, c)));
  assert.ok(picks.size >= 2, "mindestens 2 verschiedene Phrasen über 6 Aufrufe");
});

test("voiceDaySeed: UTC-Jahrestag, stabil am selben Tag", () => {
  const a = Date.parse("2026-11-07T01:00:00Z");
  const b = Date.parse("2026-11-07T23:00:00Z");
  assert.equal(voiceDaySeed(a), voiceDaySeed(b));
  assert.notEqual(voiceDaySeed(a), voiceDaySeed(b + 86_400_000));
});

test("phrases describe observed states without claiming completed commands or listening", () => {
  for (const st of STATES) {
    const phrases = Array.from({ length: 12 }, (_, c) => pickPhrase(st, 42, c));
    assert.ok(new Set(phrases).size >= 6, `${st}: six distinct formulations`);
    for (const phrase of phrases) {
      assert.doesNotMatch(phrase, /Befehle ausgeführt|höre mit|liest mit|Konversation|Alles in Ordnung|Ich vergesse nichts|Was verborgen liegt/u);
      assert.doesNotMatch(phrase, /[:—]\s*[.!?]|\{[sd]\}/u);
    }
  }
});
