/**
 * Web-Server-Modul (EPIC-P10 T10.3, ADR-0011): opt-in WebSocket-Export des
 * Companion-Zustands für die PWA plus statische Auslieferung von web/dist.
 * Der Browser bekommt nie ein Hub-Token: Der Datenstrom liest vom Companion
 * mit dem read-only Agent-Token (P1-Muster), Decide-Aufrufe proxied der Server
 * mit dem display:web-1-Token (P3-Muster, Ergebnis T10.1).
 *
 * Frames (JSON, ein Objekt pro WS-Text-Message): hello-frei — nach dem
 * Upgrade sofort snapshot, danach state_change bei jedem neuen Poll-Seq,
 * heartbeat analog P1. Kein Link-Protokoll: kein v-Feld, K5 gilt nicht
 * (ADR-0011 §2). Fixtures: protocol/fixtures/ws/ (check:protocol).
 */
import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { existsSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { readFileSync } from "node:fs";
import type { AggregateResult, PendingApproval, SessionSummary } from "./aggregate.ts";
import type { DecideOutcome } from "./decide.ts";
import type { DraftOutcome } from "./draft.ts";
import type { Logger } from "./log.ts";

export interface WebSessionItem {
  id: string;
  name: string;
  status: string;
  /** ISO-8601 UTC des letzten Events (SessionRecord.updatedAt). */
  updatedAt: string;
  /** ISO-8601 UTC aus lastActivity.at, wenn vorhanden. */
  lastActivityAt: string | null;
  /** Letzte Assistant-Nachricht (Companion-Aggregation, T10.1); null = noch keine geholt. */
  lastAssistantMessage: string | null;
  /** true, wenn eine wartende Freigabe diese Session betrifft. */
  attention: boolean;
  /** EPIC-P13 T13.3 (ADR-0012 Punkt 9): Session-Titel jeder titleSource,
   * bereinigt ≤ 40; weggelassen wenn leer/fehlend (Client zeigt `name`). */
  title?: string;
  /** EPIC-P13 T13.3: Aktivitätszeile aus lastActivity (Vorlage, ≤ 40, nur Anzeige). */
  activity?: string;
  /** EPIC-P13 T13.3: "approval" | "question", wenn eine wartende Freigabe diese
   * Session betrifft; bei mehreren gewinnt "approval". */
  needs?: "approval" | "question";
}

export interface WebSnapshotFrame {
  type: "snapshot";
  seq: number;
  ts: string;
  state: AggregateResult["state"];
  sessions: SessionSummary;
  sessionList: WebSessionItem[];
  approval: PendingApproval | null;
  hub: "up" | "down";
  /** T13.5/P10-Retro: UI-Vorgaben aus der Config — additiv, nur gesetzt, wenn die Schlüssel stehen. */
  ui?: { approveGesture?: "tap" | "hold"; idleTicker?: boolean };
}

export interface WebStateChangeFrame {
  type: "state_change";
  seq: number;
  ts: string;
  state: AggregateResult["state"];
  sessions?: SessionSummary;
  approval?: PendingApproval | null;
  hub?: "up" | "down";
  /** Vollständige Session-Liste, wenn sie sich geändert hat. */
  sessionList?: WebSessionItem[];
}

export interface WebHeartbeatFrame {
  type: "heartbeat";
  ts: string;
}

/** Antwort des Decide-Proxys an den sendenden Client (nur dieser, kein Broadcast). */
export interface WebDecideResultFrame {
  type: "decide_result";
  ts: string;
  action_id: string;
  outcome: "decided" | "conflict" | "rejected_by_policy" | "not_decidable" | "already_decided" | "error";
  hub_status: string | null;
}

/**
 * Nyx-Stimme (EPIC-P11 T11.5): Audio-Cue-Ankündigung. Die PWA lädt das WAV
 * danach vom HTTP-Endpoint /voice/<id> (gleicher Origin wie die PWA — kein
 * Token, kein Cloud-Dienst, W9). error=true = Synthese fehlgeschlagen →
 * sichtbarer Fehler statt stillem Ausfall (fail loud).
 */
export interface WebVoiceFrame {
  type: "voice";
  ts: string;
  id: string;
  state: string;
  phrase: string;
  error: boolean;
}

/** Voice → Session-Entwurf (AncientVoid ADR-0069); nie ein Steer. */
export interface WebDraftResultFrame {
  type: "draft_result";
  ts: string;
  session_id: string;
  outcome: "saved" | "conflict" | "not_available" | "error";
  revision: number | null;
}

export type WebServerFrame =
  | WebSnapshotFrame
  | WebStateChangeFrame
  | WebHeartbeatFrame
  | WebDecideResultFrame
  | WebVoiceFrame
  | WebDraftResultFrame;

/**
 * W9 (T10.6): Der Web-Decide-Proxy entscheidet nur, wenn die action_id der
 * zuletzt projizierten Approval entspricht UND diese decidable ist
 * (destructive/reasonRequired/question → false, ADR-0001/ADR-0048).
 * Unbekannte IDs werden konservativ abgelehnt — nie raten.
 */
export function webDecidable(current: PendingApproval | null | undefined, actionId: string): boolean {
  return current?.action_id === actionId ? current.decidable : false;
}

export interface WebServerOptions {
  host: string;
  port: number;
  optInAllInterfaces: boolean;
  heartbeatMs: number;
  /** Liefert den aktuellen Zustand (seq = Zähler des Companion-Polls). */
  getWebState: () => { seq: number; frame: Omit<WebSnapshotFrame, "type" | "seq"> } | null;
  /** Decide-Proxy (EPIC-P10 T10.6); null = Web-Client read-only. */
  decide: ((actionId: string, decision: "approve" | "decline") => Promise<DecideOutcome>) | null;
  /** Voice → Hub-Composer (ADR-0069); null = kein Entwurf vom Kiosk. */
  putDraft?: ((sessionId: string, text: string) => Promise<DraftOutcome>) | null;
  staticDir?: string;
  /** EPIC-P11 T11.5: WAV-Cue-Auslieferung für /voice/:id; undefined/null = Endpoint 404. */
  /** T11.12: /say — beliebigen Text via TTS-Kette sprechen; undefined = Endpoint deaktiviert. */
  sayText?: ((text: string, lang?: string) => Promise<Uint8Array>) | undefined;
  /** T11.14: Sprache global umschalten (DE/EN). */
  setLang?: (lang: "de" | "en") => void;
  getVoiceCue?: ((id: string) => { wav: Uint8Array; state: string } | null) | null;
  log: Logger;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
  ".ico": "image/x-icon",
};

interface ClientEntry {
  socket: Socket;
  send: (frame: WebServerFrame) => void;
}

/** Sec-WebSocket-Accept (RFC 6455 §4.2.2) — nur Handshake, kein Sicherheitszweck. */
export function wsAccept(key: string): string {
  return createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
}

/** Server→Client-Text-Frame (unmasked, RFC 6455 §5.2). */
export function encodeWsText(payload: string): Buffer {
  const len = Buffer.byteLength(payload);
  let header: Buffer;
  if (len < 126) {
    header = Buffer.alloc(2);
    header.writeUInt8(0x81, 0);
    header.writeUInt8(len, 1);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header.writeUInt8(0x81, 0);
    header.writeUInt8(126, 1);
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header.writeUInt8(0x81, 0);
    header.writeUInt8(127, 1);
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, Buffer.from(payload, "utf8")]);
}

export class WebServer {
  private httpServer: Server | null = null;
  private sockets = new Set<ClientEntry>();
  private heartbeatHandle: ReturnType<typeof setInterval> | null = null;
  private readonly opts: WebServerOptions;
  private lastSentSeq = -1;

  constructor(opts: WebServerOptions) {
    this.opts = opts;
    if (opts.host === "0.0.0.0" && !opts.optInAllInterfaces) {
      throw new Error("web: host 0.0.0.0 erfordert optInAllInterfaces=true (ADR-0011 §4)");
    }
  }

  async start(): Promise<void> {
    const server = createServer((req, res) => this.handleHttp(req, res));
    server.on("upgrade", (req, socket) => this.handleUpgrade(req, socket as Socket));
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(this.opts.port, this.opts.host, () => {
        server.removeListener("error", reject);
        resolve();
      });
    });
    this.httpServer = server;
    this.heartbeatHandle = setInterval(() => {
      const frame: WebHeartbeatFrame = { type: "heartbeat", ts: new Date().toISOString() };
      for (const s of this.sockets) s.send(frame);
    }, this.opts.heartbeatMs);
    // Alleiniger Heartbeat-Timer darf den Prozess nicht am Leben halten (Tests, CLI).
    this.heartbeatHandle.unref?.();
    this.opts.log.info("web:listening", { host: this.opts.host, port: this.opts.port });
  }

  async stop(): Promise<void> {
    if (this.heartbeatHandle !== null) clearInterval(this.heartbeatHandle);
    this.heartbeatHandle = null;
    for (const s of this.sockets) s.socket.destroy();
    this.sockets.clear();
    const server = this.httpServer;
    if (server === null) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    this.httpServer = null;
  }

  get clientCount(): number {
    return this.sockets.size;
  }

  /** Vom Companion nach jedem Hub-Poll aufgerufen: neuer seq → Broadcast. */
  onState(): void {
    const current = this.opts.getWebState();
    if (current === null) return;
    if (current.seq === this.lastSentSeq) return;
    const first = this.lastSentSeq < 0;
    this.lastSentSeq = current.seq;
    const frame: WebServerFrame = first
      ? { type: "snapshot", seq: current.seq, ...current.frame }
      : { type: "state_change", seq: current.seq, ...current.frame };
    for (const s of this.sockets) s.send(frame);
  }

  /** EPIC-P11 T11.5: Voice-Cue an alle Clients broadcasten (nach Synthese). */
  broadcastVoice(frame: Omit<WebVoiceFrame, "type" | "ts">): void {
    const full: WebVoiceFrame = { type: "voice", ts: new Date().toISOString(), ...frame };
    for (const s of this.sockets) s.send(full);
  }

  private sendFrame(socket: Socket, frame: WebServerFrame): void {
    socket.write(encodeWsText(JSON.stringify(frame)));
  }

  private handleUpgrade(req: IncomingMessage, socket: Socket): void {
    const key = req.headers["sec-websocket-key"];
    if (typeof key !== "string") {
      socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
      socket.destroy();
      return;
    }
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n" +
        `Sec-WebSocket-Accept: ${wsAccept(key)}\r\n\r\n`,
    );
    socket.setTimeout(this.opts.heartbeatMs * 3);
    const entry: ClientEntry = {
      socket,
      send: (frame) => {
        if (!socket.destroyed && socket.writable) this.sendFrame(socket, frame);
      },
    };
    this.sockets.add(entry);
    const current = this.opts.getWebState();
    if (current !== null) {
      this.lastSentSeq = Math.max(this.lastSentSeq, current.seq);
      entry.send({ type: "snapshot", seq: current.seq, ...current.frame });
    }
    let buffer: Uint8Array = Buffer.alloc(0);
    socket.on("data", (chunk: Buffer) => {
      buffer = this.handleClientData(entry, Buffer.concat([buffer as Buffer, chunk]));
    });
    const remove = () => {
      this.sockets.delete(entry);
      this.opts.log.info("web:ws_closed", { clients: this.sockets.size });
    };
    socket.on("close", remove);
    socket.on("error", remove);
    this.opts.log.info("web:ws_open", { clients: this.sockets.size });
  }

  /** Minimaler WS-Client-Frame-Reader: Text (Decide), close (0x8), ping (0x9 → pong).
   * Verarbeitet so viele komplette Frames wie im Buffer sind, Rest bleibt zurück. */
  private handleClientData(entry: ClientEntry, chunk: Buffer): Buffer {
    let offset = 0;
    while (offset + 2 <= chunk.length) {
      const b0 = chunk[offset] ?? 0;
      const b1 = chunk[offset + 1] ?? 0;
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let headerLen = 2;
      if (len === 126) {
        if (offset + 4 > chunk.length) return chunk.subarray(offset);
        len = chunk.readUInt16BE(offset + 2);
        headerLen = 4;
      } else if (len === 127) {
        if (offset + 10 > chunk.length) return chunk.subarray(offset);
        len = Number(chunk.readBigUInt64BE(offset + 2));
        headerLen = 10;
      }
      const maskLen = masked ? 4 : 0;
      if (offset + headerLen + maskLen + len > chunk.length) return chunk.subarray(offset);
      const maskKey = chunk.subarray(offset + headerLen, offset + headerLen + maskLen);
      const payload = chunk.subarray(offset + headerLen + maskLen, offset + headerLen + maskLen + len);
      if (masked) {
        for (let i = 0; i < payload.length; i++) {
          payload[i] = payload[i]! ^ (maskKey[i % 4] ?? 0);
        }
      }
      if (opcode === 0x8) {
        // close: Opcode-Antwort senden und Verbindung beenden (RFC 6455 §5.5.1)
        entry.socket.end(Buffer.from([0x88, 0x00]));
        return Buffer.alloc(0);
      }
      if (opcode === 0x9) {
        // ping → pong mit gleichem Payload
        const pong = Buffer.alloc(2 + payload.length);
        pong.writeUInt8(0x8a, 0);
        pong.writeUInt8(payload.length, 1);
        payload.copy(pong, 2);
        entry.socket.write(pong);
      } else if (opcode === 0x1) {
        this.handleClientMessage(entry, payload.toString("utf8"));
      }
      offset += headerLen + maskLen + len;
    }
    return chunk.subarray(offset);
  }

  private handleClientMessage(entry: ClientEntry, text: string): void {
    let msg: unknown;
    try {
      msg = JSON.parse(text);
    } catch {
      this.opts.log.warn("web:ws_bad_message", {});
      return;
    }
    const m = msg as { type?: string; action_id?: unknown; decision?: unknown; session_id?: unknown; text?: unknown };
    if (m.type === "draft") {
      this.handleDraftMessage(entry, m);
      return;
    }
    if (m.type !== "decide") {
      this.opts.log.warn("web:ws_unknown_type", { type: typeof m.type === "string" ? m.type : "?" });
      return;
    }
    if (typeof m.action_id !== "string" || (m.decision !== "approve" && m.decision !== "decline")) {
      this.opts.log.warn("web:decide_invalid", {});
      return;
    }
    const actionId = m.action_id;
    const decision = m.decision;
    if (this.opts.decide === null) {
      entry.send({ type: "decide_result", ts: new Date().toISOString(), action_id: actionId, outcome: "not_decidable", hub_status: null });
      return;
    }
    void this.opts
      .decide(actionId, decision)
      .then((out: DecideOutcome) => {
        const hubStatus = out.kind === "error" ? null : out.kind === "decided" || out.kind === "conflict" ? out.hub_status : null;
        entry.send({
          type: "decide_result",
          ts: new Date().toISOString(),
          action_id: actionId,
          outcome: out.kind,
          hub_status: hubStatus,
        });
      })
      .catch((err: unknown) => {
        entry.send({
          type: "decide_result",
          ts: new Date().toISOString(),
          action_id: actionId,
          outcome: "error",
          hub_status: null,
        });
        this.opts.log.warn("web:decide_error", { error: String(err).slice(0, 120) });
      });
  }

  private handleDraftMessage(entry: ClientEntry, m: { session_id?: unknown; text?: unknown }): void {
    if (typeof m.session_id !== "string" || m.session_id.length < 1 || m.session_id.length > 64 || typeof m.text !== "string") {
      this.opts.log.warn("web:draft_invalid", {});
      return;
    }
    const sessionId = m.session_id;
    const put = this.opts.putDraft;
    if (put == null) {
      entry.send({ type: "draft_result", ts: new Date().toISOString(), session_id: sessionId, outcome: "not_available", revision: null });
      return;
    }
    void put(sessionId, m.text)
      .then((out: DraftOutcome) => {
        const revision = out.kind === "saved" || out.kind === "conflict" ? out.revision : null;
        entry.send({
          type: "draft_result",
          ts: new Date().toISOString(),
          session_id: sessionId,
          outcome: out.kind,
          revision,
        });
      })
      .catch((err: unknown) => {
        entry.send({
          type: "draft_result",
          ts: new Date().toISOString(),
          session_id: sessionId,
          outcome: "error",
          revision: null,
        });
        this.opts.log.warn("web:draft_error", { error: String(err).slice(0, 120) });
      });
  }

  private handleHttp(req: IncomingMessage, res: ServerResponse): void {
    // EPIC-P11 T11.5: Audio-Cue-Auslieferung (vor dem Static-Block, kein staticDir nötig).
        // T11.14: /lang — DE/EN umschalten
    const langMatch = /^\/lang$/.exec((req.url ?? "").split("?")[0] ?? "");
    if (req.method === "POST" && langMatch !== null) {
      let lbody = "";
      req.on("data", (c: Buffer) => { lbody += c.toString("utf8"); });
      req.on("end", () => {
        try {
          const lp: { lang?: unknown } = JSON.parse(lbody) as { lang?: unknown };
          if (lp.lang !== "de" && lp.lang !== "en") { res.writeHead(400); res.end("lang must be de|en"); return; }
          const fn = this.opts.setLang;
          if (typeof fn === "function") fn(lp.lang);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, lang: lp.lang }));
        } catch { res.writeHead(400); res.end("bad json"); }
      });
      return;
    }
    // T11.12: /say — Text vorlesen (gleiche TTS-Kette wie Cues, kein Cache)
    const sayMatch = /^\/say$/.exec((req.url ?? "").split("?")[0] ?? "");
    if (req.method === "POST" && sayMatch !== null) {
      const sayFn = this.opts.sayText;
      if (typeof sayFn !== "function") { res.writeHead(501); res.end("say disabled"); return; }
      let body = "";
      req.on("data", (c: Buffer) => { body += c.toString("utf8"); });
      req.on("end", () => {
        try {
          const parsed: { text?: unknown; lang?: unknown } = JSON.parse(body) as { text?: unknown; lang?: unknown };
          const text = typeof parsed.text === "string" ? parsed.text.slice(0, 600) : "";
          const lang = parsed.lang === "en" ? "en" : "de";
          if (text === "") { res.writeHead(400); res.end("text required"); return; }
          sayFn(text, lang)
            .then((wav) => {
              res.writeHead(200, { "Content-Type": "audio/wav", "Content-Length": String(wav.byteLength) });
              res.end(wav);
            })
            .catch((err: unknown) => {
              res.writeHead(502); res.end(`tts error: ${String(err).slice(0, 120)}`);
            });
        } catch { res.writeHead(400); res.end("bad json"); }
      });
      return;
    }
    const voiceMatch = /^\/voice\/([A-Za-z0-9_-]{1,64})$/.exec((req.url ?? "").split("?")[0] ?? "");
    if (req.method === "GET" && voiceMatch !== null) {
      const cue = this.opts.getVoiceCue == null ? null : this.opts.getVoiceCue(voiceMatch[1] ?? "");
      if (cue === null) {
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        res.end("voice cue not found");
        return;
      }
      res.writeHead(200, { "content-type": "audio/wav", "cache-control": "no-store" });
      res.end(Buffer.from(cue.wav));
      return;
    }
    const staticDir = this.opts.staticDir;
    if (staticDir === undefined || (req.method !== "GET" && req.method !== "HEAD")) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("not found");
      return;
    }
    const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0] ?? "/");
    // Path-Traversal-Schutz: normalisiertes Ziel muss unter staticDir bleiben.
    const target = normalize(join(staticDir, urlPath));
    if (!target.startsWith(normalize(staticDir))) {
      res.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
      res.end("forbidden");
      return;
    }
    let file = target;
    if (!existsSync(file) || statSync(file).isDirectory()) {
      // SPA-Fallback: unbekannte Pfade → index.html
      file = join(staticDir, "index.html");
    }
    if (!existsSync(file)) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("not found");
      return;
    }
    const mime = MIME[extname(file)] ?? "application/octet-stream";
    res.writeHead(200, { "content-type": mime, "cache-control": "no-cache" });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    res.end(readFileSync(file));
  }
}
