import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DraftClient } from "../src/draft.ts";
import { Logger } from "../src/log.ts";

function silentLog(): Logger {
  const dir = mkdtempSync(join(tmpdir(), "vw-draft-"));
  return new Logger({ file: join(dir, "l.jsonl"), stdout: false, level: "error" });
}

test("DraftClient: GET revision → PUT, speichert Text", async () => {
  let putBody: unknown = null;
  const server = createServer((req, res) => {
    const url = req.url ?? "";
    if (req.method === "GET" && url.endsWith("/draft")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ sessionId: "s1", text: "", attachmentIds: [], revision: 0, updatedAt: null, device: null }));
      return;
    }
    if (req.method === "PUT" && url.endsWith("/draft")) {
      let raw = "";
      req.on("data", (c: Buffer) => {
        raw += c.toString("utf8");
      });
      req.on("end", () => {
        putBody = JSON.parse(raw);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ sessionId: "s1", text: "Hallo Hub", attachmentIds: [], revision: 1, updatedAt: "2026-11-11T00:00:00Z", device: "display:nyx" }));
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  const client = new DraftClient({
    baseUrl: `http://127.0.0.1:${port}`,
    token: "t",
    log: silentLog(),
  });
  const out = await client.putText("s1", "  Hallo Hub  ");
  assert.deepEqual(out, { kind: "saved", revision: 1 });
  assert.deepEqual(putBody, { text: "Hallo Hub", attachmentIds: [], baseRevision: 0 });
  await new Promise<void>((r) => server.close(() => r()));
});

test("DraftClient: 409 → Retry mit Hub-Revision", async () => {
  let puts = 0;
  const server = createServer((req, res) => {
    if (req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ sessionId: "s1", text: "alt", attachmentIds: [], revision: 1, updatedAt: null, device: "pixel" }));
      return;
    }
    let raw = "";
    req.on("data", (c: Buffer) => {
      raw += c.toString("utf8");
    });
    req.on("end", () => {
      puts += 1;
      const body = JSON.parse(raw) as { baseRevision: number; text: string };
      if (puts === 1) {
        assert.equal(body.baseRevision, 1);
        res.writeHead(409, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "conflict", current: { sessionId: "s1", text: "pc", attachmentIds: [], revision: 2, updatedAt: null, device: "desktop" } }));
        return;
      }
      assert.equal(body.baseRevision, 2);
      assert.equal(body.text, "gesprochen");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ sessionId: "s1", text: body.text, attachmentIds: [], revision: 3, updatedAt: null, device: "display:nyx" }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  const client = new DraftClient({
    baseUrl: `http://127.0.0.1:${port}`,
    token: "t",
    log: silentLog(),
  });
  const out = await client.putText("s1", "gesprochen");
  assert.deepEqual(out, { kind: "saved", revision: 3 });
  await new Promise<void>((r) => server.close(() => r()));
});
