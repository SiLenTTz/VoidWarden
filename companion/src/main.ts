/**
 * Companion-Main (EPIC-P1): Config → Logger/Metrics → Hub-Poll (Backoff) →
 * aggregate → Bridge → Serial (Reconnect) → Status-Socket. Jede Komponente
 * einzeln testbar; hier nur Verdrahtung (architecture.md §5).
 */
import { checkStats } from "./stats-check.ts";
import { join } from "node:path";
import { loadConfig, readToken } from "./config.ts";
import { Logger } from "./log.ts";
import { Metrics } from "./metrics.ts";
import { HubClient, type HubSnapshot } from "./hub.ts";
import { aggregate, type AggregateResult } from "./aggregate.ts";
import { Bridge } from "./bridge.ts";
import type { Link } from "./link.ts";
import { SerialLink } from "./serial-link.ts";
import { RealClock } from "./clock.ts";
import { Poller, Reconnector } from "./retry.ts";
import { StatusServer } from "./status-server.ts";
import { DecisionStore } from "./dedupe.ts";
import { DecideClient } from "./decide.ts";
import { DraftClient } from "./draft.ts";
import { Interaction } from "./interaction.ts";
import { utcOffsetMin } from "./tz.ts";
import { WebServer, webDecidable, type WebSessionItem, type WebSnapshotFrame } from "./web-server.ts";
import { aliasFor } from "./focus.ts";
import { tileTitle, tileActivity, needsFor } from "./tile-text.ts";
import { sanitizeText } from "./sanitize.ts";
import { VOICE_PHRASES, buildPhrase, voiceDaySeed, type NyxVoiceState } from "./voice.ts";
import { isCueCurrent, type CueRef } from "./voice_gate.ts";
import { VoiceService, fetchKokoroWav, ghostProcess, DEFAULT_TTS_OPTIONS } from "./tts.ts";
import { spawn } from "node:child_process";

export interface MainOptions {
  configPath: string;
  /** Übersprungener Serial-Teil (Sim/Betrieb ohne Board). */
  linkOverride?: Link;
}

export async function startCompanion(opts: MainOptions): Promise<{
  stop: () => Promise<void>;
  metrics: Metrics;
  bridge: Bridge;
}> {
  const config = loadConfig(opts.configPath);
  const token = readToken(config.hub.tokenFile);
  const log = new Logger();
  const metrics = new Metrics();
  const clock = new RealClock();

  // --- Link (Serial mit Reconnect; W5/W6) -------------------------------
  const link: Link = opts.linkOverride ?? new SerialLink({
    path: config.serial.path,
    baud: config.serial.baud,
    log: (msg, fields) => log.info(msg, fields),
  });

  // --- Decide-Pfad (EPIC-P3): display-Token optional, sonst read-only -----
  const decideTokenFile = (config.hub as { decideTokenFile?: string }).decideTokenFile;
  const decideToken = decideTokenFile !== undefined ? readToken(decideTokenFile) : null;
  const decideClient =
    decideToken !== null
      ? new DecideClient({
          baseUrl: config.hub.url,
          token: decideToken,
          store: new DecisionStore(),
          log,
        })
      : null;
  // Voice → Composer (AncientVoid ADR-0069): gleiches Display-Token wie decide.
  const draftClient =
    decideToken !== null
      ? new DraftClient({
          baseUrl: config.hub.url,
          token: decideToken,
          log,
        })
      : null;
  if (decideClient === null) log.info("companion:read_only", { reason: "hub.decideTokenFile fehlt" });

  // --- Bridge ------------------------------------------------------------
  let latestAggregate: AggregateResult | null = null;
  // Interaktion (ADR-0009): wird unten an die Bridge gebunden; der Handler läuft erst nach dem Start.
  let interaction: Interaction | null = null;
  const bridge = new Bridge({
    link,
    clock,
    getAggregate: () => latestAggregate,
    getHubState: () => metrics.hub_state,
    utcOffsetMin: (ts) => utcOffsetMin(new Date(ts)),
    onHello: (fw) => {
      metrics.last_hello_ts = new Date().toISOString();
      log.info("link:hello", { fw });
    },
    onSend: () => {
      metrics.frames_tx += 1;
    },
    onDeviceFrame: async (frame) => {
      // Firmware-Frames übernehmen: log → JSONL (component firmware),
      // stats → Metrics/Schwellen (observability.md §3/§4).
      if (frame.type === "log") {
        const level = frame.level === "error" ? "error" : frame.level === "warn" ? "warn" : "info";
        log[level]("firmware:" + frame.msg, { component: "firmware" });
      } else if (frame.type === "action_response" && decideClient !== null) {
        // W9: decidable aus dem zuletzt projizierten Approval; unbekannt = nie
        // entscheiden (konservativ). Kein Auto-Decline (ADR-0004).
        const current = latestAggregate?.approval;
        const known =
          current !== null && current !== undefined && current.action_id === frame.action_id
            ? current.decidable
            : false;
        const out = await decideClient.decide(frame.action_id, frame.decision, known);
        const status: "approved" | "rejected" | "timed_out" | "stale" | "error" =
          out.kind === "decided" && (out.hub_status === "approved" || out.hub_status === "rejected")
            ? out.hub_status
            : out.kind === "conflict" && (out.hub_status === "approved" || out.hub_status === "rejected" || out.hub_status === "timed_out")
              ? out.hub_status
              : out.kind === "rejected_by_policy"
                ? "stale"
                : "error";
        bridge.sendActionResult(frame.action_id, status);
        if (out.kind === "decided" || out.kind === "conflict") {
          metrics.decisions_sent += 1;
          log.info("action:result", { action_id: frame.action_id.slice(0, 8) + "…", status });
        } else if (out.kind === "already_decided") {
          metrics.decisions_deduped += 1;
        }
      } else if (frame.type === "ui_action") {
        // Eigener Pfad ohne DecideClient (W9): ui_action trägt keine Entscheidung und löst keine aus.
        interaction?.onUiAction({ action: frame.action, ref: frame.ref }, Date.now());
      } else if (frame.type === "stats") {
        for (const w of checkStats(frame)) log[w.level](w.msg, w.fields);
      }
    },
    log: (msg, fields) => log.warn(msg, fields),
  });

  // --- Hub-Poll mit Backoff; ab 2 Folgehfehlern gilt der Hub als down ----
  interaction = new Interaction(
    {
      setFocus: (v) => bridge.setFocus(v),
      showBubble: (b) => bridge.showBubble(b),
      ackBubble: (id) => bridge.ackBubble(id),
      hasCriticalBubble: () => bridge.hasCriticalBubble(),
      setReport: (r) => bridge.onNotification(r.sessionId, "info", { title: r.title, body: r.body }),
    },
    { focusHoldS: config.ui.focusHoldS, tapHoldS: 8, staleAfterS: 30, chatter: config.ui.chatter },
    Math.random,
    Date.now(),
  );
  let lastHub: HubSnapshot | null = null;
  const hub = new HubClient({ baseUrl: config.hub.url, token });
  // --- Web-Frontend (EPIC-P10 T10.3, opt-in): WS-Export + Decide-Proxy ----
  let webServer: WebServer | null = null;
  // EPIC-P11 T11.5: Sprach-Hook (applyHubSnapshot läuft vor der Web-Setup-Zuweisung).
  const speakHookRef: { current: ((state: string, event: "state_change" | "attention") => void) | null } = { current: null };
  let lastApprovalIdForVoice: string | null = null;
  // Letzte Assistant-Nachricht je Session (T10.1): nur bei neuer Hub-Sequenz abholen.
  const webMessages = new Map<string, string>();
  let webFetchInFlight = 0;
  const WEB_FETCH_CAP = 3; // schonend: höchstens 3 Events-Abrufe je Poll parallel
  const refreshWebMessages = async (snap: HubSnapshot): Promise<void> => {
    if (webServer === null) return;
    const jobs: Array<{ id: string; seq: number }> = [];
    for (const s of snap.sessions) {
      if (s.id === undefined || s.lastSeq === undefined || s.archived === true) continue;
      if (fetchedSeq.get(s.id) === s.lastSeq) continue;
      jobs.push({ id: s.id, seq: s.lastSeq });
    }
    for (const j of jobs.slice(0, Math.max(0, WEB_FETCH_CAP - webFetchInFlight))) {
      webFetchInFlight += 1;
      void hub
        .lastAssistantMessage(j.id, j.seq)
        .then((text) => {
          fetchedSeq.set(j.id, j.seq);
          if (text !== null) webMessages.set(j.id, text);
        })
        .catch((err: unknown) => {
          log.warn("web:last_message_error", { error: String(err).slice(0, 120) });
        })
        .finally(() => {
          webFetchInFlight -= 1;
        });
    }
  };
  if (config.web.enabled) {
    // --- Nyx-Stimme (EPIC-P11 T11.5, opt-in über config.voice) -----------
    const voiceStates: ReadonlySet<string> = new Set(VOICE_PHRASES ? (Object.keys(VOICE_PHRASES) as NyxVoiceState[]) : []);
    let voiceEnabled = false;
    let voice: VoiceService | null = null;
    if (config.voice.enabled) {
      voice = new VoiceService(
        {
          url: config.voice.url,
          speed: config.voice.speed,
          pitchSemitones: config.voice.pitchSemitones,
          tempo: config.voice.tempo,
          timeoutMs: config.voice.timeoutMs,
        },
        {
          fetchWav: (text, speed) => fetchKokoroWav(config.voice.url, text, speed, config.voice.timeoutMs, fetch, config.voice.lang),
          ghost: (wav) => {
            const o = voice?.options ?? DEFAULT_TTS_OPTIONS;
            if (o.pitchSemitones === 0 && o.tempo === 1) return Promise.resolve(wav); // Qwen3 pur (T11.14)
            return ghostProcess(wav, o, { spawnFn: spawn });
          },
        },
      );
      voiceEnabled = true;
    }
    let lastSpokenState: string | null = null;
    let voiceCounter = 0;
    const maybeSpeak = (state: string, event: "state_change" | "attention"): void => {
      if (!voiceEnabled || voice === null) return;
      if (event === "state_change" && !config.voice.onEvents.includes("state_change")) return;
      if (event === "attention" && !config.voice.onEvents.includes("attention")) return;
      if (event === "state_change") {
        if (state === lastSpokenState) return; // kein Re-Speak bei gleichem State
        lastSpokenState = state;
      }
      if (!voiceStates.has(state)) return;
      const now = Date.now();
      const id = `v${String(now)}-${String(voiceCounter)}`;
      // T11.12: klare Ansage mit Kontext statt reiner Poesie
        const focus = lastHub?.sessions?.filter((s) => s.archived !== true).sort((a, b) => Date.parse(b.updatedAt ?? "") - Date.parse(a.updatedAt ?? ""))[0];
        const sessionName = state === "listening" && focus?.id !== undefined && (focus.status === "working" || focus.status === "starting")
          ? aliasFor(focus, focus.id.slice(0, 8)) : null;
        const detail = null; // Approval IDs and event text are not speech content.
        const phrase = buildPhrase(state as NyxVoiceState, { session: sessionName, detail }, voiceDaySeed(now), voiceCounter);
      voiceCounter += 1;
      // BUG-0012: Referenz beim Start merken — nach ~10 s Synthese nur noch
      // broadcasten, wenn Zustand/Approval noch aktuell ist (kein Stale-Cue).
      const cueRef: CueRef = event === "attention"
        ? { event, state, ...(latestAggregate?.approval ? { approvalId: latestAggregate.approval.action_id } : {}) }
        : { event, state };
      void voice
        .speak(id, state, phrase)
        .then(() => {
          const now = {
            state: latestAggregate?.state ?? "",
            approvalId: latestAggregate?.approval?.action_id ?? null,
          };
          if (!isCueCurrent(cueRef, now)) {
            log.info("voice:skipped_stale", { id, state });
            return;
          }
          webServer?.broadcastVoice({ id, state, phrase, error: false });
          log.info("voice:cue", { id, state });
        })
        .catch((err: unknown) => {
          // Fail loud (Premortem, Epic §4): Fehler broadcasten + loggen, nie still
          webServer?.broadcastVoice({ id, state, phrase, error: true });
          log.error("voice:tts_error", { error: String(err).slice(0, 160) });
        });
    };
    const webDecideTokenFile = config.web.decideTokenFile;
    const webDecide = decideClient
      ? (actionId: string, decision: "approve" | "decline") => {
        // W9 wie im Serial-Pfad: webDecidable prüft action_id + decidable-Flag
        // gegen das zuletzt projizierte Approval; unbekannt = nie entscheiden.
        const known = webDecidable(latestAggregate?.approval, actionId);
        return decideClient.decide(actionId, decision, known);
      }
      : null;
    if (webDecideTokenFile !== undefined && webDecide === null) {
      log.warn("web:decide_ignored", { reason: "hub.decideTokenFile fehlt — Web-Client read-only" });
    }
    let webSeq = 0;
    let lastWebKey = "";
    const getWebState = (): { seq: number; frame: Omit<WebSnapshotFrame, "type" | "seq"> } | null => {
      const snap = lastHub;
      const agg = latestAggregate;
      if (snap === null || agg === null) return null;
      const sessionList: WebSessionItem[] = snap.sessions
        .filter((s) => s.archived !== true)
        .map((s) => {
          const ref = (s.id ?? s.status).slice(0, 8);
          const name = s.id !== undefined ? aliasFor(s, ref) : "Agent";
          const raw = s.id !== undefined ? webMessages.get(s.id) : undefined;
          const msg = raw === undefined ? null : sanitizeText(raw.replace(/[*#`_>]+/g, " "), 160);
          // T13.3: Titel/Aktivität/Bedarf additiv — nur Anzeige (ADR-0012 Punkt 9)
          const title = tileTitle(s.title);
          const activity = tileActivity(s.lastActivityType, s.lastActivityText);
          const needs = needsFor(snap.pendingApprovals, s.id);
          return {
            id: s.id ?? "",
            name,
            status: s.status,
            updatedAt: s.updatedAt ?? new Date().toISOString(),
            lastActivityAt: s.lastActivityAt ?? null,
            lastAssistantMessage: msg,
            attention: snap.pendingApprovals.some((a) => a.sessionId === s.id),
            ...(title === null ? {} : { title }),
            ...(activity === null ? {} : { activity }),
            ...(needs === undefined ? {} : { needs }),
          };
        });
      // T13.5/P10-Retro: ui-Hinweise additiv — nur Felder, die der Nutzer explizit gewählt hat
      const uiHints: { approveGesture?: "tap" | "hold"; idleTicker?: boolean } = {
        ...(config.ui.approveGesture === undefined ? {} : { approveGesture: config.ui.approveGesture }),
        ...(config.web.idleTickerEnabled ? {} : { idleTicker: false }),
      };
      const key = JSON.stringify([sessionList, agg.state, agg.approval, agg.sessions, metrics.hub_state, uiHints]);
      if (key !== lastWebKey) webSeq += 1; // Inhalt geändert → neuer seq
      lastWebKey = key;
      return {
        seq: webSeq,
        frame: {
          ts: new Date().toISOString(),
          state: agg.state,
          sessions: agg.sessions,
          sessionList,
          approval: agg.approval,
          hub: metrics.hub_state,
          ...(Object.keys(uiHints).length === 0 ? {} : { ui: uiHints }),
        },
      };
    };
    webServer = new WebServer({
      host: config.web.host,
      port: config.web.port,
      optInAllInterfaces: config.web.optInAllInterfaces,
      heartbeatMs: config.heartbeat.intervalMs,
      ...(config.web.staticDir === undefined ? {} : { staticDir: config.web.staticDir }),
      setLang: (lang) => { config.voice.lang = lang; log.info("voice:lang", { lang }); },
        sayText: voice === null
          ? undefined
          : async (text: string, lang?: string) => {
              const useLang = lang ?? config.voice.lang;
              const wav = await fetchKokoroWav(config.voice.url, text, config.voice.speed, config.voice.timeoutMs, fetch, useLang);
              if (config.voice.pitchSemitones === 0 && config.voice.tempo === 1) return wav; // Qwen3 pur (T11.14)
              const opts = { url: config.voice.url, speed: config.voice.speed, pitchSemitones: config.voice.pitchSemitones, tempo: config.voice.tempo, timeoutMs: config.voice.timeoutMs };
              return ghostProcess(wav, opts, { spawnFn: spawn });
            },
        getVoiceCue:
        voice === null
          ? null
          : (id) => {
              const cue = voice?.get(id) ?? null;
              return cue !== null && cue.wav !== null ? { wav: cue.wav, state: cue.state } : null;
            },
      log,
      getWebState,
      decide: webDecide,
      putDraft:
        draftClient === null
          ? null
          : (sessionId, text) => draftClient.putText(sessionId, text),
    });
    // T11.5: Sprach-Trigger — State-Wechsel des Aggregats + neue Approval.
    speakHookRef.current = (state, event) => maybeSpeak(state, event);
  }
  let hubConsecutiveErrors = 0;
  // Hub-Notification-IDs sind DB-Autoinkrement (global monoton, T1.1 belegt).
  // Nach Companion-Restart startet die ID bei 0: die letzten ≤10 Einträge kommen
  // erneut in den Ticker (sichtbare Duplikate statt stiller Verlust, bewusst).
  let lastNotificationId = 0;
  // Letzte Nachricht der fokussierten Session (ADR-0010): nur bei neuer Hub-Sequenz, höchstens ein Abruf zugleich.
  const fetchedSeq = new Map<string, number>();
  let fetching = false;
  let reportShown = false;
  const refreshLastMessage = async (snap: HubSnapshot): Promise<void> => {
    const id = interaction?.focusedSessionId() ?? null;
    if (id === null || fetching) return;
    const seq = snap.sessions.find((s) => s.id === id)?.lastSeq;
    if (seq === undefined || fetchedSeq.get(id) === seq) return;
    fetching = true;
    try {
      const text = await hub.lastAssistantMessage(id, seq);
      fetchedSeq.set(id, seq);
      if (text !== null) {
        reportShown = true;
        interaction?.setLastMessage(id, text);
      }
    } catch (err) {
      log.warn("hub:last_message_error", { error: (err as Error).message.slice(0, 120) });
    } finally {
      fetching = false;
    }
  };
  const applyHubSnapshot = (snap: HubSnapshot): void => {
    const prevState = latestAggregate?.state ?? null;
    latestAggregate = aggregate({
      sessions: snap.sessions,
      approvals: snap.pendingApprovals,
      now: new Date().toISOString(),
      hubUp: true,
    });
    if (latestAggregate.unknownStatuses.length > 0) {
      log.error("hub:unknown_status", { statuses: latestAggregate.unknownStatuses.join(",") });
    }
    bridge.onAggregate(latestAggregate);
    lastHub = snap;
    // EPIC-P11 T11.5: Nyx spricht bei State-Wechsel; neue Approval = Attention.
    if (prevState !== null && prevState !== latestAggregate.state) {
      speakHookRef.current?.(latestAggregate.state, "state_change");
    }
    const newApproval = latestAggregate.approval;
    if (newApproval !== null && newApproval.action_id !== lastApprovalIdForVoice) {
      lastApprovalIdForVoice = newApproval.action_id;
      speakHookRef.current?.("approval_pending", "attention");
    }
    // Web-Export (EPIC-P10 T10.3): neue Nachrichten nachladen, dann diff senden.
    void refreshWebMessages(snap);
    webServer?.onState();
    // Nach dem snapshot: der Fokusframe folgt auf die Freigabe (K7-Reihenfolge wie bei hello).
    interaction?.onHub(
      { sessions: snap.sessions, approvals: snap.pendingApprovals, agg: latestAggregate, hubUp: true },
      Date.now(),
    );
    void refreshLastMessage(snap);
    for (const n of snap.notifications) {
      if (n.id > lastNotificationId) {
        lastNotificationId = n.id;
        // Die letzte Agent-Nachricht bleibt im Tickerband (ADR-0010): Routine-Meldungen verdrängen sie nicht.
        if (reportShown && (n.level === "info" || n.level === "success")) continue;
        bridge.onNotification(n.sessionId, mapLevel(n.level), { title: n.title, body: n.detail ?? "" });
      }
    }
  };

  const poller = new Poller<HubSnapshot>(
    async () => {
      metrics.hub_polls += 1;
      const snap = await hub.snapshot();
      hubConsecutiveErrors = 0;
      if (metrics.hub_state === "down") {
        log.info("hub:reachable_again");
        metrics.hub_state = "up";
      }
      applyHubSnapshot(snap);
      return snap;
    },
    clock,
    config.poll.intervalMs,
    {
      onError: (err) => {
        metrics.hub_errors += 1;
        hubConsecutiveErrors += 1;
        if (hubConsecutiveErrors >= 2 && metrics.hub_state !== "down") {
          metrics.hub_state = "down";
          log.warn("hub:unreachable", { consecutive: hubConsecutiveErrors });
          const fallback = latestAggregate;
          if (fallback !== null) {
            latestAggregate = { ...fallback, state: "offline" };
            bridge.onAggregate(latestAggregate);
            if (lastHub !== null) {
              interaction?.onHub(
                { sessions: lastHub.sessions, approvals: lastHub.pendingApprovals, agg: latestAggregate, hubUp: false },
                Date.now(),
              );
            }
          }
        }
        log.warn("hub:error", { error: err.message.slice(0, 120) });
      },
    },
  );

  // --- Serial-Reconnect ---------------------------------------------------
  let reconnector: Reconnector | null = null;
  if (opts.linkOverride === undefined) {
    reconnector = new Reconnector(
      async () => {
        await (link as SerialLink).open();
        return {
          close: () => (link as SerialLink).close().catch(() => {}),
          onClose: (cb) => link.onClose(cb),
        };
      },
      clock,
      {
        onState: (state) => {
          metrics.link_state = state === "connected" ? "connected" : state === "stopped" ? "stopped" : "reconnecting";
          if (state === "connected") log.info("link:open");
          else if (state === "reconnecting") {
            const r = metrics.noteReconnect();
            log.warn("link:reconnecting", { in_window: r.inWindow, warn: r.warn });
          }
        },
      },
    );
    reconnector.start();
  } else {
    await link.open();
    metrics.link_state = "connected";
  }

  bridge.start();
  poller.start();
  if (webServer !== null) await webServer.start();

  // Idle-Chatter-Takt (ADR-0009); die Entscheidung trifft Interaction.tick, hier nur der Takt.
  let chatterHandle: unknown = null;
  const chatterLoop = (): void => {
    interaction?.tick(Date.now());
    chatterHandle = clock.after(5000, chatterLoop);
  };
  chatterHandle = clock.after(5000, chatterLoop);

  // --- Status-Socket ------------------------------------------------------
  const status = new StatusServer({
    socketPath: process.env["VOIDWARDEN_SOCK"] ?? join(process.cwd(), "data", "voidwarden.sock"),
    getSnapshot: () => ({
      ...metrics.snapshot(),
      frames_rx: bridge.counters.rx,
      parse_err: bridge.counters.parse_err,
      frames_dropped: bridge.counters.dropped,
      bridge: bridge.counters,
    }),
  });
  await status.start();

  log.info("companion:started", { hub: config.hub.url, serial: config.serial.path });

  return {
    metrics,
    bridge,
    stop: async () => {
      if (chatterHandle !== null) clock.cancel(chatterHandle);
      await poller.stop();
      reconnector?.stop();
      await webServer?.stop();
      await status.stop();
      bridge.stop();
      await link.close();
      log.info("companion:stopped");
    },
  };
}

function mapLevel(level: string): "info" | "success" | "warning" | "error" {
  if (level === "success" || level === "warning" || level === "error") return level;
  return "info";
}
