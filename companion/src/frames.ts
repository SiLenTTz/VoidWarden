/**
 * Frame-Codec (EPIC-P1 T1.3): kodiert/dekodiert Link-Frames gegen die
 * Zod-Modelle, die das JSON-Schema in `protocol/` abbilden. Drift-Schutz sind
 * die goldenen Fixtures: der Contract-Test lässt jede gültige Fixture durch
 * diese Modelle passen und jede ungültige scheitern (companion/test/frames.test.ts).
 * K5/W4: Zeilen ≤ 512 Byte — Überlänge ist ein Fehler, nie Truncate.
 */
import { z } from "zod";

export const MAX_LINE_BYTES = 512;
export const TITLE_MAX = 40;
export const BODY_MAX = 160; // 2 × 80 (spec.md §4.1)

export type NyxStateName =
  | "idle"
  | "listening"
  | "approval_pending"
  | "executing"
  | "success"
  | "error"
  | "offline";

const v1 = z.literal(1);
const seq = z.number().int().nonnegative();
const isoTs = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/, "ISO-8601 UTC");
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
const nyxState = z.enum([
  "idle",
  "listening",
  "approval_pending",
  "executing",
  "success",
  "error",
  "offline",
]);
const hubFlag = z.enum(["up", "down"]);
const payload = z.object({
  title: z.string().min(1).max(TITLE_MAX),
  body: z.string().max(BODY_MAX),
});
const utcOffsetMin = z.number().int().min(-840).max(840).optional(); // ADR-0007, T4.7
// Frage (AskUserQuestion) ist nie entscheidbar (ADR-0001/0009): kind=question verlangt decidable=false.
const approvalKind = z.enum(["approval", "question"]).optional();
const questionNotDecidable = (a: { kind?: "approval" | "question" | undefined; decidable: boolean }) =>
  !(a.kind === "question" && a.decidable);
const approvalObj = z
  .object({
    action_id: uuid,
    kind: approvalKind,
    agent_id: z.string().min(1),
    class: z.enum(["read", "write", "destructive"]),
    payload,
    timeout_s: z.number().nonnegative(),
    decidable: z.boolean(),
  })
  .refine(questionNotDecidable, { message: "kind=question verlangt decidable=false", path: ["decidable"] });

export const FrameSchema = z.discriminatedUnion("type", [
  z.object({
    v: v1,
    type: z.literal("snapshot"),
    seq,
    state: nyxState,
    sessions: z.object({
      total: z.number().int().nonnegative(),
      working: z.number().int().nonnegative(),
      waiting: z.number().int().nonnegative(),
      error: z.number().int().nonnegative(),
    }),
    approval: z.union([z.null(), approvalObj]),
    hub: hubFlag,
    ts: isoTs,
    utc_offset_min: utcOffsetMin,
  }),
  z.object({
    v: v1,
    type: z.literal("state_change"),
    seq,
    state: nyxState,
    agent_id: z.string().min(1).optional(),
    payload: payload.optional(),
  }),
  z.object({
    v: v1,
    type: z.literal("notification"),
    seq,
    agent_id: z.string().min(1),
    level: z.enum(["info", "success", "warning", "error"]),
    payload,
  }),
  z.object({
    v: v1,
    type: z.literal("bubble"),
    seq,
    bubble_id: z.string().min(1).max(36),
    level: z.enum(["info", "success", "error", "critical"]),
    payload,
    hold_s: z.number().int().min(0).max(255),
    ack_required: z.boolean(),
  }),
  z.object({
    v: v1,
    type: z.literal("session_focus"),
    seq,
    idx: z.number().int().min(1).max(255),
    total: z.number().int().min(1).max(255),
    ref: z.string().min(1).max(8),
    name: z.string().min(1).max(16),
    status: z.enum(["approval", "question", "error", "working", "idle", "other"]),
  }),
  z
    .object({
      v: v1,
      type: z.literal("action_request"),
      seq,
      action_id: uuid,
      kind: approvalKind,
      agent_id: z.string().min(1),
      class: z.enum(["read", "write", "destructive"]),
      payload,
      timeout_s: z.number().nonnegative(),
      decidable: z.boolean(),
    })
    .refine(questionNotDecidable, { message: "kind=question verlangt decidable=false", path: ["decidable"] }),
  z.object({
    v: v1,
    type: z.literal("action_result"),
    seq,
    action_id: uuid,
    status: z.enum(["approved", "rejected", "timed_out", "stale", "error"]),
  }),
  z.object({
    v: v1,
    type: z.literal("heartbeat"),
    seq,
    ts: isoTs,
    hub: hubFlag,
    utc_offset_min: utcOffsetMin,
  }),
  z.object({
    v: v1,
    type: z.literal("hello"),
    fw: z.string().regex(/^\d+\.\d+\.\d+$/),
    proto: z.literal(1),
    screen: z.object({ w: z.number().int().positive(), h: z.number().int().positive() }),
    reset_reason: z.string().min(1),
    heap_free: z.number().int().nonnegative(),
  }),
  z.object({
    v: v1,
    type: z.literal("action_response"),
    action_id: uuid,
    decision: z.enum(["approve", "decline"]),
    ms: z.number().int().nonnegative(),
  }),
  // ADR-0007 §4 / ADR-0009: strict — kein `decision`, kein `action_id`; Entscheidungen nur über action_response.
  z
    .object({
      v: v1,
      type: z.literal("ui_action"),
      action: z.enum(["status_tap", "focus_next", "bubble_ack"]),
      ref: z.string().min(1).max(36).optional(),
      ms: z.number().int().nonnegative(),
    })
    .strict(),
  z.object({
    v: v1,
    type: z.literal("resync"),
    last_seq: z.number().int().nonnegative(),
  }),
  z.object({
    v: v1,
    type: z.literal("stats"),
    fps: z.number().nonnegative(),
    heap_free: z.number().int().nonnegative(),
    heap_min: z.number().int().nonnegative(),
    uptime_s: z.number().int().nonnegative(),
    rx_overrun: z.number().int().nonnegative(),
    parse_err: z.number().int().nonnegative(),
  }),
  z.object({
    v: v1,
    type: z.literal("log"),
    level: z.enum(["debug", "info", "warn", "error"]),
    msg: z.string().min(1).max(200),
    fields: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  }),
]);

export type Frame = z.infer<typeof FrameSchema>;

/** Frames mit seq-Feld (alles außer hello/action_response/ui_action/resync/stats/log). */
export type SeqFrame = Extract<Frame, { seq: number }>;

export type DecodeFailureKind = "oversize" | "not-json" | "schema";

export interface DecodeFailure {
  kind: DecodeFailureKind;
  message: string;
  bytes: number;
}

export type DecodeResult =
  | { ok: true; frame: Frame; unknownFields: string[] }
  | { ok: false; failure: DecodeFailure };

/**
 * ROM-Präfix (EPIC-P2 T2.9): Beim Boot können Bytes des ROM-Loaders vor dem ersten
 * `hello` stehen, ohne Zeilenende davor. Ohne Abtrennung ginge das `hello` verloren
 * und damit der `snapshot` (K7). Das Präfix wird deshalb getrennt und gezählt, nicht
 * still verworfen (Fail loud). Eine Zeile ohne `{` bleibt unverändert und wird
 * wie bisher als Protokollfehler gezählt.
 */
export function splitLinePrefix(line: string): { prefix: string; body: string } {
  const at = line.indexOf("{");
  if (at <= 0) return { prefix: "", body: line };
  return { prefix: line.slice(0, at), body: line.slice(at) };
}

export function decodeLine(line: string): DecodeResult {
  const bytes = Buffer.byteLength(line, "utf8");
  if (bytes > MAX_LINE_BYTES) {
    return { ok: false, failure: { kind: "oversize", message: `${bytes} B > ${MAX_LINE_BYTES} B`, bytes } };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (err) {
    return {
      ok: false,
      failure: { kind: "not-json", message: (err as Error).message, bytes },
    };
  }
  const res = FrameSchema.safeParse(parsed);
  if (!res.success) {
    const msg = res.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    return { ok: false, failure: { kind: "schema", message: msg, bytes } };
  }
  // Additive Felder bleiben v1-gültig (ADR-0002) — aber gezählt und gemeldet,
  // nie still verworfen (spec §4): Differenz Rohdaten ↔ Schema-Ergebnis.
  const known = new Set(Object.keys(res.data));
  const raw = parsed as Record<string, unknown>;
  const unknownFields = Object.keys(raw).filter((k) => !known.has(k));
  return { ok: true, frame: res.data, unknownFields };
}

/** Kodiert gegen das Schema und erzwingt K5: Fehler wirfen, nie Truncate/Stillschweigen. */
export function encodeFrame(frame: Frame): string {
  const check = FrameSchema.safeParse(frame);
  if (!check.success) {
    const msg = check.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`frame ${frame.type} schema-invalid: ${msg}`);
  }
  const line = JSON.stringify(frame);
  const bytes = Buffer.byteLength(line, "utf8");
  if (bytes > MAX_LINE_BYTES) {
    throw new Error(`frame ${frame.type} wäre ${bytes} B > ${MAX_LINE_BYTES} B (K5)`);
  }
  return line;
}
