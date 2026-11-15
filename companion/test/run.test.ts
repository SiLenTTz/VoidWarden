// Betriebs-Einstieg (T4.6): startet, öffnet den Status-Socket, stoppt sauber bei SIGTERM;
// fehlende Konfiguration endet sichtbar mit Exit-Code 1.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const RUN = resolve("companion/src/run.ts");

test("ohne Konfiguration: Exit 1 mit lesbarer Meldung", () => {
  const dir = mkdtempSync(join(tmpdir(), "vw-run-"));
  try {
    const res = spawnSync(process.execPath, [RUN], { cwd: dir, encoding: "utf8" });
    assert.equal(res.status, 1);
    assert.match(res.stderr, /Start fehlgeschlagen/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("startet gegen unerreichbaren Hub ohne Board, öffnet den Socket und stoppt bei SIGTERM mit 0", async () => {
  const dir = mkdtempSync(join(tmpdir(), "vw-run-"));
  try {
    mkdirSync(join(dir, "data"));
    writeFileSync(join(dir, "data", "t.token"), "x\n", { mode: 0o600 });
    writeFileSync(
      join(dir, "c.json"),
      JSON.stringify({ hub: { url: "http://127.0.0.1:9", tokenFile: "data/t.token" }, serial: { path: "/dev/vw-none", baud: 921600 } }),
    );
    const sock = join(dir, "data", "voidwarden.sock");
    const child = spawn(process.execPath, [RUN, "--config", "c.json"], { cwd: dir, env: { ...process.env, VOIDWARDEN_SOCK: sock } });
    const exited = new Promise<number | null>((r) => child.on("exit", (code) => r(code)));
    for (let i = 0; i < 100 && !existsSync(sock); i++) await new Promise((r) => setTimeout(r, 50));
    assert.ok(existsSync(sock), "Status-Socket wurde angelegt");
    child.kill("SIGTERM");
    assert.equal(await exited, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
