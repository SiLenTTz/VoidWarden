/**
 * Session-Fokus (EPIC-P7 T7.12, ADR-0009): welche Session Tap-Status und Indikator zeigen. Pure,
 * Uhr injiziert, kein Zufall. Der Gesamtzustand (`aggregate()`) und das Freigabe-Modal bleiben
 * davon unberührt: dringende Freigaben werden nie durch einen Fokuswechsel verdeckt.
 *
 * Auto-Priorität (wie spec §5.1, nur je Session): wartet auf Mensch (Freigabe/Frage) > Fehler >
 * arbeitet > idle > Rest. Bei Gleichstand: kürzere Restzeit der Freigabe, dann Listenposition.
 */
import { QUESTION_TOOLS, SESSION_STATUSES } from "@ancientvoid/contracts";
import type { ApprovalInput, SessionInput } from "./aggregate.ts";
import { sanitizeText } from "./sanitize.ts";

export type FocusStatus = "approval" | "question" | "error" | "working" | "idle" | "other";

export interface FocusSession {
  /** Hub-Session-ID (für das Nachladen der letzten Nachricht). */
  id?: string;
  /** Kurz-ID der Session (Alias, nie Titel oder Aktivitätstext, ADR-0008 §6). */
  ref: string;
  /** Anzeigename ≤ 16 Zeichen (`aliasFor`). */
  name: string;
  status: FocusStatus;
  /** Restzeit der offenen Freigabe/Frage in Sekunden; fehlt sie, gilt sie als am wenigsten dringend. */
  timeoutS?: number;
  /** Bereinigbare Hub-Zusammenfassung der offenen Freigabe/Frage (nur Anzeige, ADR-0008). */
  summary?: string;
}

export interface FocusView {
  /** 1-basiert, in Listenreihenfolge (stabil, damit der Wechsel nicht springt). */
  idx: number;
  total: number;
  ref: string;
  name: string;
  status: FocusStatus;
  pinned: boolean;
}

export interface FocusOptions {
  /** Rückfallzeit nach manuellem Wechsel in Sekunden (`ui.focusHoldS`). */
  holdS: number;
}

const RANK: Record<FocusStatus, number> = { approval: 0, question: 0, error: 1, working: 2, idle: 3, other: 4 };

function needsHuman(status: FocusStatus): boolean {
  return status === "approval" || status === "question";
}

export class FocusController {
  private readonly opts: FocusOptions;
  private sessions: FocusSession[] = [];
  private pinnedRef: string | null = null;
  private pinnedAtMs = 0;
  private knownUrgent = new Set<string>();

  constructor(opts: FocusOptions) {
    this.opts = opts;
  }

  /** Neuer Sessionstand; liefert die aktuelle Fokusansicht oder null ohne Sessions. */
  update(sessions: FocusSession[], nowMs: number): FocusView | null {
    this.sessions = sessions;
    const urgent = new Set(sessions.filter((x) => needsHuman(x.status)).map((x) => x.ref));
    if (this.pinnedRef !== null) {
      const gone = !sessions.some((x) => x.ref === this.pinnedRef);
      const expired = nowMs - this.pinnedAtMs >= this.opts.holdS * 1000;
      // Neues Dringendes in einer anderen Session schlägt die Fixierung (ADR-0009 §2).
      const newUrgentElsewhere = [...urgent].some((r) => r !== this.pinnedRef && !this.knownUrgent.has(r));
      if (gone || expired || newUrgentElsewhere) this.pinnedRef = null;
    }
    this.knownUrgent = urgent;
    return this.view();
  }

  /** Manueller Wechsel zur nächsten Session in Listenreihenfolge; fixiert für `holdS`. */
  next(nowMs: number): FocusView | null {
    if (this.sessions.length === 0) return null;
    if (this.sessions.length === 1) return this.view();
    const current = this.focusedRef();
    const at = this.sessions.findIndex((x) => x.ref === current);
    const target = this.sessions[(at + 1) % this.sessions.length] as FocusSession;
    this.pinnedRef = target.ref;
    this.pinnedAtMs = nowMs;
    return this.view();
  }

  private autoRef(): string | null {
    let best: FocusSession | null = null;
    for (const x of this.sessions) {
      if (best === null) {
        best = x;
        continue;
      }
      const dr = RANK[x.status] - RANK[best.status];
      if (dr < 0 || (dr === 0 && (x.timeoutS ?? Infinity) < (best.timeoutS ?? Infinity))) best = x;
    }
    return best === null ? null : best.ref;
  }

  private focusedRef(): string | null {
    return this.pinnedRef ?? this.autoRef();
  }

  private view(): FocusView | null {
    const ref = this.focusedRef();
    if (ref === null) return null;
    const at = this.sessions.findIndex((x) => x.ref === ref);
    const found = this.sessions[at] as FocusSession;
    return { idx: at + 1, total: this.sessions.length, ref, name: found.name, status: found.status, pinned: this.pinnedRef !== null };
  }
}

const STATUS_SET = new Set<string>(SESSION_STATUSES);

function plainStatus(status: string): FocusStatus {
  switch (status) {
    case "waiting_approval":
      return "approval";
    case "error":
      return "error";
    case "starting":
    case "working":
    case "stopping":
      return "working";
    case "idle":
      return "idle";
    default:
      // parked/stopped/interrupted sind kein Fehler (ADR-0044 AncientVoid); alles Unbekannte ist ein
      // Protokollfehler und wird wie in aggregate() nie als idle gezeigt (K9).
      return STATUS_SET.has(status) ? "other" : "error";
  }
}

function uniqueRefs(ids: Array<string | undefined>): string[] {
  const refs: string[] = [];
  ids.forEach((id, i) => {
    const fallback = `s${i + 1}`;
    if (id === undefined || id === "") {
      refs.push(fallback);
      return;
    }
    const pick = [6, 7, 8].map((n) => id.slice(0, n)).find((r) => !refs.includes(r));
    refs.push(pick ?? fallback);
  });
  return refs;
}

/**
 * Hub-Stand → Fokus-Sessions (ADR-0009). Listenreihenfolge = Hub-Reihenfolge (stabil). Eine offene,
 * nicht abgelaufene Freigabe der Session bestimmt Status, Restzeit und Zusammenfassung; mehrere:
 * die mit der kürzesten Restzeit. Der Name ist ein Alias aus der Kurz-ID, nie der Session-Titel.
 */
const NAME_MAX = 16;

/**
 * Anzeigename der Session (ADR-0010): der Projektname (Verzeichnisname), sonst nach ADR-0008 §6 der Titel nur bei `titleSource=manual` (vom Menschen
 * vergeben), bereinigt und gekürzt; sonst Adapter + Kurz-ID. Den Prompt-Auszug (`auto`/`ai`) zeigen
 * wir nie. Fehlt der Adapter, bleibt der alte Alias `Agent <ref>`.
 */
export function aliasFor(s: SessionInput, ref: string): string {
  if (typeof s.project === "string") {
    const base = s.project.split(/[\\/]+/).filter((p) => p !== "").pop() ?? "";
    const clean = sanitizeText(base, 80).slice(0, NAME_MAX);
    if (clean.length > 0) return clean;
  }
  if (s.titleSource === "manual" && typeof s.title === "string") {
    // eslint-disable-next-line no-control-regex -- Steuerzeichen aus Hub-Text entfernen
    const clean = s.title.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
    if (clean.length > 0) return clean.slice(0, NAME_MAX);
  }
  const adapter = (s.adapter ?? "").replace(/[^\w.-]/g, "");
  const room = NAME_MAX - ref.length - 1;
  const head = adapter.length > 0 ? adapter.slice(0, Math.max(1, room)) : "Agent";
  return `${head} ${ref}`.slice(0, NAME_MAX);
}

export function toFocusSessions(sessions: SessionInput[], approvals: ApprovalInput[], nowMs: number): FocusSession[] {
  const active = sessions.filter((s) => s.archived !== true);
  const refs = uniqueRefs(active.map((s) => s.id));
  return active.map((s, i) => {
    const ref = refs[i] as string;
    const open = approvals
      .filter((a) => a.status === "pending" && a.sessionId === s.id && Date.parse(a.timeoutAt) > nowMs)
      .sort((a, b) => Date.parse(a.timeoutAt) - Date.parse(b.timeoutAt))[0];
    const name = aliasFor(s, ref);
    const id = s.id === undefined || s.id === "" ? {} : { id: s.id };
    if (open === undefined) return { ref, name, ...id, status: plainStatus(s.status) };
    const isQuestion = open.tool !== null && (QUESTION_TOOLS as readonly string[]).includes(open.tool);
    return {
      ref,
      name,
      ...id,
      status: isQuestion ? "question" : "approval",
      timeoutS: Math.max(0, (Date.parse(open.timeoutAt) - nowMs) / 1000),
      summary: open.summary,
    };
  });
}
