/**
 * Nyx-Voice-Phrasen (T11.12): INHALT ZUERST, Sprichwort als Anhängsel.
 * buildPhrase(state, ctx) liefert klare Ansagen mit Session/Projekt-Kontext;
 * POETIC ist optionaler Schmuck, nie Alleinunterhalter.
 */
export type NyxVoiceState =
  | "idle"
  | "listening"
  | "approval_pending"
  | "executing"
  | "success"
  | "error"
  | "offline";

export interface VoiceContext {
  /** Name der Fokus-Session (z.B. "AncientVoid"), null wenn unbekannt. */
  session: string | null;
  /** Kurzer Klartext-Grund (z.B. Approval-Titel), null wenn n/a. */
  detail: string | null;
}

/** Klare Kernsätze je State — {s} = Session, {d} = Detail. */
const CLEAR: Record<NyxVoiceState, string[]> = {
  idle: ["{s} ist gerade im Leerlauf.", "Bei {s} ist es ruhig.", "{s} wartet auf die nächste Aufgabe.", "Für {s} gibt es gerade keine laufende Arbeit.", "{s} macht eine Pause.", "Bei {s} läuft gerade nichts."],
  listening: ["{s} ist aktiv.", "Bei {s} wird gerade gearbeitet.", "{s} arbeitet weiter.", "In {s} läuft die Arbeit.", "{s} ist beschäftigt.", "Die Arbeit in {s} läuft."],
  approval_pending: ["Eine Entscheidung von dir steht aus.", "Deine Entscheidung wird gebraucht.", "Es gibt eine offene Anfrage für dich.", "Bitte schau dir die wartende Anfrage an.", "Eine Anfrage wartet auf deine Antwort.", "Du bist dran: Eine Entscheidung ist offen."],
  executing: ["{s} führt eine Aufgabe aus.", "In {s} läuft die Ausführung.", "{s} ist mit der Ausführung beschäftigt.", "Die Aufgabe in {s} läuft.", "{s} arbeitet an der freigegebenen Aufgabe.", "Bei {s} wird die Aufgabe ausgeführt."],
  success: ["Eine Aufgabe wurde erfolgreich abgeschlossen.", "Der Hub meldet einen erfolgreichen Abschluss.", "Eine Aufgabe ist fertig.", "Es gibt einen erfolgreichen Abschluss.", "Eine Aufgabe ist erfolgreich beendet.", "Der Abschluss einer Aufgabe wurde bestätigt."],
  error: ["Ein Fehler wurde gemeldet. Bitte prüfen.", "Es gibt ein Problem. Schau bitte nach.", "Ein Fehler braucht deine Aufmerksamkeit.", "Bitte prüfe die Fehlermeldung.", "Der Hub meldet einen Fehler.", "Es ist ein Fehler aufgetreten."],
  offline: ["Die Verbindung zum Hub fehlt.", "Der Hub ist gerade nicht erreichbar.", "Ich bekomme gerade keine Daten vom Hub.", "Die Anzeige ist offline. Der letzte Stand bleibt sichtbar.", "Ich warte auf die Verbindung zum Hub.", "Es kommen keine neuen Hub-Daten an."],
};

/** Ruhige Nyx-Note nur in entspannten Zuständen, nie vor dringenden Meldungen. */
const POETIC = ["Die Schatten wachen mit.", "Ich halte die Wacht.", "Die Nacht bleibt ruhig."];

/** Tag-geseedeter deterministischer Picker (wie Ticker). */
export function voiceDaySeed(ms: number): number {
  return Math.floor(ms / 86_400_000);
}

export function buildPhrase(state: NyxVoiceState, ctx: VoiceContext, seed: number, counter: number): string {
  const pool = CLEAR[state] ?? CLEAR.idle!;
  let pick = pool[(seed + counter) % pool.length]!;
  const s = ctx.session ?? "Das System";
  pick = pick.replaceAll("{s}", s).replaceAll("{d}", ctx.detail ?? "");
  pick = pick.replace(/\s+([.!?])/u, "$1").replace(/\s{2,}/gu, " ").trim();
  // Seltene Note, damit Status und Verständlichkeit im Vordergrund bleiben.
  if ((state === "idle" || state === "listening") && (seed + counter) % 5 === 0) {
    const p = POETIC[(seed + counter * 3) % POETIC.length]!;
    pick = `${pick} ${p}`;
  }
  return pick;
}

// Backwards-kompatibel für Tests/Board-Pfad:
export const VOICE_PHRASES: Record<NyxVoiceState, string[]> = CLEAR;
export function pickPhrase(state: NyxVoiceState, seed: number, counter: number): string {
  return buildPhrase(state, { session: null, detail: null }, seed, counter);
}
