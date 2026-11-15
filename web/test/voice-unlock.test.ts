import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createVoiceUnlock,
  unlockFromGesture,
  relockAfterBlocked,
  isAudioLocked,
} from "../src/voice-unlock.ts";

const here = dirname(fileURLToPath(import.meta.url));

test("BUG-0017: Start gesperrt, erste Geste gibt frei, zweite ist no-op", () => {
  const s = createVoiceUnlock();
  assert.equal(isAudioLocked(s), true);
  assert.equal(unlockFromGesture(s), true);
  assert.equal(isAudioLocked(s), false);
  assert.equal(unlockFromGesture(s), false);
  assert.equal(s.unlocked, true);
});

test("BUG-0017: Relock nach NotAllowedError sperrt wieder", () => {
  const s = createVoiceUnlock();
  unlockFromGesture(s);
  relockAfterBlocked(s);
  assert.equal(isAudioLocked(s), true);
  assert.equal(unlockFromGesture(s), true);
});

test("BUG-0017-Verdrahtung: Gesten, Hinweisblase, Relock im play-catch", () => {
  const src = readFileSync(join(here, "../src/main.ts"), "utf8");
  assert.match(src, /unlockFromGesture/);
  assert.match(src, /relockAfterBlocked/);
  assert.match(src, /isAudioLocked/);
  assert.ok(src.includes("touchstart") && src.includes("pointerdown") && src.includes('"click"'), "mehrere Gesten-Listener");
  assert.ok(src.includes("Stimme wartet") || src.includes("tippen"), "sichtbarer Hinweis bei Sperre");
  const play = src.slice(src.indexOf("function playVoice"));
  const catchIdx = play.indexOf(".catch(");
  const relockIdx = play.indexOf("relockAfterBlocked");
  assert.ok(catchIdx > -1 && relockIdx > catchIdx, "Relock muss im play()-catch liegen");
});
