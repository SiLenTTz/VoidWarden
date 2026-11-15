/**
 * Session-Entwurf (AncientVoid ADR-0025 / ADR-0069): Voice → Composer.
 * Nur PUT draft — nie steer/prompt. Display-Token braucht drafts.write.
 */
import type { Logger } from "./log.ts";

export type DraftOutcome =
  | { kind: "saved"; revision: number }
  | { kind: "conflict"; revision: number }
  | { kind: "not_available" }
  | { kind: "error"; message: string };

export interface DraftClientOptions {
  baseUrl: string;
  token: string;
  log: Logger;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Hard cap for dictated text (Hub allows 20k; speech stays short). */
  maxChars?: number;
}

const DraftBody = {
  parse(raw: unknown): { text: string; revision: number } | null {
    if (raw === null || typeof raw !== "object") return null;
    const o = raw as { text?: unknown; revision?: unknown; current?: unknown };
    const src = o.current !== undefined && typeof o.current === "object" ? (o.current as { text?: unknown; revision?: unknown }) : o;
    if (typeof src.text !== "string" || typeof src.revision !== "number" || !Number.isInteger(src.revision) || src.revision < 0) {
      return null;
    }
    return { text: src.text, revision: src.revision };
  },
};

export class DraftClient {
  private readonly fetchImpl: typeof fetch;
  private readonly opts: DraftClientOptions;

  constructor(opts: DraftClientOptions) {
    this.opts = opts;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  /** Liest aktuelle Revision und schreibt Text (bei 409 einmal mit Hub-Revision). */
  async putText(sessionId: string, text: string): Promise<DraftOutcome> {
    const trimmed = text.trim();
    if (trimmed === "") return { kind: "error", message: "empty" };
    const max = this.opts.maxChars ?? 2000;
    const bodyText = trimmed.length > max ? trimmed.slice(0, max) : trimmed;
    try {
      const current = await this.getDraft(sessionId);
      if (current === null) return { kind: "error", message: "unreadable draft" };
      const first = await this.put(sessionId, bodyText, current.revision);
      if (first.ok) {
        this.opts.log.info("draft:saved", { session: sessionId.slice(0, 8), revision: first.revision });
        return { kind: "saved", revision: first.revision };
      }
      // 409: einmal mit aktueller Revision überschreiben (Diktat = bewusste neue Eingabe)
      const retry = await this.put(sessionId, bodyText, first.currentRevision);
      if (retry.ok) {
        this.opts.log.info("draft:saved_after_conflict", { session: sessionId.slice(0, 8), revision: retry.revision });
        return { kind: "saved", revision: retry.revision };
      }
      this.opts.log.warn("draft:conflict", { session: sessionId.slice(0, 8) });
      return { kind: "conflict", revision: retry.currentRevision };
    } catch (err) {
      this.opts.log.error("draft:error", { error: (err as Error).message.slice(0, 100) });
      return { kind: "error", message: (err as Error).message };
    }
  }

  private async getDraft(sessionId: string): Promise<{ text: string; revision: number } | null> {
    const res = await this.fetchImpl(`${this.opts.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/draft`, {
      headers: { Authorization: `Bearer ${this.opts.token}` },
      signal: AbortSignal.timeout(this.opts.timeoutMs ?? 5000),
    });
    if (!res.ok) throw new Error(`hub draft GET ${res.status}`);
    return DraftBody.parse(await res.json());
  }

  private async put(
    sessionId: string,
    text: string,
    baseRevision: number,
  ): Promise<{ ok: true; revision: number } | { ok: false; currentRevision: number }> {
    const res = await this.fetchImpl(`${this.opts.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/draft`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${this.opts.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text, attachmentIds: [], baseRevision }),
      signal: AbortSignal.timeout(this.opts.timeoutMs ?? 5000),
    });
    if (res.status === 409) {
      const parsed = DraftBody.parse(await res.json());
      return { ok: false, currentRevision: parsed?.revision ?? baseRevision };
    }
    if (!res.ok) throw new Error(`hub draft PUT ${res.status}`);
    const parsed = DraftBody.parse(await res.json());
    if (parsed === null) throw new Error("hub draft PUT: unreadable body");
    return { ok: true, revision: parsed.revision };
  }
}
