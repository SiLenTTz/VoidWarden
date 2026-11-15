/**
 * Hub-Client (EPIC-P1 T1.6/T1.4): pollt die verifizierten Routen
 * (spec.md §4.5), validiert Antworten mit Zod/contracts. Hub-Isolation:
 * nur HTTP-API, keine anderen AncientVoid-Imports als contracts.
 */
import { z } from "zod";
import type { ApprovalInput, SessionInput } from "./aggregate.ts";

const SessionItem = z.object({
  id: z.string().min(1),
  status: z.string(),
  archived: z.boolean().optional(),
  adapter: z.string().optional(),
  title: z.string().nullable().optional(),
  titleSource: z.string().optional(),
  project: z.string().optional(),
  lastSeq: z.number().int().optional(),
  // EPIC-P10 T10.3: Aktivitäts-Zeitstempel für Idle-Ticker/45-min-Verfall (T10.1 belegt).
  // T13.3: text/type für die Kachel-Aktivität (jeweils optional, der Fake-Hub
  // älterer Epics liefert nur `at`).
  updatedAt: z.string().min(1).optional(),
  lastActivity: z
    .object({
      at: z.string().min(1),
      text: z.string().optional(),
      type: z.string().optional(),
    })
    .nullable()
    .optional(),
});

const EventItem = z.object({ seq: z.number().int(), type: z.string(), summary: z.string().optional() });

const ApprovalItem = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  status: z.string(),
  class: z.enum(["read", "write", "destructive"]), // ApprovalClass aus contracts; unbekannt = Formatfehler (fail loud)
  summary: z.string(),
  action: z.string(),
  // BUG-0009: der Hub serialisiert tool seit T7.x als Objekt {name, input}
  // statt String. Wir normalisieren am Rand auf den Namen (ApprovalInput und
  // alles dahinter — Aggregation, Fragen-Erkennung, Frames — bleibt string|null).
  tool: z
    .object({
      name: z.string().min(1),
      input: z.string(),
    })
    .nullable()
    .optional(),
  reasonRequired: z.boolean(),
  timeoutAt: z.string().min(1),
});

const NotificationItem = z.object({
  id: z.number().int(),
  sessionId: z.string(),
  level: z.enum(["info", "success", "warning", "error"]), // Fail loud bei unbekanntem Level (NotificationLevel aus contracts)
  title: z.string(),
  detail: z.string().nullable(),
  createdAt: z.string().min(1),
});

export interface HubNotificationItem {
  id: number;
  sessionId: string;
  level: string;
  title: string;
  detail: string | null;
  createdAt: string;
}

export interface HubSnapshot {
  sessions: SessionInput[];
  pendingApprovals: ApprovalInput[];
  notifications: HubNotificationItem[];
}

export class HubError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null) {
    super(message);
    this.status = status;
  }
}

export interface HubClientOptions {
  baseUrl: string;
  token: string;
  fetchImpl?: typeof fetch;
  /** Request-Timeout in ms (Default 5000): hängende TCP-Verbindungen dürfen
   *  den Poller nicht blockieren, sonst bleibt `hub:"up"` laut falsch (W6). */
  timeoutMs?: number;
}

export class HubClient {
  private readonly fetchImpl: typeof fetch;
  private readonly opts: HubClientOptions;

  constructor(opts: HubClientOptions) {
    this.opts = opts;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private async getJson<T>(path: string, schema: z.ZodType<T>): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(this.opts.baseUrl + path, {
        headers: { Authorization: `Bearer ${this.opts.token}` },
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 5000),
      });
    } catch (err) {
      throw new HubError(`hub unreachable (${path}): ${(err as Error).message}`, null);
    }
    if (!res.ok) {
      throw new HubError(`hub ${path} -> ${res.status}`, res.status);
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch (err) {
      throw new HubError(`hub ${path}: kein JSON (${(err as Error).message.slice(0, 60)})`, null);
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      // Fail loud: unbekanntes Hub-Format ist ein Protokollfehler (K9).
      throw new HubError(`hub ${path}: unlesbares Format (${parsed.error.issues.length} Fehler)`, null);
    }
    return parsed.data;
  }

  /** Ein Poll-Zyklus: Sessions + offene Freigaben + neueste Notifications. */
  async snapshot(notificationLimit = 10): Promise<HubSnapshot> {
    // Echt-Hub liefert Notifications als {"items":[...]} (live belegt 2026-11-03),
    // Fake-Hub als Array — beides zulassen, Hülle wird entpackt.
    const notificationsSchema = z.union([
      z.array(NotificationItem),
      z.object({ items: z.array(NotificationItem) }),
    ]);
    const [sessions, pendingApprovals, notificationsRaw] = await Promise.all([
      this.getJson("/api/sessions", z.array(SessionItem)),
      this.getJson("/api/approvals?status=pending", z.array(ApprovalItem)),
      this.getJson(`/api/notifications?limit=${notificationLimit}`, notificationsSchema),
    ]);
    const notifications = Array.isArray(notificationsRaw) ? notificationsRaw : notificationsRaw.items;
    return {
      sessions: sessions.map((s) => ({
        id: s.id,
        status: s.status,
        ...(s.archived === undefined ? {} : { archived: s.archived }),
        ...(s.adapter === undefined ? {} : { adapter: s.adapter }),
        ...(s.title === undefined ? {} : { title: s.title }),
        ...(s.titleSource === undefined ? {} : { titleSource: s.titleSource }),
        ...(s.project === undefined ? {} : { project: s.project }),
        ...(s.lastSeq === undefined ? {} : { lastSeq: s.lastSeq }),
        ...(s.updatedAt === undefined ? {} : { updatedAt: s.updatedAt }),
        ...(s.lastActivity === undefined ? {} : { lastActivityAt: s.lastActivity?.at ?? null }),
        ...(s.lastActivity?.text === undefined ? {} : { lastActivityText: s.lastActivity.text }),
        ...(s.lastActivity?.type === undefined ? {} : { lastActivityType: s.lastActivity.type }),
      })),
      pendingApprovals: pendingApprovals.map((a) => ({
        id: a.id,
        sessionId: a.sessionId,
        status: a.status,
        class: a.class,
        summary: a.summary,
        action: a.action,
        tool: a.tool?.name ?? null,
        reasonRequired: a.reasonRequired,
        timeoutAt: a.timeoutAt,
      })),
      notifications,
    };
  }

  /**
   * Jüngste Agent-Nachricht einer Session (nur Anzeige-Text, ADR-0004/0010). Fragt nur die letzten
   * 60 Events ab; ohne assistant-Event darin `null`.
   */
  async lastAssistantMessage(sessionId: string, lastSeq: number): Promise<string | null> {
    const afterSeq = Math.max(0, lastSeq - 60);
    const events = await this.getJson(
      `/api/sessions/${encodeURIComponent(sessionId)}/events?afterSeq=${afterSeq}&limit=60`,
      z.array(EventItem),
    );
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i] as z.infer<typeof EventItem>;
      if (e.type === "assistant" && typeof e.summary === "string" && e.summary.trim() !== "") return e.summary;
    }
    return null;
  }

  async health(): Promise<boolean> {
    try {
      const res = await this.fetchImpl(this.opts.baseUrl + "/api/health", {
        headers: { Authorization: `Bearer ${this.opts.token}` },
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 5000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
