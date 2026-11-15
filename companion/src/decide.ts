/**
 * Decide-Pfad (EPIC-P3 T3.2, ADR-0001/0004): Touch-Entscheidung → Hub.
 * - Genau EINE getestete Übersetzungsfunktion `decline` → Hub-`reject`
 *   (spec §4.2) — nirgends sonst.
 * - Dedupe über DecisionStore: höchstens ein decide je action_id (W9),
 *   `decidable:false` wird nie entschieden (W9/PRD §8).
 * - Hub-Konflikt (4xx, belegt 422 "already rejected/timed_out"): Status per GET
 *   klären, nie blind wiederholen; Ergebnis als action_result an die Bridge (spec §4.4).
 */
import type { DecisionStore } from "./dedupe.ts";
import type { Logger } from "./log.ts";

/** Link-Vokabular → Hub-Vokabular (die EINE Stelle, spec §4.2). */
export function toHubDecision(decision: "approve" | "decline"): "approve" | "reject" {
  return decision === "approve" ? "approve" : "reject";
}

export type DecideOutcome =
  | { kind: "decided"; hub_status: string }
  | { kind: "conflict"; hub_status: string }
  | { kind: "rejected_by_policy" }
  | { kind: "not_decidable" }
  | { kind: "already_decided" }
  | { kind: "error"; message: string };

export interface DecideClientOptions {
  baseUrl: string;
  token: string;
  store: DecisionStore;
  log: Logger;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class DecideClient {
  private readonly fetchImpl: typeof fetch;
  private readonly opts: DecideClientOptions;

  constructor(opts: DecideClientOptions) {
    this.opts = opts;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  /**
   * Führt eine Touch-Entscheidung aus. Reihenfolge (W9):
   * decidable-Prüfung → Dedupe → pending-Eintrag → decide → GET bei Konflikt.
   */
  async decide(actionId: string, decision: "approve" | "decline", decidable: boolean): Promise<DecideOutcome> {
    if (!decidable) {
      this.opts.log.warn("decide:not_decidable", { action_id: hashId(actionId) });
      return { kind: "not_decidable" };
    }
    if (!this.opts.store.begin(actionId, decision)) {
      this.opts.log.info("decide:deduped", { action_id: hashId(actionId) });
      return { kind: "already_decided" };
    }
    try {
      const res = await this.fetchImpl(`${this.opts.baseUrl}/api/approvals/${actionId}/decide`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.opts.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ decision: toHubDecision(decision) }),
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 5000),
      });
      if (res.status === 403) {
        // Policy verbietet (z. B. Klasse doch destructive / reasonRequired): ehrlich melden
        this.opts.store.finish(actionId, "error", "403");
        return { kind: "rejected_by_policy" };
      }
      if (!res.ok) {
        // Konflikt (422 schon entschieden/abgelaufen, sonstige 4xx): Wahrheit beim Hub nachschlagen
        const status = await this.fetchApprovalStatus(actionId);
        this.opts.store.finish(actionId, "sent", status);
        return { kind: "conflict", hub_status: status };
      }
      const status = await this.fetchApprovalStatus(actionId);
      this.opts.store.finish(actionId, "sent", status);
      this.opts.log.info("decide:sent", { action_id: hashId(actionId), decision, hub_status: status });
      return { kind: "decided", hub_status: status };
    } catch (err) {
      this.opts.store.finish(actionId, "error");
      this.opts.log.error("decide:error", { action_id: hashId(actionId), error: (err as Error).message.slice(0, 100) });
      return { kind: "error", message: (err as Error).message };
    }
  }

  /** Hub-Status einer Approval ("approved"|"rejected"|"timed_out"|"pending"|…). */
  async fetchApprovalStatus(actionId: string): Promise<string> {
    try {
      const res = await this.fetchImpl(`${this.opts.baseUrl}/api/approvals/${actionId}`, {
        headers: { Authorization: `Bearer ${this.opts.token}` },
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 5000),
      });
      if (!res.ok) return res.status === 404 ? "unknown" : `http_${res.status}`;
      const body = (await res.json()) as { status?: string };
      return typeof body.status === "string" ? body.status : "unknown";
    } catch {
      return "unreachable";
    }
  }
}

/** action_id kürzen für Logs (keine vollständige UUID ins Log, Redaction-Stil). */
function hashId(actionId: string): string {
  return actionId.slice(0, 8) + "…";
}
