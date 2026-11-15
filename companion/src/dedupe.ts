/**
 * Dedupe- und Audit-Store (EPIC-P3 T3.3, spec §4.4/W9): `data/decisions.jsonl`,
 * append-only; je `action_id` höchstens EIN decide-Call — auch über
 * Companion-Neustarts (Menge wird geladen, K7-Pfad). Eintrag VOR dem Call als
 * `pending` (Premortem 4), Abschluss danach; nach Neustart klärt der Status
 * per GET, nie blindes Wiederholen.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

export interface DecisionRecord {
  action_id: string;
  decision: "approve" | "decline";
  /** pending = decide unterwegs/abgebrochen; sent = Hub hat geantwortet. */
  status: "pending" | "sent" | "error";
  hub_status?: string;
  ts: string;
}

export class DecisionStore {
  private records = new Map<string, DecisionRecord>();
  private readonly file: string;

  private readonly now: () => string;

  constructor(file = "data/decisions.jsonl", now: () => string = () => new Date().toISOString()) {
    this.file = file;
    this.now = now;
    if (existsSync(file)) this.load();
  }

  private load(): void {
    for (const line of readFileSync(this.file, "utf8").split("\n")) {
      if (line.trim() === "") continue;
      try {
        const r = JSON.parse(line) as DecisionRecord;
        this.records.set(r.action_id, r);
      } catch {
        // korrupte Zeile überspringen: Fail-loud obliegt dem Logger des Aufrufers
      }
    }
  }

  has(actionId: string): boolean {
    return this.records.has(actionId);
  }

  get(actionId: string): DecisionRecord | undefined {
    return this.records.get(actionId);
  }

  /** Trägt VOR dem decide-Call als pending ein (W9: der Platz ist damit weg). */
  begin(actionId: string, decision: "approve" | "decline"): boolean {
    if (this.records.has(actionId)) return false;
    this.append({ action_id: actionId, decision, status: "pending", ts: this.now() });
    return true;
  }

  finish(actionId: string, status: "sent" | "error", hubStatus?: string): void {
    const rec = this.records.get(actionId);
    if (rec === undefined) return;
    const next: DecisionRecord = { ...rec, status, ts: this.now() };
    if (hubStatus !== undefined) next.hub_status = hubStatus;
    this.append(next);
  }

  private append(rec: DecisionRecord): void {
    mkdirSync(dirname(this.file), { recursive: true });
    appendFileSync(this.file, JSON.stringify(rec) + "\n");
    this.records.set(rec.action_id, rec);
  }
}
