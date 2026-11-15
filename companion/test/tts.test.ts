// EPIC-P11 T11.5: TTS-Kette — Kokoro-Fetch, FFmpeg-Ghost, 1-concurrent-Queue,
// Fail loud bei Server-down/ffmpeg-Fehler (AC-P11-4 negativer Pfad).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { VoiceService, fetchKokoroWav, ghostProcess, DEFAULT_TTS_OPTIONS } from "../src/tts.ts";

test("DEFAULT_TTS_OPTIONS.url zeigt auf localhost (kein privater Endpunkt im Code)", () => {
  assert.equal(DEFAULT_TTS_OPTIONS.url, "http://127.0.0.1:8797/tts");
});

function okFetch(wav: Uint8Array): typeof fetch {
  return (async () => new Response(wav as unknown as ConstructorParameters<typeof Response>[0], { status: 200 })) as unknown as typeof fetch;
}
void okFetch;

test("fetchKokoroWav: POST mit Text+Speed, Ergebnis durchgereicht", async () => {
  const wav = new Uint8Array([1, 2, 3]);
  const seen: Array<{ url: string; init: RequestInit }> = [];
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(url), init: init ?? {} });
    return new Response(wav as unknown as ConstructorParameters<typeof Response>[0], { status: 200 });
  }) as unknown as typeof fetch;
  const out = await fetchKokoroWav("http://x/tts", "Hallo", 1.05, 5000, f);
  assert.deepEqual(Array.from(out), [1, 2, 3]);
  assert.equal(seen.length, 1);
  assert.equal(seen[0]?.url, "http://x/tts");
  const body = JSON.parse(String(seen[0]?.init.body)) as { text: string; speed: number };
  assert.equal(body.text, "Hallo");
  assert.equal(body.speed, 1.05);
});

test("fetchKokoroWav: HTTP-Fehler → Fail loud (throw, kein Silent)", async () => {
  const f = (async () => new Response("down", { status: 503 })) as unknown as typeof fetch;
  await assert.rejects(() => fetchKokoroWav("http://x/tts", "Hallo", 1.05, 5000, f), /503/);
});

test("fetchKokoroWav: Timeout bricht ab", async () => {
  const f = (async (_url: unknown, init: RequestInit) => {
    return await new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
    });
  }) as unknown as typeof fetch;
  await assert.rejects(() => fetchKokoroWav("http://x/tts", "Hallo", 1.05, 50, f), /abort/i);
});

test("ghostProcess: echtes FFmpeg produziert WAV (Pitch/Reverb/Tempo-Kette läuft)", { timeout: 30_000 }, async () => {
  // Kleines valides WAV generieren (1 s Sinus, 24 kHz) und durch die Ghost-Kette schicken
  const gen = await new Promise<Buffer>((resolve, reject) => {
    const ff = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=220:duration=1", "-ar", "24000", "-f", "wav", "pipe:1"]);
    const chunks: Buffer[] = [];
    ff.stdout.on("data", (c) => chunks.push(c));
    ff.on("close", (code) => (code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`gen exit ${String(code)}`))));
  });
  assert.ok(gen.length > 1000);
  const out = await ghostProcess(new Uint8Array(gen), DEFAULT_TTS_OPTIONS, { spawnFn: spawn });
  assert.ok(out.length > 1000);
  assert.equal(out[0], 0x52); // 'R' von RIFF
  assert.equal(out[8], 0x57); // 'W' von WAVE
});

test("ghostProcess: defektes WAV → ffmpeg-Fehler, Fail loud", async () => {
  await assert.rejects(
    () => ghostProcess(new Uint8Array([0, 1, 2, 3]), DEFAULT_TTS_OPTIONS, { spawnFn: spawn }),
    /ffmpeg exit/,
  );
});

test("VoiceService: speak cached Cue, get liefert WAV; Fehler zählt und wirft", async () => {
  let calls = 0;
  const svc = new VoiceService(undefined, {
    fetchWav: async () => {
      calls += 1;
      return new Uint8Array([9, 9]);
    },
    ghost: async (w) => w,
  });
  const cue = await svc.speak("id1", "idle", "Ich warte im Zwielicht.");
  assert.equal(cue.wav?.length, 2);
  assert.equal(svc.get("id1")?.id, "id1");
  assert.equal(calls, 1);

  const bad = new VoiceService(undefined, {
    fetchWav: async () => {
      throw new Error("server down");
    },
    ghost: async (w) => w,
  });
  await assert.rejects(() => bad.speak("id2", "error", "x"), /server down/);
  assert.equal(bad.failures, 1);
  assert.equal(bad.get("id2"), null);
});

test("VoiceService: 1 concurrent — zweiter speak wartet auf den ersten", async () => {
  const order: string[] = [];
  let release1: (() => void) | null = null;
  const svc = new VoiceService(undefined, {
    fetchWav: async (_t, _s) => {
      if (release1 !== null) {
        const r = release1;
        release1 = null;
        await new Promise<void>((res) => {
          r();
          res();
        });
        order.push("first-done");
        return new Uint8Array([1]);
      }
      order.push("second-start");
      return new Uint8Array([2]);
    },
    ghost: async (w) => w,
  });
  // Erster speak hält an, zweiter darf erst nach dessen Abschluss starten.
  const p1Gate = new Promise<void>((res) => {
    release1 = res;
  });
  const firstBlocking = (async () => {
    await p1Gate;
  })();
  const s1 = svc.speak("a", "idle", "eins");
  const s2 = svc.speak("b", "error", "zwei");
  await Promise.all([firstBlocking, s1, s2]);
  assert.deepEqual(order, ["first-done", "second-start"]);
});

test("TTS backends resolve their own German and English voices", async () => {
  for (const lang of ["de", "en"]) {
    let body: Record<string, unknown> = {};
    const f = (async (_url: unknown, init: RequestInit) => {
      body = JSON.parse(String(init.body)) as Record<string, unknown>;
      return new Response(new Uint8Array([1]));
    }) as typeof fetch;
    await fetchKokoroWav("http://hivemind/tts", "Hallo", 1, 5000, f, lang);
    assert.equal(body.language, lang === "de" ? "German" : "English");
    assert.equal(body.voice, undefined, "backend registry chooses a compatible default voice");
    assert.equal(body.instruct, undefined, "display text never becomes a persona instruction");
  }
});
