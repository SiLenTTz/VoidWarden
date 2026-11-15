// Integration (ADR-0009): echter Companion (main.ts) gegen Fake-Hub-HTTP und MemoryLink-Gerät.
// Belegt die Kette Hub-Poll → Fokus → session_focus, Tap → bubble, Wechsel und W9: ui_action
// führt nie zu einem decide-Aufruf am Hub. Echte Zeit nur für Poll (250 ms), keine Sleeps ohne Bedingung.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryLink } from "../src/link.ts";
import { startCompanion } from "../src/main.ts";
import { decodeLine, type Frame } from "../src/frames.ts";

const HELLO =
  '{"v":1,"type":"hello","fw":"0.1.0","proto":1,"screen":{"w":320,"h":240},"reset_reason":"POWERON_RESET","heap_free":280000}';

interface FakeHub {
  server: Server;
  url: string;
  decideCalls: string[];
  stop: () => Promise<void>;
}

async function fakeHub(sessions: unknown[], approvals: unknown[]): Promise<FakeHub> {
  const decideCalls: string[] = [];
  const server = createServer((req, res) => {
    const url = req.url ?? "";
    res.setHeader("content-type", "application/json");
    if (req.method === "POST" && url.includes("/decide")) {
      decideCalls.push(url);
      res.statusCode = 200;
      res.end(JSON.stringify({ status: "approved" }));
    } else if (/^\/api\/sessions\/[^/]+\/events/.test(url)) {
      res.end(
        JSON.stringify([
          { seq: 1, type: "user", summary: "mach" },
          { seq: 2, type: "assistant", summary: "Alles erledigt, Gate grün." },
          { seq: 3, type: "tool_use", summary: "Bash" },
        ]),
      );
    } else if (url.startsWith("/api/sessions")) res.end(JSON.stringify(sessions));
    else if (url.startsWith("/api/approvals")) res.end(JSON.stringify(approvals));
    else if (url.startsWith("/api/notifications")) res.end(JSON.stringify({ items: [] }));
    else res.end("{}");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as { port: number }).port;
  return { server, url: `http://127.0.0.1:${port}`, decideCalls, stop: () => new Promise<void>((r) => server.close(() => r())) };
}

async function until(pred: () => boolean, what: string, ms = 4000): Promise<void> {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > ms) assert.fail(`Timeout: ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

async function run(
  sessions: unknown[],
  approvals: unknown[],
  body: (ctx: { device: MemoryLink; frames: Frame[]; hub: FakeHub; metrics: { parse_err: () => number } }) => Promise<void>,
): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "vw-int-"));
  const hub = await fakeHub(sessions, approvals);
  const [companionSide, device] = MemoryLink.pair();
  await device.open();
  const frames: Frame[] = [];
  device.onLine((l) => {
    const r = decodeLine(l);
    if (r.ok) frames.push(r.frame);
  });
  writeFileSync(join(dir, "t.token"), "x\n", { mode: 0o600 });
  writeFileSync(join(dir, "d.token"), "y\n", { mode: 0o600 });
  writeFileSync(
    join(dir, "c.json"),
    JSON.stringify({
      hub: { url: hub.url, tokenFile: join(dir, "t.token"), decideTokenFile: join(dir, "d.token") },
      serial: { path: "/dev/none", baud: 921600 },
      poll: { intervalMs: 250 },
      ui: { chatter: { enabled: false, minGapS: 90, jitterS: 60 } },
    }),
  );
  process.env["VOIDWARDEN_SOCK"] = join(dir, "v.sock");
  const c = await startCompanion({ configPath: join(dir, "c.json"), linkOverride: companionSide });
  try {
    await body({ device, frames, hub, metrics: { parse_err: () => c.bridge.counters.parse_err } });
  } finally {
    await c.stop();
    await hub.stop();
    rmSync(dir, { recursive: true, force: true });
  }
}

const A = "aaaaaa11-0000-4000-8000-000000000001";
const B = "bbbbbb22-0000-4000-8000-000000000002";
const approvalFor = (sessionId: string, extra: Record<string, unknown> = {}) => ({
  id: "0e0f1e2e-3b4c-4d5e-8f9a-a1b2c3d4e5f6",
  sessionId,
  status: "pending",
  class: "write",
  summary: "Datei schreiben",
  action: "write",
  // BUG-0009: echtes Hub-Format — tool ist {name, input}, nicht mehr String.
  tool: { name: "Edit", input: "{\"file\":\"a.ts\"}" },
  reasonRequired: false,
  timeoutAt: new Date(Date.now() + 300_000).toISOString(),
  ...extra,
});

const lastFocus = (frames: Frame[]) => frames.filter((f) => f.type === "session_focus").at(-1);

test("Auto-Fokus: Session mit Freigabe wird gemeldet; Tap bei offener Freigabe bleibt ohne Blase", async () => {
  await run(
    [{ id: A, status: "working" }, { id: B, status: "waiting_approval" }],
    [approvalFor(B)],
    async ({ device, frames, hub }) => {
      device.writeLine(HELLO);
      await until(() => lastFocus(frames) !== undefined, "session_focus");
      const f = lastFocus(frames);
      assert.ok(f?.type === "session_focus");
      if (f?.type === "session_focus") assert.deepEqual([f.idx, f.total, f.ref, f.status], [2, 2, "bbbbbb", "approval"]);
      // Der Snapshot trägt die Freigabe (BUG-0007), und der Fokus kam danach (K7).
      const types = frames.map((x) => x.type);
      assert.ok(types.indexOf("snapshot") < types.indexOf("session_focus"));
      device.writeLine('{"v":1,"type":"ui_action","action":"status_tap","ms":10}');
      await new Promise((r) => setTimeout(r, 600));
      assert.ok(!frames.some((x) => x.type === "bubble"), "Tap darf das Freigabe-Modal nicht überdecken");
      assert.equal(hub.decideCalls.length, 0);
    },
  );
});

test("Tap-Status ohne Freigabe: info-Blase mit Alias; focus_next wechselt; W9: nie ein decide", async () => {
  await run(
    [{ id: A, status: "working" }, { id: B, status: "idle" }],
    [],
    async ({ device, frames, hub, metrics }) => {
      device.writeLine(HELLO);
      await until(() => lastFocus(frames) !== undefined, "session_focus");
      device.writeLine('{"v":1,"type":"ui_action","action":"status_tap","ms":10}');
      await until(() => frames.some((x) => x.type === "bubble"), "bubble");
      const b = frames.find((x) => x.type === "bubble");
      assert.ok(b?.type === "bubble");
      if (b?.type === "bubble") {
        assert.equal(b.level, "info");
        assert.equal(b.ack_required, false);
        assert.equal(b.payload.title, "Agent aaaaaa (1/2)");
        assert.ok(b.payload.body.startsWith("Arbeitet."));
      }
      device.writeLine('{"v":1,"type":"ui_action","action":"focus_next","ms":20}');
      await until(() => {
        const f = lastFocus(frames);
        return f?.type === "session_focus" && f.ref === "bbbbbb";
      }, "Wechsel auf B");
      // ui_action mit Entscheidungsfeld ist ein Protokollfehler: gezählt, nie ausgeführt (W9)
      const before = metrics.parse_err();
      device.writeLine('{"v":1,"type":"ui_action","action":"status_tap","decision":"approve","ms":30}');
      await until(() => metrics.parse_err() > before, "parse_err für ui_action mit decision");
      assert.equal(hub.decideCalls.length, 0, "kein ui_action darf je decide auslösen");
    },
  );
});

test("Reset des Geräts: nach erneutem hello kommen snapshot und Fokus wieder (K7)", async () => {
  await run([{ id: A, status: "working" }, { id: B, status: "idle" }], [], async ({ device, frames }) => {
    device.writeLine(HELLO);
    await until(() => lastFocus(frames) !== undefined, "erster Fokus");
    const n = frames.length;
    device.writeLine(HELLO);
    await until(() => frames.slice(n).some((x) => x.type === "session_focus"), "Fokus nach Reset");
    const after = frames.slice(n).map((x) => x.type);
    assert.ok(after.indexOf("snapshot") >= 0 && after.indexOf("snapshot") < after.indexOf("session_focus"));
  });
});

test("Letzte Nachricht: Ticker-Notification mit Projektname + Tap-Blase nennt sie", async () => {
  await run(
    [{ id: A, status: "idle", project: "/work/voidwarden", lastSeq: 3 }],
    [],
    async ({ device, frames }) => {
      device.writeLine(HELLO);
      await until(() => frames.some((x) => x.type === "notification"), "notification");
      const n = frames.find((x) => x.type === "notification");
      assert.ok(n?.type === "notification");
      if (n?.type === "notification") {
        assert.equal(n.payload.title, "voidwarden");
        assert.equal(n.payload.body, "Alles erledigt, Gate grün.");
      }
      const f = lastFocus(frames);
      assert.ok(f?.type === "session_focus");
      if (f?.type === "session_focus") assert.equal(f.name, "voidwarden");
      device.writeLine('{"v":1,"type":"ui_action","action":"status_tap","ms":10}');
      await until(() => frames.some((x) => x.type === "bubble"), "bubble");
      const b = frames.find((x) => x.type === "bubble");
      if (b?.type === "bubble") assert.match(b.payload.body, /Zuletzt: Alles erledigt/);
    },
  );
});
