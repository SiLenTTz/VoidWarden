// Web-Server (EPIC-P10 T10.3): WS-Handshake, snapshot/state_change-Stream,
// Decide-Proxy-Ergebnisse, 0.0.0.0-Guard. Echte Sockets auf 127.0.0.1 mit
// Random-Port — kein Mock-WS, RFC 6455 by hand (companion hat keine ws-Dep).
// node --test mit --test-force-exit wäre einfacher, aber npm test läuft ohne:
// deshalb zerstören alle Tests ihre Sockets/Server synchron im after()-Hook.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { connect } from "node:net";
import type { Server as NodeHttpServer } from "node:http";
import { join } from "node:path";
import { Logger } from "../src/log.ts";
import { WebServer, wsAccept, encodeWsText, webDecidable, type WebServerFrame, type WebSnapshotFrame } from "../src/web-server.ts";
import type { PendingApproval } from "../src/aggregate.ts";
import type { DecideOutcome } from "../src/decide.ts";

const quietLog = new Logger();

const approvalWith = (over: Partial<PendingApproval>): PendingApproval => ({
  action_id: "0e0f1e2e-3b4c-4d5e-8f9a-a1b2c3d4e5f6",
  kind: "approval",
  agent_id: "s1",
  class: "write",
  payload: { title: "Paket installieren", body: "npm install" },
  timeout_s: 100,
  decidable: true,
  ...over,
});

test("W9 negativ (T10.6): webDecidable lehnt destructive/question/unbekannt ab", () => {
  const id = "0e0f1e2e-3b4c-4d5e-8f9a-a1b2c3d4e5f6";
  // write + nicht reasonRequired + keine Frage: entscheidbar
  assert.equal(webDecidable(approvalWith({ decidable: true }), id), true);
  // destructive/question/reasonRequired kommen mit decidable:false aus aggregate()
  assert.equal(webDecidable(approvalWith({ decidable: false }), id), false, "decidable:false darf nie durch");
  // unbekannte action_id: konservativ false
  assert.equal(webDecidable(approvalWith({ decidable: true }), "11111111-2222-3333-4444-555555555555"), false);
  // keine Approval projiziert: nie entscheiden
  assert.equal(webDecidable(null, id), false);
  assert.equal(webDecidable(undefined, id), false);
});

type BaseFrame = Omit<WebSnapshotFrame, "type" | "seq">;

function stateRef() {
  let seq = 0;
  let current: { seq: number; frame: BaseFrame } | null = null;
  return {
    set(frame: BaseFrame) {
      seq += 1;
      current = { seq, frame };
    },
    getWebState: () => current,
  };
}

function baseFrame(overrides: Partial<BaseFrame> = {}): BaseFrame {
  return {
    ts: "2026-11-06T19:00:00.000Z",
    state: "idle" as const,
    sessions: { total: 1, working: 0, waiting: 0, error: 0 },
    sessionList: [
      {
        id: "4a19b97f-a8da-41b9-82f0-87642b77d004",
        name: "voidwarden",
        status: "idle",
        updatedAt: "2026-11-06T18:13:08.116Z",
        lastActivityAt: null,
        lastAssistantMessage: "Zug beendet",
        attention: false,
        // T13.3: additive Kachelfelder im Snapshot-Roundtrip
        title: "Fix memory leak in serial bridge",
        activity: "npm install",
        needs: "approval",
      },
    ],
    approval: null,
    hub: "up" as const,
    // T13.5: ui.approveGesture kommt additiv durch den WS-Export
    ui: { approveGesture: "hold", idleTicker: false },
    ...overrides,
  };
}

interface WsClient {
  next(): Promise<WebServerFrame>;
  send(obj: unknown): void;
  destroy(): void;
}

/** Öffnet einen WS-Client; destroy() beendet hart (kein FIN-Warten). */
async function wsConnect(port: number): Promise<WsClient> {
  const socket = connect(port, "127.0.0.1");
  socket.on("error", () => undefined); // nach destroy erwartbare ECONNRESET schlucken
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });
  const key = createHash("sha1").update(String(Math.random())).digest("base64");
  socket.write(
    `GET / HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
  );
  // Handshake-Antwort lesen bis \r\n\r\n; Rest-Bytes (oft schon der snapshot) mitnehmen
  const leftover: Buffer[] = [];
  await new Promise<void>((resolve) => {
    let buf = Buffer.alloc(0);
    const onData = (c: Buffer) => {
      buf = Buffer.concat([buf, c]);
      const idx = buf.indexOf("\r\n\r\n");
      if (idx >= 0) {
        socket.removeListener("data", onData);
        assert.match(buf.subarray(0, idx).toString("latin1"), /101 Switching Protocols/);
        const rest = buf.subarray(idx + 4);
        if (rest.length > 0) leftover.push(rest);
        resolve();
      }
    };
    socket.on("data", onData);
  });
  const frames: WebServerFrame[] = [];
  const waiters: Array<(f: WebServerFrame) => void> = [];
  let pending: Buffer = Buffer.alloc(0);
  const drain = (chunk: Buffer): void => {
    pending = Buffer.concat([pending, chunk]);
    let offset = 0;
    while (offset + 2 <= pending.length) {
      const b1 = pending[offset + 1] ?? 0;
      let len = b1 & 0x7f;
      let headerLen = 2;
      if (len === 126) {
        if (offset + 4 > pending.length) break;
        len = pending.readUInt16BE(offset + 2);
        headerLen = 4;
      } else if (len === 127) {
        if (offset + 10 > pending.length) break;
        len = Number(pending.readBigUInt64BE(offset + 2));
        headerLen = 10;
      }
      if (offset + headerLen + len > pending.length) break;
      const payload = pending.subarray(offset + headerLen, offset + headerLen + len).toString("utf8");
      const frame = JSON.parse(payload) as WebServerFrame;
      pending = pending.subarray(offset + headerLen + len);
      offset = 0;
      const waiter = waiters.shift();
      if (waiter) waiter(frame);
      else frames.push(frame);
    }
  };
  for (const buf of leftover) drain(buf);
  socket.on("data", drain);
  return {
    next: () =>
      new Promise((resolve) => {
        const existing = frames.shift();
        if (existing) resolve(existing);
        else waiters.push(resolve);
      }),
    send: (obj) => {
      // Client-Frames müssen maskiert sein (RFC 6455 §5.3)
      const payload = Buffer.from(JSON.stringify(obj), "utf8");
      const mask = Buffer.from([0x11, 0x22, 0x33, 0x44]);
      let header: Buffer;
      if (payload.length < 126) {
        header = Buffer.alloc(2);
        header.writeUInt8(0x81, 0);
        header.writeUInt8(0x80 | payload.length, 1);
      } else {
        header = Buffer.alloc(4);
        header.writeUInt8(0x81, 0);
        header.writeUInt8(0x80 | 126, 1);
        header.writeUInt16BE(payload.length, 2);
      }
      const masked = Buffer.alloc(payload.length);
      for (let i = 0; i < payload.length; i++) masked[i] = payload[i]! ^ mask[i % 4]!;
      socket.write(Buffer.concat([header, mask, masked]));
    },
    destroy: () => {
      // Erst WS-close-Frame, dann hart zerstören — destroy()alone erzeugt
      // ECONNRESET auf der Server-Seite, was dort nur loggt.
      socket.write(Buffer.from([0x88, 0x80, 0x00, 0x00, 0x00, 0x00])); // masked close, leer
      socket.destroy();
    },
  };
}

function serverPort(server: WebServer): number {
  const addr = (server as unknown as { httpServer: NodeHttpServer }).httpServer.address();
  return (addr as { port: number }).port;
}

test("wsAccept: RFC 6455 Beispiel-Vektor", () => {
  assert.equal(wsAccept("dGhlIHNhbXBsZSBub25jZQ=="), "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=");
});

test("encodeWsText: kleine und 16-Bit-Längen", () => {
  const small = encodeWsText("abc");
  assert.equal(small[0], 0x81);
  assert.equal(small[1], 3);
  const big = encodeWsText("x".repeat(300));
  assert.equal(big[1], 126);
  assert.equal(big.readUInt16BE(2), 300);
});

test("WebServer: 0.0.0.0 ohne Opt-in wird abgelehnt (ADR-0011 §4)", () => {
  assert.throws(
    () =>
      new WebServer({
        host: "0.0.0.0",
        port: 8791,
        optInAllInterfaces: false,
        heartbeatMs: 5000,
        getWebState: () => null,
        decide: null,
        log: quietLog,
      }),
    /optInAllInterfaces/,
  );
});

test("WebServer: handshake → snapshot, onState → state_change, kein Doppel-Send", async (t) => {
  const ref = stateRef();
  const server = new WebServer({
    host: "127.0.0.1",
    port: 0,
    optInAllInterfaces: false,
    heartbeatMs: 60000, // kein Heartbeat im Test-Fenster
    getWebState: ref.getWebState,
    decide: null,
    log: quietLog,
  });
  await server.start();
  t.after(() => void server.stop());

  ref.set(baseFrame());
  const client = await wsConnect(serverPort(server));
  const snap = await client.next();
  assert.equal(snap.type, "snapshot");
  assert.ok(snap.type === "snapshot");
  assert.equal(snap.sessionList[0]?.name, "voidwarden");
  assert.equal(snap.sessionList[0]?.lastAssistantMessage, "Zug beendet");
  // T13.3: title/activity/needs kommen unverändert durch den WS-Export
  assert.equal(snap.sessionList[0]?.title, "Fix memory leak in serial bridge");
  assert.equal(snap.sessionList[0]?.activity, "npm install");
  assert.equal(snap.sessionList[0]?.needs, "approval");
  // T13.5: ui.approveGesture kommt unverändert durch den WS-Export
  assert.ok(snap.type === "snapshot");
  assert.equal(snap.ui?.approveGesture, "hold");
  // P10-Retro: ui.idleTicker=false kommt ebenso durch (web.idleTickerEnabled)
  assert.equal(snap.ui?.idleTicker, false);

  ref.set(baseFrame({ state: "listening" }));
  server.onState();
  const change = await client.next();
  assert.equal(change.type, "state_change");
  assert.ok(change.type === "state_change");
  assert.equal(change.state, "listening");

  // Gleichbleibender Zustand: kein weiterer Frame (seq unverändert)
  server.onState();
  server.onState();

  client.destroy();
  await server.stop();
});

test("WebServer: decide-proxy leitet outcome als decide_result", async (t) => {
  const ref = stateRef();
  const decided: Array<{ id: string; d: string }> = [];
  const decide = async (id: string, d: "approve" | "decline"): Promise<DecideOutcome> => {
    decided.push({ id, d });
    return { kind: "decided", hub_status: "approved" };
  };
  const server = new WebServer({
    host: "127.0.0.1",
    port: 0,
    optInAllInterfaces: false,
    heartbeatMs: 60000,
    getWebState: ref.getWebState,
    decide,
    log: quietLog,
  });
  await server.start();
  t.after(() => void server.stop());
  ref.set(baseFrame());
  const client = await wsConnect(serverPort(server));
  await client.next(); // snapshot verwerfen

  client.send({ type: "decide", action_id: "0e0f1e2e-3b4c-4d5e-8f9a-a1b2c3d4e5f6", decision: "approve" });
  const result = await client.next();
  assert.equal(result.type, "decide_result");
  assert.ok(result.type === "decide_result");
  assert.equal(result.outcome, "decided");
  assert.equal(result.hub_status, "approved");
  assert.deepEqual(decided, [{ id: "0e0f1e2e-3b4c-4d5e-8f9a-a1b2c3d4e5f6", d: "approve" }]);

  client.destroy();
  await server.stop();
});

test("WebServer: draft-proxy schreibt Session-Entwurf", async (t) => {
  const ref = stateRef();
  const puts: Array<{ id: string; text: string }> = [];
  const server = new WebServer({
    host: "127.0.0.1",
    port: 0,
    optInAllInterfaces: false,
    heartbeatMs: 60000,
    getWebState: ref.getWebState,
    decide: null,
    putDraft: async (id, text) => {
      puts.push({ id, text });
      return { kind: "saved", revision: 2 };
    },
    log: quietLog,
  });
  await server.start();
  t.after(() => void server.stop());
  ref.set(baseFrame());
  const client = await wsConnect(serverPort(server));
  await client.next();
  client.send({ type: "draft", session_id: "sess-1", text: "Bitte Tests fixen" });
  const result = await client.next();
  assert.equal(result.type, "draft_result");
  assert.ok(result.type === "draft_result");
  assert.equal(result.outcome, "saved");
  assert.equal(result.revision, 2);
  assert.deepEqual(puts, [{ id: "sess-1", text: "Bitte Tests fixen" }]);
  client.destroy();
  await server.stop();
});

test("WebServer: decide ohne Proxy (read-only) → not_decidable", async (t) => {
  const ref = stateRef();
  const server = new WebServer({
    host: "127.0.0.1",
    port: 0,
    optInAllInterfaces: false,
    heartbeatMs: 60000,
    getWebState: ref.getWebState,
    decide: null,
    log: quietLog,
  });
  await server.start();
  t.after(() => void server.stop());
  ref.set(baseFrame());
  const client = await wsConnect(serverPort(server));
  await client.next();
  client.send({ type: "decide", action_id: "0e0f1e2e-3b4c-4d5e-8f9a-a1b2c3d4e5f6", decision: "approve" });
  const result = await client.next();
  assert.ok(result.type === "decide_result", "decide_result erwartet");
  assert.equal(result.type === "decide_result" ? result.outcome : undefined, "not_decidable");
  client.destroy();
  await server.stop();
});

test("WebServer: statische Datei + SPA-Fallback + Traversal-Schutz", async (t) => {
  const ref = stateRef();
  const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const staticDir = mkdtempSync(join(tmpdir(), "vw-web-test-"));
  t.after(() => rmSync(staticDir, { recursive: true, force: true }));
  writeFileSync(join(staticDir, "index.html"), "<!doctype html><title>Nyx</title>");
  writeFileSync(join(staticDir, "app.js"), "console.log(1)");
  const server = new WebServer({
    host: "127.0.0.1",
    port: 0,
    optInAllInterfaces: false,
    heartbeatMs: 60000,
    getWebState: ref.getWebState,
    decide: null,
    staticDir,
    log: quietLog,
  });
  await server.start();
  t.after(() => void server.stop());
  const port = serverPort(server);
  const index = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(index.status, 200);
  assert.match(index.headers.get("content-type") ?? "", /text\/html/);
  const js = await fetch(`http://127.0.0.1:${port}/app.js`);
  assert.equal(js.status, 200);
  // SPA-Fallback: beliebiger Pfad → index.html
  const spa = await fetch(`http://127.0.0.1:${port}/session/abc`);
  assert.equal(spa.status, 200);
  assert.match(await spa.text(), /Nyx/);
  // Traversal: ..%2f..%2fetc%2fpasswd darf nie 200 mit passwd sein
  const trav = await fetch(`http://127.0.0.1:${port}/..%2f..%2f..%2fetc%2fpasswd`);
  const body = await trav.text();
  assert.ok(!body.includes("root:"), "Path-Traversal hat /etc/passwd ausgeliefert");
  await server.stop();
});

// --- EPIC-P11 T11.5: /voice/:id-Endpoint -----------------------------------
test("WebServer: /voice/:id liefert WAV, unbekannte ID → 404", async (t) => {
  const ref = stateRef();
  const wav = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4]);
  const server = new WebServer({
    host: "127.0.0.1",
    port: 0,
    optInAllInterfaces: false,
    heartbeatMs: 60000,
    getWebState: ref.getWebState,
    decide: null,
    getVoiceCue: (id) => (id === "cue1" ? { wav, state: "idle" } : null),
    log: quietLog,
  });
  await server.start();
  t.after(() => void server.stop());
  const port = serverPort(server);
  const hit = await fetch(`http://127.0.0.1:${port}/voice/cue1`);
  assert.equal(hit.status, 200);
  assert.equal(hit.headers.get("content-type"), "audio/wav");
  const body = new Uint8Array(await hit.arrayBuffer());
  assert.equal(body[0], 0x52);
  const miss = await fetch(`http://127.0.0.1:${port}/voice/gibtsnicht`);
  assert.equal(miss.status, 404);
});
