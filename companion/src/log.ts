/**
 * JSON-Lines-Logger (EPIC-P1 T1.6, observability.md §2): stdout + rotierende
 * Datei, Level-Steuerung, Redaction. Token und Payload-Texte stehen nie im
 * Klartext im Log — nur Länge und SHA-256-Kurzhash (außer expliziter
 * Debug-Modus VOIDWARDEN_LOG_PAYLOADS=1).
 */
import { createHash } from "node:crypto";
import { mkdirSync, appendFileSync, statSync, existsSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const REDACT_KEYS = [
  "authorization",
  "token",
  "cookie",
  "password",
  "secret",
  "apikey",
  "api_key",
];

export interface LogFields {
  [key: string]: unknown;
}

export interface LoggerOptions {
  file?: string; // Default data/logs/companion.jsonl
  level?: LogLevel; // Default aus VOIDWARDEN_LOG_LEVEL
  logPayloads?: boolean; // Default VOIDWARDEN_LOG_PAYLOADS=1
  maxFileBytes?: number; // Default 10 MB
  maxFiles?: number; // Default 5
  stdout?: boolean;
  now?: () => string;
}

function hashShort(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

/** Redigiert Felder rekursiv; Payload-Texte werden zu len+hash. */
export function redactFields(fields: LogFields, logPayloads: boolean): LogFields {
  const out: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    const norm = key.toLowerCase();
    if (REDACT_KEYS.includes(norm)) {
      out[key] = `[redacted:${hashShort(String(value))}]`;
      continue;
    }
    if ((norm === "title" || norm === "body" || norm === "payload" || norm === "msg_text") && typeof value === "string" && !logPayloads) {
      out[key] = `[payload len=${value.length} sha=${hashShort(value)}]`;
      continue;
    }
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      out[key] = redactFields(value as LogFields, logPayloads);
      continue;
    }
    out[key] = value;
  }
  return out;
}

export class Logger {
  private readonly level: LogLevel;
  private readonly logPayloads: boolean;
  private readonly file: string | null;
  private readonly maxFileBytes: number;
  private readonly maxFiles: number;
  private readonly useStdout: boolean;
  private readonly now: () => string;
  private readonly context: LogFields;

  constructor(opts: LoggerOptions = {}, context: LogFields = {}) {
    this.level = opts.level ?? (process.env["VOIDWARDEN_LOG_LEVEL"] as LogLevel | undefined) ?? "info";
    this.logPayloads = opts.logPayloads ?? process.env["VOIDWARDEN_LOG_PAYLOADS"] === "1";
    this.file = opts.file ?? join(process.cwd(), "data", "logs", "companion.jsonl");
    this.maxFileBytes = opts.maxFileBytes ?? 10 * 1024 * 1024;
    this.maxFiles = opts.maxFiles ?? 5;
    this.useStdout = opts.stdout ?? true;
    this.now = opts.now ?? (() => new Date().toISOString());
    this.context = context;
    if (this.file !== null) mkdirSync(dirname(this.file), { recursive: true });
  }

  child(fields: LogFields): Logger {
    const opts: LoggerOptions = {
      level: this.level,
      logPayloads: this.logPayloads,
      maxFileBytes: this.maxFileBytes,
      maxFiles: this.maxFiles,
      stdout: this.useStdout,
      now: this.now,
    };
    if (this.file !== null) opts.file = this.file;
    return new Logger(opts, { ...this.context, ...fields });
  }

  debug(msg: string, fields?: LogFields): void {
    this.write("debug", msg, fields);
  }
  info(msg: string, fields?: LogFields): void {
    this.write("info", msg, fields);
  }
  warn(msg: string, fields?: LogFields): void {
    this.write("warn", msg, fields);
  }
  error(msg: string, fields?: LogFields): void {
    this.write("error", msg, fields);
  }

  private write(level: LogLevel, msg: string, fields?: LogFields): void {
    if (LEVELS[level] < LEVELS[this.level]) return;
    const entry = {
      ts: this.now(),
      level,
      component: "companion",
      msg,
      ...redactFields({ ...this.context, ...(fields ?? {}) }, this.logPayloads),
    };
    const line = JSON.stringify(entry);
    if (this.useStdout) process.stdout.write(line + "\n");
    if (this.file !== null) {
      this.rotateIfNeeded();
      appendFileSync(this.file, line + "\n");
    }
  }

  private rotateIfNeeded(): void {
    const file = this.file as string;
    if (!existsSync(file)) return;
    if (statSync(file).size < this.maxFileBytes) return;
    for (let i = this.maxFiles - 1; i >= 1; i--) {
      const from = `${file}.${i}`;
      const to = `${file}.${i + 1}`;
      if (existsSync(from)) renameSync(from, to);
    }
    renameSync(file, `${file}.1`);
  }
}
