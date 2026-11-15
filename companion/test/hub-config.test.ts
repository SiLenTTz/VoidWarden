// Config + Hub-Client (EPIC-P1 T1.6): Beispiel-Config validiert, Hub-Fehler
// und unlesbare Formate fail-loud (K9), Timeout-Filter bleibt am Client.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadConfig, ConfigSchema } from "../src/config.ts";
import { HubClient, HubError } from "../src/hub.ts";

const here = dirname(fileURLToPath(import.meta.url));

test("Beispiel-Config validiert und liefert Defaults", () => {
  const example = JSON.parse(
    readFileSync(join(here, "..", "..", "voidwarden.config.example.json"), "utf8"),
  );
  const cfg = ConfigSchema.parse(example);
  assert.equal(cfg.serial.baud, 921600);
  assert.equal(cfg.heartbeat.intervalMs, 5000);
  assert.equal(cfg.poll.intervalMs, 1500);
  assert.equal(cfg.ui.criticalActions.length, 0);
});

test("Config ohne hub/serial wird abgelehnt", () => {
  assert.throws(() => ConfigSchema.parse({ serial: { path: "auto" } }));
});

test("web.idleTickerEnabled: Default true, per Config abschaltbar (P10-Retro)", () => {
  const base = {
    hub: { url: "http://127.0.0.1:7373", tokenFile: "data/display.token" },
    serial: { path: "/dev/null" },
  };
  assert.equal(ConfigSchema.parse(base).web.idleTickerEnabled, true, "Default ist an (Verhalten unverändert)");
  const off = ConfigSchema.parse({ ...base, web: { idleTickerEnabled: false } });
  assert.equal(off.web.idleTickerEnabled, false);
});

test("voice.url-Default zeigt auf localhost (kein privater Endpunkt im Code)", () => {
  const base = {
    hub: { url: "http://127.0.0.1:7373", tokenFile: "data/display.token" },
    serial: { path: "/dev/null" },
  };
  assert.equal(ConfigSchema.parse(base).voice.url, "http://127.0.0.1:8797/tts");
});

test("loadConfig liest echte Datei", () => {
  const path = join(here, "..", "..", "voidwarden.config.example.json");
  const cfg = loadConfig(path);
  assert.equal(cfg.hub.url, "http://127.0.0.1:7373");
});

function fakeFetch(responses: Record<string, unknown>, status = 200): typeof fetch {
  return (async (url: string | URL | Request) => {
    const u = String(url).replace("http://hub.test", "");
    const body = responses[u];
    if (body === undefined) {
      return new Response(JSON.stringify({ error: "not found" }), { status });
    }
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
}

const sessions = [{ id: "s1", status: "working", archived: false }];
const approvals = [
  {
    id: "0e0f1e2e-3b4c-4d5e-8f9a-a1b2c3d4e5f6",
    sessionId: "s1",
    status: "pending",
    class: "write",
    summary: "Paket installieren",
    action: "bash.exec",
    // BUG-0009: der Hub serialisiert tool seit T7.x als Objekt {name, input}
    // (input: stringifiedes JSON, gekappt) — nicht mehr als String.
    tool: { name: "npm", input: "{\"cmd\":\"install\"}" },
    reasonRequired: false,
    timeoutAt: "2026-11-03T12:05:00.000Z",
  },
  {
    // Freigabe ohne Operation (z. B. Budget): kein tool-Feld.
    id: "1e0f1e2e-3b4c-4d5e-8f9a-a1b2c3d4e5f7",
    sessionId: "s1",
    status: "pending",
    class: "write",
    summary: "Budget erhöhen",
    action: "budget.increase",
    reasonRequired: false,
    timeoutAt: "2026-11-03T12:06:00.000Z",
  },
];
const notifications = [
  { id: 3, sessionId: "s1", level: "warning", title: "Budget", detail: null, createdAt: "2026-11-03T11:00:00Z" },
];

test("HubClient.snapshot pollt alle drei Routen und mapped", async () => {
  const hub = new HubClient({
    baseUrl: "http://hub.test",
    token: "t",
    fetchImpl: fakeFetch({ "/api/sessions": sessions, "/api/approvals?status=pending": approvals, "/api/notifications?limit=10": notifications }),
  });
  const snap = await hub.snapshot();
  assert.equal(snap.sessions.length, 1);
  assert.equal(snap.sessions[0]?.id, "s1", "Session-ID geht durch (Fokus-Alias, ADR-0009)");
  assert.equal(snap.pendingApprovals.length, 2);
  assert.equal(snap.pendingApprovals[0]?.tool, "npm", "tool.name normalisiert (BUG-0009), input bleibt draußen");
  assert.equal(snap.pendingApprovals[1]?.tool, null, "ohne tool-Feld wird null gemappt");
  assert.equal(snap.notifications[0]?.id, 3);
});

test("HubClient: 401 -> HubError mit Status; unlesbares Format -> HubError (fail loud)", async () => {
  const unauth = new HubClient({ baseUrl: "http://hub.test", token: "bad", fetchImpl: fakeFetch({}, 401) });
  await assert.rejects(() => unauth.snapshot(), (e: unknown) => e instanceof HubError && e.status === 401);

  const garbage = new HubClient({
    baseUrl: "http://hub.test",
    token: "t",
    fetchImpl: (async () => new Response("<html>kein json</html>", { status: 200 })) as unknown as typeof fetch,
  });
  await assert.rejects(() => garbage.snapshot(), (e: unknown) => e instanceof HubError && e.status === null);
});

test("HubClient: Netzfehler -> HubError status null", async () => {
  const dead = new HubClient({
    baseUrl: "http://hub.test",
    token: "t",
    fetchImpl: (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch,
  });
  await assert.rejects(() => dead.snapshot(), (e: unknown) => e instanceof HubError && e.status === null);
});

// ADR-0010: letzte Agent-Nachricht aus /api/sessions/:id/events (nur Anzeige-Text, ADR-0004).
test("lastAssistantMessage: jüngstes assistant-Event, fragt nur das Ende ab", async () => {
  const urls: string[] = [];
  const fetchImpl = (async (u: string) => {
    urls.push(u);
    return new Response(
      JSON.stringify([
        { seq: 98, type: "assistant", summary: "alt" },
        { seq: 99, type: "assistant", summary: "neu" },
        { seq: 100, type: "tool_use", summary: "Bash" },
      ]),
    );
  }) as unknown as typeof fetch;
  const hub = new HubClient({ baseUrl: "http://h", token: "t", fetchImpl });
  assert.equal(await hub.lastAssistantMessage("sid", 100), "neu");
  assert.match(urls[0] as string, /\/api\/sessions\/sid\/events\?afterSeq=40&limit=60$/);
});

test("lastAssistantMessage: ohne assistant-Event null; Formatfehler wirft HubError", async () => {
  const ok = (async () => new Response("[]")) as unknown as typeof fetch;
  assert.equal(await new HubClient({ baseUrl: "http://h", token: "t", fetchImpl: ok }).lastAssistantMessage("s", 5), null);
  const bad = (async () => new Response('[{"x":1}]')) as unknown as typeof fetch;
  await assert.rejects(new HubClient({ baseUrl: "http://h", token: "t", fetchImpl: bad }).lastAssistantMessage("s", 5), /unlesbares Format/);
});
