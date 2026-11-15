/**
 * Kachel-Texte für den WS-Export (EPIC-P13 T13.3, ADR-0012 Punkt 9): Titel,
 * Aktivitätszeile und Bedarf je sessionList-Eintrag — reine Abbildung aus
 * Hub-Daten. Alles ist Anzeige-Daten (Prompt-Injection-Grenze, ADR-0004):
 * bereinigt, gekürzt, nur Vorlagen — nie roher Agenten-Text als Befehl
 * (spec.md §10.2). Der Web-Client rendert die Felder nur per textContent.
 */
import { QUESTION_TOOLS } from "@ancientvoid/contracts";
import type { ApprovalInput } from "./aggregate.ts";
import { sanitizeText } from "./sanitize.ts";

const MAX = 40;
const TOOL_PREFIX = "Werkzeug: ";

/** Session-Titel (jede titleSource, ADR-0012 Punkt 9): bereinigt, ≤ 40.
 * Leer oder fehlend → null ⇒ Feld weglassen, Client zeigt `name` (Rückfall). */
export function tileTitle(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const clean = sanitizeText(raw, MAX);
  return clean.length > 0 ? clean : null;
}

/** Aktivitätszeile aus lastActivity ({ text, type }) des Hubs. Feste
 * Vorlagen je type; nur tool_use/system übernehmen (bereinigten) Hub-Text.
 * Fehlt der type oder ist er unbekannt → null ⇒ Feld weglassen. */
export function tileActivity(type: string | undefined, rawText: string | undefined): string | null {
  const fromText = (): string | null => {
    if (typeof rawText !== "string") return null;
    const clean = sanitizeText(rawText, MAX);
    return clean.length > 0 ? clean : null;
  };
  switch (type) {
    case "tool_use": {
      if (typeof rawText !== "string") return null;
      const stripped = rawText.startsWith(TOOL_PREFIX) ? rawText.slice(TOOL_PREFIX.length) : rawText;
      const clean = sanitizeText(stripped, MAX);
      return clean.length > 0 ? clean : null;
    }
    case "assistant":
      return "antwortet";
    case "user":
      return "hat deinen Auftrag";
    case "gate":
      return "wartet auf dich";
    case "error":
      return "Fehler";
    case "system":
      return fromText();
    default:
      return null;
  }
}

/**
 * Bedarf der Session aus ihren wartenden Freigaben: "question", wenn (alle)
 * zutreffenden Freigaben Fragen sind; bei mehreren gewinnt "approval"
 * (Umsetzungsspezifikation T13.3). Fragen-Erkennung wie aggregate()/focus()
 * über QUESTION_TOOLS am Tool-Namen — needs und approval.kind laufen so nie
 * auseinander. Ohne Freigabe → undefined ⇒ Feld weglassen.
 */
export function needsFor(approvals: ApprovalInput[], sessionId: string | undefined): "approval" | "question" | undefined {
  const mine = approvals.filter((a) => a.sessionId === sessionId);
  if (mine.length === 0) return undefined;
  const isQuestion = (a: ApprovalInput): boolean => a.tool !== null && (QUESTION_TOOLS as readonly string[]).includes(a.tool);
  return mine.some((a) => !isQuestion(a)) ? "approval" : "question";
}
