/**
 * Sanitizing (EPIC-P1 T1.4): Titel/Body stammen aus Agent-/Provider-Output und
 * sind Anzeige-Daten (Prompt-Injection-Grenze, ADR-0004). Steuerzeichen und
 * ANSI-/CSI-Sequenzen werden entfernt, Überlänge mit „…" gekürzt — nie im
 * Protokoll stillschweigend abschneiden: die Kürze-Grenzen erzwingt zusätzlich
 * der Frame-Codec (W4/K5).
 */

const ANSI_RE =
  // eslint-disable-next-line no-control-regex -- ANSI/CSI/OSC sind per Definition Steuerzeichen
  /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-_]/g;
// eslint-disable-next-line no-control-regex -- dito C0/C1-Steuerzeichen
const CONTROL_RE = /[\u0000-\u0008\u000b-\u001f\u007f]/g;

export function sanitizeText(input: string, maxChars: number): string {
  const cleaned = input.replace(ANSI_RE, "").replace(CONTROL_RE, "").replace(/\s+/g, " ").trim();
  if (cleaned.length <= maxChars) return cleaned;
  if (maxChars <= 1) return cleaned.slice(0, Math.max(0, maxChars));
  // An Zeichen- (nicht Byte-)Grenze kürzen, „…" gehört zum Limit.
  return cleaned.slice(0, maxChars - 1) + "…";
}

/** Kürzt auf höchstens `maxBytes` UTF-8-Bytes an Zeichengrenze; „…“ (3 Byte) zählt mit. */
function fitBytes(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text) <= maxBytes) return text;
  let out = "";
  let bytes = 3;
  for (const ch of text) {
    const n = Buffer.byteLength(ch);
    if (bytes + n > maxBytes) break;
    out += ch;
    bytes += n;
  }
  return out + "…";
}

export interface RawPayload {
  title: string;
  body: string;
}

/** title ≤ 40, body ≤ 160 (2×80) — spec.md §4.1; die Firmware zählt Bytes, daher hier auch. */
export function sanitizePayload(payload: RawPayload): RawPayload {
  const title = fitBytes(sanitizeText(payload.title, 40), 40);
  return {
    // Schema verlangt title min(1): komplett leere Roh-Titel bekommen einen
    // sichtbaren Fallback statt einen invaliden Frame zu erzeugen.
    title: title.length > 0 ? title : "[ohne Titel]",
    body: fitBytes(sanitizeText(payload.body, 160), 160),
  };
}
