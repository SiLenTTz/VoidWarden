// --- T11.12: Sound-Toggle (neben online-Status) + Double-Tap Vorlesen ----------------
import { App } from "./app.ts";
import type { WebServerFrame, WebSessionItem, PendingApproval, NyxState, SessionSummary, WebVoiceFrame } from "./types.ts";
import { frameColumnAt, type NyxAtlasMeta } from "./nyx.ts";
import { eyeRgb, swapEyeMarkers } from "./eyes.ts";
import { focusSession, statusBubbleFor, initialBubbleState, pushBubble, tickBubble, dismissBubble, BUBBLE_HIDE_MS, type BubbleState } from "./bubble.ts";
import { startTypewriter, tickTypewriter, type TypewriterState } from "./typewriter.ts";
import { stageView, applyVoiceSentence, type StageInput, type StageView } from "./stage.ts";
import { parseDemoDisplay, demoStageInput, decideAllowed } from "./demo.ts";
import { tileDot, tileName, tileSecondLine, sortTiles } from "./tiles.ts";
import { sayDone, sayTap, type SayGate } from "./say.ts";
import { takeBodyText } from "./take-text.ts";
import { createVoiceUnlock, unlockFromGesture, relockAfterBlocked, isAudioLocked } from "./voice-unlock.ts";

// BUG-0013: Deployments dürfen nicht im 24-h-SW-Check hängen. sw.js ist durch
// den Build-Stempel byte-verschieden; hier aktiv nachsehen (Start + Foreground)
// und bei übernommenem Worker genau einmal neu laden.
{
  if ("serviceWorker" in navigator) {
    let reloadedForNewWorker = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloadedForNewWorker) return;
      reloadedForNewWorker = true;
      location.reload();
    });
    const checkForUpdate = () => {
      void navigator.serviceWorker.getRegistration().then((r) => r?.update()).catch(() => {});
    };
    checkForUpdate();
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") checkForUpdate();
    });
  }
}

// Beide Umschalter (T11.12/T11.14) sind unabhängige Modulebene-Blöcke — DE/EN
// funktioniert ohne den Lautsprecher (T13.1 §1-Bereinigung).
let soundMuted = localStorage.getItem("nyx-muted") === "1";
let voiceAudio: HTMLAudioElement | null = null;
function renderSoundToggle(): void {
  const el = document.querySelector<HTMLButtonElement>("#sound-toggle");
  if (el !== null) el.textContent = soundMuted ? "\u{1F507}" : "\u{1F50A}";
}

{
  const btn = document.querySelector<HTMLButtonElement>("#sound-toggle");
  btn?.addEventListener("click", (ev) => {
    ev.stopPropagation();
    unlockAudio(); // BUG-0017: Toggle zählt als Geste (Autoplay)
    soundMuted = !soundMuted;
    localStorage.setItem("nyx-muted", soundMuted ? "1" : "0");
    renderSoundToggle();
    if (!soundMuted) void voiceAudio?.play().catch(() => {});
  });
}
renderSoundToggle();

let nyxLang: "de" | "en" = localStorage.getItem("nyx-lang") === "en" ? "en" : "de";
function renderLangToggle(): void {
  const el = document.querySelector<HTMLButtonElement>("#lang-toggle");
  if (el !== null) el.textContent = nyxLang.toUpperCase();
}
{
  const btn = document.querySelector<HTMLButtonElement>("#lang-toggle");
  btn?.addEventListener("click", (ev) => {
    ev.stopPropagation();
    nyxLang = nyxLang === "de" ? "en" : "de";
    localStorage.setItem("nyx-lang", nyxLang);
    renderLangToggle();
    void fetch("/lang", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lang: nyxLang }) }).catch(() => {});
  });
}
renderLangToggle();

function currentSessions(): WebSessionItem[] {
  return (globalThis as { __nyxSessions?: WebSessionItem[] }).__nyxSessions ?? [];
}

const sayGate: SayGate = { inFlight: false };

/** Gemeinsamer /say-Pfad (Kopf-Vorlesen + Körper-Status, BUG-0018). */
async function speakText(speech: string, bubbleBody: string): Promise<void> {
  // BUG-0011: Qwen-Synthese dauert ~10 s — weitere Taps währenddessen nicht stapeln.
  if (!sayTap(sayGate)) return;
  try {
    // BUG-0011: Blase sofort (auch bei Mute, T11.15) — Feedback vor der Synthese.
    showBubble("voice", "Nyx liest vor …", bubbleBody);
    const res = await fetch("/say", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: speech, lang: nyxLang }),
    });
    if (!res.ok) throw new Error(`say ${res.status}`);
    const blob = await res.blob();
    voiceAudio?.pause();
    if (soundMuted) return;
    unlockAudio();
    const audio = new Audio(URL.createObjectURL(blob));
    voiceAudio = audio;
    await audio.play().catch((err: unknown) => {
      console.error("say: playback blockiert", err);
      relockAfterBlocked(voiceUnlock);
      showBubble("hint", "Stimme wartet", "Browser hat die Wiedergabe verweigert — erneut tippen.");
    });
  } catch (err) {
    showBubble("voice", "Vorlesen fehlgeschlagen", String(err));
  } finally {
    sayDone(sayGate);
  }
}

async function speakLastMessage(): Promise<void> {
  const focus = focusSession(currentSessions());
  const msg = focus?.lastAssistantMessage;
  if (focus === null || typeof msg !== "string" || msg === "") {
    showBubble("voice", "Nyx", "Keine letzte Nachricht zum Vorlesen vorhanden.");
    return;
  }
  const speech = nyxLang === "en" ? `${focus.name} says: ${msg}` : `${focus.name} sagt: ${msg}`;
  await speakText(speech, msg);
}

/** Körper-Tap: Status-Blase + dieselbe Info sprechen (BUG-0018). */
async function speakFocusStatus(): Promise<void> {
  if (focusItem === null) {
    showBubble("voice", "Nyx", "Keine Session im Fokus.");
    return;
  }
  const item = statusBubbleFor(focusItem, Date.now());
  showBubble(item.kind, item.title, item.body);
  const speech = nyxLang === "en" ? `${item.title}. ${item.body}` : `${item.title}. ${item.body}`;
  await speakText(speech, item.body);
}
// T11.13: Double-Tap entfernt — Kopf/Körper-Zonen ersetzen ihn

/**
 * UI-Einstieg (EPIC-P10 T10.4 → EPIC-P11): verdrahtet App mit dem DOM.
 * P11-Layout: Nyx-Bühne (obere 66 %) mit Sprite + Status-Label der Fokus-
 * Session, darunter das 2-Spalten-Kachelgrid (33 %) mit Sprechblase darüber.
 * Voice-Playback (T11.5): WS-Frame "voice" → /voice/<id> laden → Audio nach
 * erster Nutzer-Interaktion (Autoplay-Policy, Epic Premortem #1). Fail loud:
 * blockiertes Audio und TTS-Fehler landen als sichtbare Blase + Konsole.
 */
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const $dialog = (id: string): HTMLDialogElement => document.getElementById(id) as HTMLDialogElement;

// T13.1 Schritt 5: Demo-Modus ?demo=<display> — fester Anzeigezustand ohne
// WebSocket (Fotos/Golden-Bilder/Geräteabnahme); der Client sendet nie decide.
const demoDisplay = parseDemoDisplay(location.search);

/**
 * Nyx-Sprite (T10.8): zeichnet den animierten Frame aus dem Atlas-Canvas in
 * die Ziel-Canvases (Header-Icon + Bühne). Reine Frame-Logik in nyx.ts.
 */
class NyxSprite {
  private readonly atlas: HTMLCanvasElement;
  private readonly meta: NyxAtlasMeta;
  private readonly targets: HTMLCanvasElement[];
  /** Offscreen 1:1 für Marker-Tausch (BUG-0016), dann skaliert auf Targets. */
  private readonly scratch: HTMLCanvasElement;
  private startedAt = 0;
  private state: NyxState = "offline";
  private rafId: number | null = null;

  constructor(atlas: HTMLCanvasElement, meta: NyxAtlasMeta, targets: HTMLCanvasElement[]) {
    this.atlas = atlas;
    this.meta = meta;
    this.targets = targets;
    this.scratch = document.createElement("canvas");
    this.scratch.width = meta.fw;
    this.scratch.height = meta.fh;
  }

  update(state: NyxState): void {
    if (state !== this.state) {
      this.state = state;
      this.startedAt = performance.now(); // Posenwechsel → Animation von vorn
    }
    this.ensureRunning();
  }

  private ensureRunning(): void {
    if (this.rafId !== null) return;
    const draw = (): void => {
      this.rafId = requestAnimationFrame(draw);
      const elapsed = this.startedAt === 0 ? 0 : performance.now() - this.startedAt;
      const col = frameColumnAt(this.meta, this.state, elapsed);
      if (col < 0) {
        // Fail loud (AGENTS.md #7): Atlas/Meta inkonsistent — nie still schwarz
        console.error("nyx: kein Frame für State", this.state);
        return;
      }
      const sctx = this.scratch.getContext("2d");
      if (sctx === null) return;
      sctx.clearRect(0, 0, this.meta.fw, this.meta.fh);
      sctx.drawImage(this.atlas, col * this.meta.fw, 0, this.meta.fw, this.meta.fh, 0, 0, this.meta.fw, this.meta.fh);
      const img = sctx.getImageData(0, 0, this.meta.fw, this.meta.fh);
      swapEyeMarkers(img.data, eyeRgb(this.state));
      sctx.putImageData(img, 0, 0);
      for (const t of this.targets) {
        const ctx = t.getContext("2d");
        if (ctx === null) continue;
        ctx.imageSmoothingEnabled = false;
        ctx.clearRect(0, 0, t.width, t.height);
        ctx.drawImage(this.scratch, 0, 0, this.meta.fw, this.meta.fh, 0, 0, t.width, t.height);
      }
    };
    this.rafId = requestAnimationFrame(draw);
  }
}

async function loadNyxSprite(headerCanvas: HTMLCanvasElement, stageCanvas: HTMLCanvasElement): Promise<NyxSprite | null> {
  const [meta, img] = await Promise.all([
    fetch("/nyx/nyx-atlas.json").then((r) => r.json() as Promise<NyxAtlasMeta>),
    new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("nyx: Atlas-Bild nicht ladbar"));
      el.src = "/nyx/nyx-atlas.png";
    }),
  ]);
  const atlas = document.createElement("canvas");
  atlas.width = img.naturalWidth;
  atlas.height = img.naturalHeight;
  atlas.getContext("2d")?.drawImage(img, 0, 0);
  return new NyxSprite(atlas, meta, [headerCanvas, stageCanvas]);
}

function wsUrl(): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/ws`;
}

function fakeWebSocketForSameOrigin(): WebSocket {
  // Der Companion-WS läuft auf demselben Host:8791 — bei Dev über Vite-Proxy /ws.
  return new WebSocket(wsUrl());
}

function fmtAgo(ms: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return "gerade eben";
  if (s < 3600) return `vor ${Math.floor(s / 60)} min`;
  if (s < 86400) return `vor ${Math.floor(s / 3600)} h`;
  return `vor ${Math.floor(s / 86400)} d`;
}

function beep(): void {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    gain.gain.value = 0.08;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.15);
    setTimeout(() => void ctx.close(), 400);
  } catch (err) {
    console.warn("notification: kein Web Audio", err);
  }
}

function notify(title: string, body: string): void {
  beep();
  if ("vibrate" in navigator) navigator.vibrate?.([120, 60, 120]);
  else console.warn("notification: Vibration API fehlt (Premortem #5) — Sound-only");
  if ("Notification" in window) {
    if (Notification.permission === "granted") new Notification(title, { body });
    else if (Notification.permission !== "denied") {
      void Notification.requestPermission().then((p) => {
        if (p === "granted") new Notification(title, { body });
      });
    }
  } else {
    console.warn("notification: Notification API fehlt (Premortem #5)");
  }
}

// --- EPIC-P11 T11.1: Kachelgrid; T13.4: sprechende Kacheln (§4.3) ----------
function renderSessions(list: WebSessionItem[]): void {
  const container = $("sessions");
  container.replaceChildren();
  const now = Date.now();
  for (const s of sortTiles(list)) {
    const tile = document.createElement("a");
    tile.className = "tile" + (s.attention ? " attention" : "");
    tile.href = `#session-${s.id}`;
    const row = document.createElement("div");
    row.className = "t-row";
    const dot = document.createElement("span");
    dot.className = `dot ${tileDot(s, now)}`;
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = tileName(s);
    row.append(dot, name);
    const act = document.createElement("div");
    act.className = "act";
    act.textContent = tileSecondLine(s, fmtAgo(Date.parse(s.updatedAt)));
    tile.append(row, act);
    tile.addEventListener("click", (ev) => {
      ev.preventDefault();
      showDetail(s);
    });
    container.append(tile);
  }
}

function showDetail(s: WebSessionItem): void {
  $("d-name").textContent = s.name;
  // T13.4: Titel und Aktivität als erste Zeilen (§4.3), darunter wie bisher
  $("d-text").textContent =
    [...(s.title === undefined || s.title === "" ? [] : [s.title]), ...(s.activity === undefined || s.activity === "" ? [] : [s.activity]), `${s.status} · ${fmtAgo(Date.parse(s.updatedAt))}`, "", s.lastAssistantMessage ?? "(keine Nachricht)"].join("\n");
  $dialog("detail").showModal();
}

// --- EPIC-P11 T11.3: Sprechblasen-Queue (max 1 sichtbar, auto-hide) --------
// T11.11: Typewriter — Text erscheint menschlich getippt (siehe typewriter.ts)
let bubbleState: BubbleState = initialBubbleState();
let lastBubbleTick = 0;
let twState: (TypewriterState & { startMs: number }) | null = null;
let twSeed = 1;

function renderBubble(): void {
  const el = $("bubble");
  const cur = bubbleState.visible;
  if (cur === null) {
    el.classList.remove("visible");
    twState = null;
    return;
  }
  const title = el.querySelector(".b-title") as HTMLElement | null;
  const body = el.querySelector(".b-body") as HTMLElement | null;
  if (title !== null) title.textContent = cur.title;
  if (body !== null) {
    if (twState !== null) {
      // während des Tippens: nur Präfix + Cursor-Klasse
      body.textContent = twState.text.slice(0, twState.charIdx);
      body.classList.toggle("typing", !twState.done);
    } else {
      body.textContent = cur.body;
      body.classList.remove("typing");
    }
  }
  el.classList.add("visible");
  if (bubbleState.dropped > 0) {
    console.warn(`bubble: ${String(bubbleState.dropped)} Blasen verworfen (Queue voll)`);
  }
}

function showBubble(kind: "status" | "ticker" | "voice" | "hint", title: string, body: string): void {
  bubbleState = pushBubble(bubbleState, { kind, title, body, atMs: Date.now() });
  // Typewriter nur für neue sichtbare Blase starten (Queue rückt erst später nach)
  if (bubbleState.visible !== null && bubbleState.visible.body === body && bubbleState.visible.atMs + BUBBLE_HIDE_MS > Date.now()) {
    twSeed = (twSeed * 1103515245 + 12345) % 2147483647;
    twState = startTypewriter(body, twSeed, Date.now());
  }
  renderBubble();
}

setInterval(() => {
  const now = Date.now();
  if (now === lastBubbleTick) return;
  lastBubbleTick = now;
  // T13.5: Restzeit der offenen Freigabe zählt sekündlich lokal (nur Anzeige)
  if (currentApproval !== null && !$("take").hidden) renderTakeMeta();
  // T13.2: Satz-Typewriter (eigener Zustand, unabhängig von der Blase)
  if (sentenceTw !== null && !sentenceTw.done) {
    sentenceTw = tickTypewriter(sentenceTw, now);
    $("stage-sentence").textContent = sentenceTw.text.slice(0, sentenceTw.charIdx);
  }
  // Typewriter-Tick (60-fps-nah genug bei 80 ms; enthüllt bis zu n Zeichen pro Tick)
  if (twState !== null && !twState.done) {
    twState = tickTypewriter(twState, now);
    renderBubble();
  }
  const next = tickBubble(bubbleState, now);
  if (next !== bubbleState) {
    bubbleState = next;
    // nachgezogene Blase aus der Queue: neuer Typewriter-Lauf
    if (bubbleState.visible !== null) {
      twSeed = (twSeed * 1103515245 + 12345) % 2147483647;
      twState = startTypewriter(bubbleState.visible.body, twSeed, now);
    } else {
      twState = null;
    }
    renderBubble();
  }
}, 80);

$("bubble").addEventListener("click", () => {
  bubbleState = dismissBubble(bubbleState);
  renderBubble();
});

// --- EPIC-P11 T11.5: Voice-Playback (Autoplay-freigabe nach Interaktion) ---
const voiceUnlock = createVoiceUnlock();
/** BUG-0014: Cue vor dem ersten Tap nicht verwerfen — nach Unlock nachspielen. */
let pendingVoice: WebVoiceFrame | null = null;

function unlockAudio(): void {
  // BUG-0017: nicht nur einmalig pointerdown — jede Geste darf freigeben;
  // nach NotAllowedError ist erneut eine Geste nötig (relockAfterBlocked).
  if (!unlockFromGesture(voiceUnlock)) return;
  showBubble("hint", "Stimme aktiv", "Nyx darf jetzt sprechen.");
  if (pendingVoice !== null) {
    const queued = pendingVoice;
    pendingVoice = null;
    playVoice(queued);
  }
}

for (const type of ["pointerdown", "touchstart", "click"] as const) {
  document.addEventListener(type, () => unlockAudio(), { capture: true });
}

function playVoice(frame: WebVoiceFrame): void {
  if (frame.error) {
    // Fail loud: TTS-Fehler sichtbar, kein Silent-Drop (AC-P11-4)
    showBubble("voice", "Stimme fehlerhaft", `TTS fehlgeschlagen (${frame.state}) — siehe Konsole.`);
    console.error("voice: TTS-Fehler für Cue", frame.id, frame.state);
    return;
  }
  if (isAudioLocked(voiceUnlock)) {
    pendingVoice = frame;
    // Fail loud sichtbar (nicht nur console): Kiosk sonst tagelang stumm (BUG-0017)
    showBubble("hint", "Stimme wartet", "Einmal tippen — dann spricht Nyx.");
    console.warn("voice: Audio noch gesperrt (Autoplay) — tippe einmal, um die Stimme freizugeben");
    return;
  }
  showBubble("voice", "Nyx spricht", frame.phrase);
  voiceAudio?.pause();
  if (soundMuted) return; // T11.12: Sound aus — Blase bleibt, Audio nicht
  const audio = new Audio(`/voice/${frame.id}`);
  voiceAudio = audio;
  audio.play().catch((err: unknown) => {
    console.error("voice: Playback blockiert (fail loud)", err);
    relockAfterBlocked(voiceUnlock);
    pendingVoice = frame;
    showBubble("hint", "Stimme wartet", "Browser hat die Wiedergabe verweigert — erneut tippen.");
  });
}

let currentApprovalId: string | null = null;
let currentDecidable = false;
let currentApproval: PendingApproval | null = null;
let lastFrameState: NyxState = "offline";
let hubState: "up" | "down" = "up";
let hubDownSinceMs: number | null = null;
let lastSessions: SessionSummary = { total: 0, working: 0, waiting: 0, error: 0 };
let focusItem: WebSessionItem | null = null;
let wsOffline = true; // bis zum ersten onOfflineChange(false)
let decayedNow = false;
const nyxSpritePromise = loadNyxSprite($("nyx-header"), $("nyx-stage-canvas"));

/** Gesamteingabe für die Bühne — stageView ist die einzige Wahrheit (T13.1). */
function stageInput(): StageInput {
  return {
    wsOffline,
    decayed: decayedNow,
    frameState: lastFrameState,
    hub: hubState,
    approval: currentApproval,
    focus: focusItem,
    sessions: lastSessions,
    hubDownSinceMs,
  };
}

/** T13.1/T13.2: Bühne rendern — wertet nur stageView aus (Sprite, Farbe, Aura,
 * Zeile, Satz). Der Satz läuft über den vorhandenen Typewriter; ein Voice-Satz
 * (T13.2) gilt bis der Anzeigezustand wechselt. */
let lastView: StageView | null = null;
let voiceSentence: string | null = null;
let sentenceTw: (TypewriterState & { startMs: number }) | null = null;
let sentenceSeed = 1;
let shownSentence = "";

function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function renderStage(input: StageInput): void {
  const view = stageView(input);
  // Voice-Satz endet mit dem Anzeigezustand, für den er kam (§3)
  if (voiceSentence !== null && lastView !== null && view.display !== lastView.display) {
    voiceSentence = null;
  }
  lastView = view;
  void nyxSpritePromise
    .then((sprite) => sprite?.update(view.sprite))
    .catch((err) => console.error("nyx: Atlas nicht ladbar — Sprite inaktiv (fail loud)", err));
  $("stage").style.setProperty("--c", `var(${view.colorVar})`);
  const aura = $("aura");
  aura.classList.remove("breathe", "still", "off");
  aura.classList.add(view.aura);
  $("stage-line").textContent = view.line;
  const sentence = voiceSentence ?? view.sentence;
  if (sentence !== shownSentence) {
    shownSentence = sentence;
    if (reducedMotion()) {
      sentenceTw = null; // „Bewegung reduzieren": sofort vollständig (AC-P13-5)
      $("stage-sentence").textContent = sentence;
    } else {
      sentenceSeed = (sentenceSeed * 1103515245 + 12345) % 2147483647;
      sentenceTw = startTypewriter(sentence, sentenceSeed, Date.now());
    }
  }
}

const DECIDE_RESULT_TEXT: Record<string, string> = {
  decided: "Entscheidung gesendet",
  conflict: "Konflikt — bereits am Hub entschieden",
  rejected_by_policy: "Vom Hub abgelehnt (Policy)",
  not_decidable: "Nicht am Gerät entscheidbar",
  already_decided: "Bereits entschieden",
  error: "Fehler bei der Entscheidung",
};

// --- BUG-0015: Aufmerksamkeits-Badge → Popup (Tippen, kein Hold, kein Tippen-Feld) ---
// Badge-Öffnen ist die bewusste Geste (ersetzt Hold-Sicherheit aus ADR-0012 am Popup).
let takeLocked = false;
let takeResultTimer: unknown = null;
let takeFrameAtMs = 0;
let lastZoneClickAt = 0;
let takeOpen = false;
type SpeechRec = { start(): void; stop(): void; lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((ev: { results: { [i: number]: { [j: number]: { transcript: string } } } }) => void) | null;
  onerror: (() => void) | null; onend: (() => void) | null };
let speechRec: SpeechRec | null = null;

function showTakeResult(text: string): void {
  const el = $("take-result");
  el.textContent = text;
  el.hidden = false;
}

function clearTakeTimer(): void {
  if (takeResultTimer !== null) {
    clearTimeout(takeResultTimer as ReturnType<typeof setTimeout>);
    takeResultTimer = null;
  }
}

function sendTakeDecision(decision: "approve" | "decline"): void {
  if (currentApprovalId === null || !currentDecidable || takeLocked) return;
  if (!decideAllowed(demoDisplay)) {
    showTakeResult(decision === "approve" ? "Demo — Freigabe nicht gesendet." : "Demo — Ablehnung nicht gesendet.");
    return;
  }
  takeLocked = true;
  renderTakeZones();
  app.decide(currentApprovalId, decision);
  clearTakeTimer();
  takeResultTimer = setTimeout(() => {
    takeResultTimer = null;
    takeLocked = false;
    showTakeResult("Keine Antwort vom Companion");
    renderTakeZones();
  }, 10_000);
}

function resetTake(): void {
  clearTakeTimer();
  takeLocked = false;
  stopVoiceListen();
  $("take-result").hidden = true;
}

function setAttnVisible(on: boolean, ask: boolean): void {
  const el = $("attn") as HTMLButtonElement;
  el.hidden = !on;
  el.classList.toggle("ask", ask);
}

function hideTakePopup(): void {
  takeOpen = false;
  $("take").hidden = true;
  stopVoiceListen();
}

function openTakePopup(): void {
  if (currentApproval === null) return;
  unlockAudio();
  // Stummschaltung oft die Ursache für „keine Stimme“ — Popup macht sie sichtbar
  if (soundMuted) showTakeResult("Ton ist aus — Lautsprecher oben rechts tippen.");
  takeOpen = true;
  $("take").hidden = false;
  renderTakeMeta();
  renderTakeZones();
}

function agentNameOf(approval: PendingApproval): string {
  const item = currentSessions().find((s) => s.id === approval.agent_id);
  return item === undefined ? "EIN AGENT" : tileName(item);
}

function renderTakeMeta(): void {
  if (currentApproval === null) return;
  const remaining = Math.max(0, Math.round(currentApproval.timeout_s - (Date.now() - takeFrameAtMs) / 1000));
  const clock = `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`;
  $("take-meta").textContent =
    currentApproval.kind === "question" ? clock : `${currentApproval.class} · ${clock}`;
}

function renderTakeZones(): void {
  const approval = currentApproval;
  if (approval === null) return;
  const yes = $("take-yes") as HTMLButtonElement;
  const no = $("take-no") as HTMLButtonElement;
  const voice = $("take-voice") as HTMLButtonElement;
  const needsVoice = approval.kind === "question" || !approval.decidable;
  const single = needsVoice;
  $("take-zones").classList.toggle("single", single);
  no.hidden = single;
  yes.disabled = single || takeLocked;
  no.disabled = takeLocked;
  // BUG-0016: Stimme immer sichtbar — füllt den Session-Composer, nie decide.
  voice.hidden = false;
  const label = yes.querySelector("span");
  if (label !== null) {
    if (approval.kind === "question") label.textContent = "Am Rechner";
    else if (!approval.decidable) label.textContent = "Am Handy";
    else label.textContent = "Freigeben";
  }
}

function fillTakeContent(approval: PendingApproval): void {
  $("take").classList.toggle("ask", approval.kind === "question");
  $("take-head").textContent = `${agentNameOf(approval)} FRAGT`;
  $("take-body").textContent = takeBodyText(approval.payload);
  renderTakeMeta();
  renderTakeZones();
}

/** Badge sichtbar bei Freigabe; Popup nur nach bewusstem Tippen auf #attn. */
function renderTake(approval: PendingApproval | null): void {
  currentApproval = approval;
  if (approval === null) {
    if (currentApprovalId !== null) resetTake();
    currentApprovalId = null;
    currentDecidable = false;
    setAttnVisible(false, false);
    hideTakePopup();
    return;
  }
  if (approval.action_id !== currentApprovalId) {
    resetTake();
    hideTakePopup(); // neue Freigabe: Badge tippen, nicht Auto-Popup
  }
  currentApprovalId = approval.action_id;
  currentDecidable = approval.decidable;
  takeFrameAtMs = Date.now();
  fillTakeContent(approval);
  setAttnVisible(true, approval.kind === "question");
  if (takeOpen) {
    $("take").hidden = false;
    renderTakeZones();
  }
}

function stopVoiceListen(): void {
  const btn = $("take-voice");
  btn.classList.remove("listening");
  try {
    speechRec?.stop();
  } catch {
    /* ignore */
  }
}

/** Session für Voice→Composer: offene Freigabe, sonst Fokus-Kachel. */
function draftSessionId(): string | null {
  if (currentApproval !== null && currentApproval.agent_id !== "") return currentApproval.agent_id;
  if (focusItem !== null && focusItem.id !== "") return focusItem.id;
  return null;
}

/** Stimme → Session-Entwurf (ADR-0025/0069). Kein Steer, kein <input> (ADR-0012). */
function startVoiceListen(): void {
  const SR = (globalThis as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec }).SpeechRecognition
    ?? (globalThis as { webkitSpeechRecognition?: new () => SpeechRec }).webkitSpeechRecognition;
  if (SR === undefined) {
    showTakeResult("Spracherkennung fehlt — bitte am Handy antworten.");
    return;
  }
  const sessionId = draftSessionId();
  if (sessionId === null) {
    showTakeResult("Keine Session für den Entwurf — Kachel tippen oder Freigabe abwarten.");
    return;
  }
  unlockAudio();
  stopVoiceListen();
  const rec = new SR();
  speechRec = rec;
  rec.lang = nyxLang === "en" ? "en-US" : "de-DE";
  rec.continuous = false;
  rec.interimResults = false;
  rec.onresult = (ev) => {
    const said = ev.results[0]?.[0]?.transcript?.trim() ?? "";
    if (said === "") {
      showTakeResult("Nichts gehört.");
    } else {
      app.draft(sessionId, said);
      showTakeResult(`Gehört: „${said}" — landet im AncientVoid-Eingabefeld.`);
    }
    stopVoiceListen();
  };
  rec.onerror = () => {
    showTakeResult("Sprache nicht erkannt — nochmal tippen oder am Handy.");
    stopVoiceListen();
  };
  rec.onend = () => {
    $("take-voice").classList.remove("listening");
  };
  $("take-voice").classList.add("listening");
  showTakeResult("Ich höre zu …");
  try {
    rec.start();
  } catch {
    showTakeResult("Mikrofon blockiert — Berechtigung prüfen.");
    stopVoiceListen();
  }
}

/** T10.6/T13.5: decide_result sichtbar — Ausnahme-Zustände nie still (fail loud).
 * Zonen bleiben gesperrt, bis der Frame die Freigabe entfernt oder ersetzt. */
function showDecideResult(outcome: string): void {
  clearTakeTimer();
  showTakeResult(DECIDE_RESULT_TEXT[outcome] ?? `Unbekanntes Ergebnis: ${outcome}`);
  if (currentApproval !== null) openTakePopup(); // Ergebnis sichtbar, auch ohne offenes Popup
  if (outcome !== "decided") console.warn("decide_result:", outcome);
}

const app = new App(
  {
    now: () => Date.now(),
    connectWs: fakeWebSocketForSameOrigin,
    setTimeoutFn: (fn, ms) => setTimeout(fn, ms) as unknown,
    clearTimeoutFn: (t: unknown) => clearTimeout(t as ReturnType<typeof setTimeout>),
    notify: (title, body) => notify(title, body),
  },
  {
    onFrame: (frame: WebServerFrame) => {
      if (frame.type === "snapshot" || frame.type === "state_change") {
        (globalThis as { __nyxSessions?: WebSessionItem[] }).__nyxSessions = frame.sessionList ?? [];
        lastFrameState = frame.state;
        if (frame.hub !== undefined) {
          if (frame.hub === "down" && hubState === "up") hubDownSinceMs = Date.now();
          if (frame.hub === "up") hubDownSinceMs = null;
          hubState = frame.hub;
        }
        if (frame.sessions !== undefined) lastSessions = frame.sessions;
        const list = frame.sessionList ?? [];
        focusItem = focusSession(list);
        renderStage(stageInput());
        renderSessions(list);
        renderTake(frame.type === "snapshot" ? frame.approval : frame.approval ?? null);
      } else if (frame.type === "decide_result") {
        showDecideResult(frame.outcome);
      } else if (frame.type === "draft_result") {
        if (frame.outcome === "saved") {
          showTakeResult("Im AncientVoid-Eingabefeld gespeichert — bitte dort senden.");
        } else if (frame.outcome === "not_available") {
          showTakeResult("Entwurf nicht möglich — Display-Token fehlt.");
        } else {
          showTakeResult(`Entwurf fehlgeschlagen (${frame.outcome}).`);
          console.warn("draft_result:", frame.outcome);
        }
        if (currentApproval !== null) openTakePopup();
      } else if (frame.type === "voice") {
        // T13.2: Voice-Satz auf die Bühne — nur ohne Fehler und bei gleichem
        // Zustand (applyVoiceSentence), gilt bis der Anzeigezustand wechselt
        if (!frame.error && lastView !== null) {
          const withVoice = applyVoiceSentence(lastView, { state: frame.state, phrase: frame.phrase, error: frame.error });
          if (withVoice.sentence !== lastView.sentence) {
            voiceSentence = frame.phrase;
            renderStage(stageInput());
          }
        }
        playVoice(frame);
      }
    },
    onOfflineChange: (offline) => {
      wsOffline = offline;
      renderStage(stageInput());
      $("conn").textContent = offline ? "offline" : "online";
      $("conn").className = offline ? "down" : "up";
      // T13.2: kein Offline-Kasten mehr — Kacheln bleiben mit letztem Stand
      // sichtbar, gedimmt (W6)
      $("sessions").classList.toggle("dimmed", offline);
    },
    onTicker: (name, text, shownAtMs) => {
      // T11.3: Idle-Ticker-Nachrichten erscheinen als Blase über dem Grid
      showBubble("ticker", `${name} · ${fmtAgo(shownAtMs)}`, text);
    },
    onDecayChange: (decayed) => {
      decayedNow = decayed;
      // T13.2: kein Idle-Overlay mehr — „asleep“ ist ein Anzeigezustand der
      // Bühne (RUHT / „Tippe für den letzten Status.“)
      renderStage(stageInput());
    },
    onAttention: (title) => notify("VoidWarden", title),
  },
);

/** T11.2: Tap auf die Bühne → Status-Blase / Vorlesen (nicht #attn).
 * BUG-0018: Körper-Zone spricht den Status (nicht nur Text-Blase). */
$("stage").addEventListener("click", (ev: MouseEvent) => {
  const t = ev.target as HTMLElement | null;
  if (t !== null && (t.id === "attn" || t.closest?.("#attn") !== null)) return;
  unlockAudio();
  const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect();
  const relY = (ev.clientY - rect.top) / Math.max(rect.height, 1);
  if (relY < 0.45) {
    bubbleState = dismissBubble(bubbleState);
    void speakLastMessage();
    return;
  }
  if (focusItem !== null) {
    bubbleState = dismissBubble(bubbleState);
    void speakFocusStatus();
    return;
  }
  if (decayedNow) {
    const res = app.tapNyx();
    if (res.showStatus && !res.reviveTicker) {
      const el = $("sessions").firstElementChild as HTMLElement | null;
      if (el !== null) el.click();
    }
  }
});

// BUG-0015: Badge öffnet Popup; kleine Tippen-Buttons; Voice ohne <input>
$("attn").addEventListener("click", (ev) => {
  ev.stopPropagation();
  openTakePopup();
});
$("take-close").addEventListener("click", () => hideTakePopup());
$("take").addEventListener("click", (ev) => {
  if (ev.target === $("take")) hideTakePopup(); // Backdrop
});
{
  const tap = (fn: () => void): void => {
    if (Date.now() - lastZoneClickAt < 150) return;
    lastZoneClickAt = Date.now();
    fn();
  };
  $("take-yes").addEventListener("click", () => tap(() => sendTakeDecision("approve")));
  $("take-no").addEventListener("click", () => tap(() => sendTakeDecision("decline")));
  $("take-voice").addEventListener("click", () => tap(() => startVoiceListen()));
}

$("d-close").addEventListener("click", () => $dialog("detail").close());

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch((err) => console.warn("sw: Registrierung fehlgeschlagen", err));
}

// Demo-Modus: Bühne einfrieren statt WS-Start (+ Badge/Popup befüllbar)
if (demoDisplay !== null) {
  $("conn").textContent = "demo";
  $("conn").className = "";
  const demo = demoStageInput(demoDisplay);
  renderStage(demo);
  renderTake(demo.approval);
} else {
  app.start();
}
