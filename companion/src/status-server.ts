/**
 * `voidwarden status` (EPIC-P1 T1.6, observability.md §4): Unix-Socket im
 * Runtime-Verzeichnis (data/), kein HTTP-Listener. Der laufende Companion
 * bedient den Socket mit dem Status-JSON; die CLI fragt nur zu.
 */
import { createServer, type Server } from "node:net";
import { mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";

export interface StatusServerOptions {
  socketPath: string;
  getSnapshot: () => unknown;
}

export class StatusServer {
  private server: Server | null = null;
  private readonly opts: StatusServerOptions;

  constructor(opts: StatusServerOptions) {
    this.opts = opts;
  }

  async start(): Promise<void> {
    mkdirSync(dirname(this.opts.socketPath), { recursive: true });
    rmSync(this.opts.socketPath, { force: true });
    await new Promise<void>((resolve, reject) => {
      const server = createServer((socket) => {
        const payload = JSON.stringify(this.opts.getSnapshot()) + "\n";
        socket.end(payload);
      });
      server.once("error", reject);
      server.listen(this.opts.socketPath, () => resolve());
      this.server = server;
    });
  }

  async stop(): Promise<void> {
    const server = this.server;
    if (server === null) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(this.opts.socketPath, { force: true });
    this.server = null;
  }
}

/** CLI-Seite: einmalig Status lesen (leerer String, wenn Companion nicht läuft). */
export async function fetchStatus(socketPath: string, timeoutMs = 2000): Promise<string | null> {
  const { connect } = await import("node:net");
  return new Promise((resolve) => {
    const socket = connect(socketPath);
    const chunks: Buffer[] = [];
    const finish = (value: string | null) => {
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs, () => finish(null));
    socket.on("error", () => finish(null));
    socket.on("data", (c) => chunks.push(c));
    socket.on("close", () => finish(Buffer.concat(chunks).toString("utf8")));
  });
}
