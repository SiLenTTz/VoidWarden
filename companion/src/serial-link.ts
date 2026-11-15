/**
 * SerialLink (EPIC-P1 T1.3, ADR-0003): NDJSON über USB-Serial. Einzige native
 * Laufzeit-Abhängigkeit (`serialport`), gekapselt hinter `Link` — Tests und
 * Sim laufen auf MemoryLink und laden dieses Modul nicht.
 */
import { SerialPort } from "serialport";
import type { CloseCallback, LineCallback, Link } from "./link.ts";

export interface SerialLinkOptions {
  path: string; // Gerät oder "auto"
  baud: number;
  log?: (msg: string, fields?: Record<string, string | number | boolean>) => void;
}

/** USB-Serial-Gerät: SerialPort.list() liefert unter Linux volle Pfade (`/dev/ttyUSB0`), BUG-0005. */
export function isBoardPath(path: string): boolean {
  return /(^|\/)tty(USB|ACM)\d+$/.test(path);
}

/** Wählt das erste angeschlossene USB-Serial-Gerät (ttyUSB- oder ttyACM-Pfad). */
export async function findSerialPath(): Promise<string> {
  const ports = await SerialPort.list();
  const hit = ports.find((p) => isBoardPath(p.path ?? ""));
  if (!hit) throw new Error(`kein USB-Serial-Gerät gefunden (vorhanden: ${ports.length} Ports)`);
  return hit.path as string;
}

const RX_BUFFER_CAP = 8192; // Zeilen-Untergrund ohne \n: cap statt endloses Wachstum (W7)

export class SerialLink implements Link {
  private port: SerialPort | null = null;
  private lineCbs: LineCallback[] = [];
  private closeCbs: CloseCallback[] = [];
  /** Byte-Akkumulator: UTF-8-Multibyte darf an Chunk-Grenzen nicht zerfallen. */
  private buffer = Buffer.alloc(0);
  private open_ = false;
  private readonly opts: SerialLinkOptions;

  constructor(opts: SerialLinkOptions) {
    this.opts = opts;
  }

  async open(): Promise<void> {
    const path = this.opts.path === "auto" ? await findSerialPath() : this.opts.path;
    this.opts.log?.("serial:open", { path, baud: this.opts.baud });
    await new Promise<void>((resolve, reject) => {
      const port = new SerialPort({ path, baudRate: this.opts.baud, autoOpen: true }, (err) => {
        if (err) reject(err);
        else resolve();
      });
      this.port = port;
    });
    const port = this.port;
    if (!port) throw new Error("serial: open fehlgeschlagen");
    port.on("data", (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      if (this.buffer.length > RX_BUFFER_CAP) {
        // Fail loud: Müll ohne Zeilenende verwerfen (bis zum nächsten \n),
        // gezählt über den Log-Callback statt still weiter zu wachsen.
        const cut = this.buffer.indexOf(Buffer.from("\n"));
        this.buffer = cut >= 0 ? this.buffer.subarray(cut + 1) : Buffer.alloc(0);
        this.opts.log?.("serial:rx_overrun", { cap: RX_BUFFER_CAP });
      }
      let nl: number;
      while ((nl = this.buffer.indexOf(0x0a)) >= 0) {
        const line = this.buffer.subarray(0, nl).toString("utf8").replace(/\r$/, "");
        this.buffer = this.buffer.subarray(nl + 1);
        if (line.length > 0) for (const cb of this.lineCbs) cb(line);
      }
    });
    port.on("error", (err: Error) => {
      // Nie unhandled: Fehler sichtbar machen und als Link-Ausfall behandeln (W5/W6).
      this.opts.log?.("serial:error", { error: err.message.slice(0, 120) });
      this.open_ = false;
      try {
        port.close();
      } catch {
        /* bereits zu */
      }
      for (const cb of this.closeCbs) cb();
    });
    port.on("close", () => {
      this.open_ = false;
      for (const cb of this.closeCbs) cb();
    });
    this.open_ = true;
  }

  async close(): Promise<void> {
    const port = this.port;
    if (!port?.isOpen) return;
    await new Promise<void>((resolve) => {
      port.close(() => resolve());
    });
    this.open_ = false;
  }

  get isOpen(): boolean {
    return this.open_;
  }

  writeLine(line: string): void {
    const port = this.port;
    if (!port?.isOpen) throw new Error("SerialLink: write auf geschlossenem Link");
    port.write(line + "\n");
  }

  onLine(cb: LineCallback): void {
    this.lineCbs.push(cb);
  }

  onClose(cb: CloseCallback): void {
    this.closeCbs.push(cb);
  }
}
