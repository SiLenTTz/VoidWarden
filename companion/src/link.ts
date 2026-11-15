/**
 * Link-Abstraktion (EPIC-P1 T1.3, ADR-0003): NDJSON-Zeilen-Duplex.
 * Implementierungen: MemoryLink (Tests/Sim), SerialLink (native, eigene Datei —
 * Tests laufen ohne native Module).
 */

export type LineCallback = (line: string) => void;
export type CloseCallback = () => void;

export interface Link {
  open(): Promise<void>;
  close(): Promise<void>;
  /** Eine NDJSON-Zeile (ohne Terminator) rausschreiben. */
  writeLine(line: string): void;
  onLine(cb: LineCallback): void;
  onClose(cb: CloseCallback): void;
  readonly isOpen: boolean;
}

/**
 * In-Memory-Paar: was das eine Ende schreibt, empfängt das andere —
 * synchron, deterministisch, für Unit-/Integrationstests und den Sim.
 */
export class MemoryLink implements Link {
  private peer: MemoryLink | null = null;
  private lineCbs: LineCallback[] = [];
  private closeCbs: CloseCallback[] = [];
  private open_ = false;

  static pair(): [MemoryLink, MemoryLink] {
    const a = new MemoryLink();
    const b = new MemoryLink();
    a.peer = b;
    b.peer = a;
    return [a, b];
  }

  async open(): Promise<void> {
    this.open_ = true;
  }

  async close(): Promise<void> {
    if (!this.open_) return;
    this.open_ = false;
    for (const cb of this.closeCbs) cb();
    if (this.peer?.isOpen) await this.peer.close();
  }

  get isOpen(): boolean {
    return this.open_;
  }

  writeLine(line: string): void {
    if (!this.open_) throw new Error("MemoryLink: write auf geschlossenem Link");
    const peer = this.peer;
    if (!peer?.isOpen) throw new Error("MemoryLink: Peer ist geschlossen");
    for (const cb of peer.lineCbs) cb(line);
  }

  onLine(cb: LineCallback): void {
    this.lineCbs.push(cb);
  }

  onClose(cb: CloseCallback): void {
    this.closeCbs.push(cb);
  }
}
