/**
 * Composer (EPIC-P8 T8.1, ADR-0008): aus Zählern und erlaubten Feldern wird der Blasentext —
 * pure, ohne IO, ohne LLM. Jede Zahl stammt aus der Eingabe (AC-P8-1); `summary` ist nur die
 * bereinigte Notification-`title`-Zeile, nie `detail` (Premortem P8 #3). Veralteter Stand wird
 * benannt statt geraten. Agent-Text wird ausschließlich angezeigt (PRD §8.5).
 */
import type { FocusStatus } from "./focus.ts";
import { sanitizeText } from "./sanitize.ts";

export interface ComposerInput {
  working: number;
  /** Sessions, die auf einen Eingriff warten (Freigabe oder Rückfrage). */
  blocked: number;
  error: number;
  hubUp: boolean;
  /** Alter des Stands in Sekunden; über `staleAfterS` gilt er als veraltet. */
  dataAgeS: number;
  /** Bereinigte Titelzeile der letzten Notification, falls vorhanden. */
  lastEventTitle?: string;
  /** Sekunden seit dem letzten Ereignis; fehlt es, gibt es keine Aussage darüber. */
  lastEventAgeS?: number;
}

export interface ComposerOptions {
  staleAfterS: number;
  lineChars: number;
  compactLines: number;
}

export const DEFAULT_COMPOSER: ComposerOptions = { staleAfterS: 30, lineChars: 40, compactLines: 2 };

export interface ComposedBubble {
  text: string;
  /** Seiten à `compactLines` Zeilen; Seite 0 ist die kompakte Blase. */
  pages: string[][];
  stale: boolean;
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} Min`;
  return `${Math.floor(m / 60)} Std`;
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let cur = "";
  for (const word of text.split(" ")) {
    const w = word.length > width ? word.slice(0, width - 1) + "…" : word;
    if (cur === "") cur = w;
    else if (cur.length + 1 + w.length <= width) cur += ` ${w}`;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur !== "") lines.push(cur);
  return lines;
}

function safeCount(n: number): number {
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export function compose(input: ComposerInput, opts: ComposerOptions = DEFAULT_COMPOSER): ComposedBubble {
  const working = safeCount(input.working);
  const blocked = safeCount(input.blocked);
  const error = safeCount(input.error);
  const stale = !input.hubUp || input.dataAgeS > opts.staleAfterS;
  const sentences: string[] = [];

  if (stale) {
    sentences.push(input.hubUp ? "Stand veraltet." : "Hub nicht erreichbar.");
    sentences.push(`Letzter Stand vor ${formatDuration(input.dataAgeS)}:`);
  }
  const parts: string[] = [];
  if (working > 0) parts.push(`${count(working, "Agent arbeitet", "Agents arbeiten")}.`);
  if (blocked > 0) parts.push(`${blocked} ${blocked === 1 ? "wartet" : "warten"} auf Eingriff.`);
  if (error > 0) parts.push(`${count(error, "Fehler", "Fehler")}.`);
  const event = sanitizeText(input.lastEventTitle ?? "", 40);
  if (parts.length > 0) {
    sentences.push(...parts);
  } else if (!stale) {
    sentences.push("Keine aktiven Agents.");
  } else {
    sentences.push("keine aktiven Agents.");
  }
  if (event !== "") {
    sentences.push(`Letztes Ereignis: ${event}.`);
  } else if (parts.length === 0 && input.lastEventAgeS !== undefined && !stale) {
    sentences.pop();
    sentences.push(`Keine neuen Statusmeldungen seit ${formatDuration(input.lastEventAgeS)}.`);
  }

  const text = sentences.join(" ");
  const lines = wrap(text, opts.lineChars);
  const pages: string[][] = [];
  for (let i = 0; i < lines.length; i += opts.compactLines) {
    pages.push(lines.slice(i, i + opts.compactLines));
  }
  return { text, pages, stale };
}

/** Hängt einen Punkt an, außer der Text endet schon auf Satzzeichen (kein „Frage?.“). */
function endSentence(text: string): string {
  return /[.!?…]$/.test(text) ? text : `${text}.`;
}

export interface SessionStatusInput {
  /** Fokussierte Session (ADR-0009) oder null, wenn es keine gibt. */
  focus: { idx: number; total: number; ref: string; status: FocusStatus; name?: string } | null;
  working: number;
  blocked: number;
  error: number;
  hubUp: boolean;
  dataAgeS: number;
  /** Zusammenfassung der offenen Freigabe/Frage der fokussierten Session (Hub-Feld `summary`). */
  pendingSummary?: string;
  /** Letzte Agent-Nachricht der fokussierten Session (nur Anzeige, ADR-0004/0010). */
  lastMessage?: string;
}

/**
 * Tap-Status (EPIC-P8 T8.11, ADR-0009): Titel ≤ 40, Body ≤ 160 (2×80). Wie `compose` nur Zahlen und
 * erlaubte Felder aus der Eingabe; der Session-Name ist der Alias aus der Kurz-ID, nie `title`.
 */
export function composeSessionStatus(
  input: SessionStatusInput,
  opts: ComposerOptions = DEFAULT_COMPOSER,
): { title: string; body: string } {
  const { focus } = input;
  const stale = !input.hubUp || input.dataAgeS > opts.staleAfterS;
  const title =
    focus === null ? "Nyx" : sanitizeText(`${focus.name ?? `Agent ${focus.ref}`}${focus.total > 1 ? ` (${focus.idx}/${focus.total})` : ""}`, 40);

  const summary = sanitizeText(input.pendingSummary ?? "", 60);
  let core: string;
  if (focus === null) core = "Keine aktive Session.";
  else {
    switch (focus.status) {
      case "approval":
        core = summary !== "" ? endSentence(`Wartet auf Freigabe: ${summary}`) : "Wartet auf Freigabe.";
        break;
      case "question":
        core =
          summary !== "" ? `${endSentence(`Hat eine Frage: ${summary}`)} Antwort am Rechner.` : "Hat eine Frage. Antwort am Rechner.";
        break;
      case "error":
        core = "Meldet einen Fehler.";
        break;
      case "working":
        core = "Arbeitet.";
        break;
      case "idle":
        core = "Im Leerlauf.";
        break;
      default:
        core = "Pausiert oder beendet.";
    }
  }

  const parts: string[] = [];
  if (stale) {
    parts.push(input.hubUp ? "Stand veraltet." : "Hub nicht erreichbar.");
    parts.push(`Letzter Stand vor ${formatDuration(input.dataAgeS)}:`);
  }
  parts.push(core);
  const last = sanitizeText(input.lastMessage ?? "", 160);
  if (focus !== null && last !== "") parts.push(`Zuletzt: ${last}`);
  if (focus !== null && focus.total > 1 && last === "") {
    const w = safeCount(input.working);
    const b = safeCount(input.blocked);
    const e = safeCount(input.error);
    const sums: string[] = [];
    if (w > 0) sums.push(`${w} ${w === 1 ? "arbeitet" : "arbeiten"}`);
    if (b > 0) sums.push(`${b} ${b === 1 ? "wartet" : "warten"}`);
    if (e > 0) sums.push(`${count(e, "Fehler", "Fehler")}`);
    if (sums.length > 0) parts.push(`Gesamt: ${sums.join(", ")}.`);
  }
  return { title, body: sanitizeText(parts.join(" "), 160) };
}
