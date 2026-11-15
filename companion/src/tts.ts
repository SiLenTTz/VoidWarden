/**
 * TTS-Client + Ghost-Post-Processing (EPIC-P11 T11.5): ruft den lokalen
 * Kokoro-Server (POST /tts → WAV-Stream) auf, piped das Ergebnis durch
 * FFmpeg (Pitch −2.5 Halbtöne als Rate-Trick + Resample, leichter Reverb,
 * Speed ~0.95 — asetrate/amix/aechannel-Kette) und cached das WAV im Speicher
 * für den Web-Endpoint /voice/:id. Queue max 1 concurrent (Server teilt sich
 * mit dem Telegram-Victoria-Setup, Epic Premortem #2). Fail loud: Fehler
 * werfen, niemals still — der Aufrufer (main.ts) loggt + zählt.
 */
import type { spawn } from "node:child_process";

export interface TtsDeps {
  /** POST JSON an den Kokoro-Server, gibt den Body als Uint8Array (WAV). */
  fetchWav(text: string, speed: number): Promise<Uint8Array>;
  /** FFmpeg-Pipe: rohes Kokoro-WAV → Geister-WAV (Pitch/Reverb/Speed). */
  ghost(wav: Uint8Array): Promise<Uint8Array>;
}

export interface VoiceCue {
  id: string;
  state: string;
  phrase: string;
  wav: Uint8Array | null;
  createdAtMs: number;
}

export interface TtsOptions {
  /** Kokoro-URL inkl. Pfad (default http://127.0.0.1:8797/tts, echtes Setup per Config). */
  url: string;
  speed: number;
  /** Pitch in Halbtönen (negativ = tiefer, default −2.5). */
  pitchSemitones: number;
  /** Ziel-Tempo (default 0.95). */
  tempo: number;
  timeoutMs: number;
}

export const DEFAULT_TTS_OPTIONS: TtsOptions = {
  url: "http://127.0.0.1:8797/tts",
  speed: 1.05,
  pitchSemitones: -2.5,
  tempo: 0.95,
  timeoutMs: 30_000,
};

/** Shared /tts API: voice defaults belong to the backend registry, never to event text. */
export async function fetchKokoroWav(url: string, text: string, speed: number, timeoutMs: number, fetchFn: typeof fetch, lang?: string): Promise<Uint8Array> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchFn(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: lang === undefined ? JSON.stringify({ text, speed }) : JSON.stringify({ text, speed, language: lang === "en" ? "English" : "German" }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      throw new Error(`tts: HTTP ${String(res.status)} von ${url}`);
    }
    const buf = await res.arrayBuffer();
    return new Uint8Array(buf);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Ghost-Post-Processing (FFmpeg): Pitch −2..−3 Halbtöne via asetrate+aresample
 * (21863 Hz statt 25416 Hz bei −2.5 HT), aecho als leichter Reverb, atempo für
 * Speed ~0.95. Läuft als Pipe: stdin-WAV → stdout-WAV, keine Temp-Dateien.
 */
export async function ghostProcess(wav: Uint8Array, opts: TtsOptions, deps: { spawnFn: typeof spawn }): Promise<Uint8Array> {
  const pitchFactor = 2 ** (opts.pitchSemitones / 12);
  const asetrate = Math.round(25416 * pitchFactor); // Kokoro-RATE (24000 * +1 HT)
  const filter =
    `asetrate=${String(asetrate)},aresample=24000,` +
    `aecho=0.8:0.85:60|90:0.25|0.2,` +
    `atempo=${String(opts.tempo)}`;
  return await new Promise<Uint8Array>((resolve, reject) => {
    const ff = deps.spawnFn("ffmpeg", [
      "-hide_banner", "-loglevel", "error",
      "-f", "wav", "-i", "pipe:0",
      "-af", filter,
      "-f", "wav", "pipe:1",
    ]);
    const chunks: Buffer[] = [];
    let errOut = "";
    ff.stdout.on("data", (c: Buffer) => chunks.push(c));
    ff.stderr.on("data", (c: Buffer) => {
      errOut += c.toString("utf8");
    });
    ff.on("error", reject);
    ff.on("close", (code) => {
      if (code === 0) resolve(new Uint8Array(Buffer.concat(chunks)));
      else reject(new Error(`tts: ffmpeg exit ${String(code)}: ${errOut.slice(0, 160)}`));
    });
    ff.stdin.on("error", () => undefined); // EPIPE wenn ffmpeg früher exitet
    ff.stdin.end(Buffer.from(wav));
  });
}

/**
 * Voice-Service: erzeugt Cues (Phrase → Kokoro → FFmpeg → Cache), genau einer
 * zugleich (Queue-Länge 1, weitere Synthesen warten — Premortem #2). maxCache
 * begrenzt den Speicher; älteste Cues fliegen raus.
 */
export class VoiceService {
  private readonly opts: TtsOptions;
  private readonly deps: TtsDeps;
  private readonly cache = new Map<string, VoiceCue>();
  private readonly order: string[] = [];
  private chain: Promise<unknown> = Promise.resolve();
  private failureCount = 0;

  constructor(opts: Partial<TtsOptions> | undefined, deps: TtsDeps) {
    this.opts = { ...DEFAULT_TTS_OPTIONS, ...opts };
    this.deps = deps;
  }

  get failures(): number {
    return this.failureCount;
  }

  /**
   * Synthese anstoßen (1-concurrent-Kette). Das zurückgegebene Promise
   * rejected bei Fehler (Aufrufer macht Fail loud); die interne Kette
   * schluckt den Fehler, damit nachfolgende speak() nicht vergiftet werden.
   */
  speak(id: string, state: string, phrase: string): Promise<VoiceCue> {
    const job = this.chain.then(async () => {
      const raw = await this.deps.fetchWav(phrase, this.opts.speed);
      const wav = await this.deps.ghost(raw);
      const cue: VoiceCue = { id, state, phrase, wav, createdAtMs: Date.now() };
      this.cache.set(id, cue);
      this.order.push(id);
      while (this.order.length > 8) {
        const drop = this.order.shift();
        if (drop !== undefined) this.cache.delete(drop);
      }
      return cue;
    });
    this.chain = job.catch(() => {
      this.failureCount += 1;
      return null;
    });
    return job;
  }

  get(id: string): VoiceCue | null {
    return this.cache.get(id) ?? null;
  }

  get options(): TtsOptions {
    return this.opts;
  }
}
