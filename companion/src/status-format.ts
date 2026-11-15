/**
 * `voidwarden status` in Klartext (observability.md §4): Ampel in der Kopfzeile, eine Zeile je
 * Befund. Rein (Zeit injiziert). Fehlende Werte heißen `n/a`, nie 0 (messlauf-Regel).
 */
type Raw = Record<string, unknown>;

function obj(v: unknown): Raw {
  return typeof v === "object" && v !== null ? (v as Raw) : {};
}
function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function fmt(v: number | null): string {
  return v === null ? "n/a" : String(v);
}
function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 90) return `${s} s`;
  const m = Math.round(s / 60);
  return m < 90 ? `${m} Min` : `${Math.round(m / 60)} h`;
}

export function formatStatus(raw: Raw, nowMs: number): string {
  const c = obj(raw["counters"]);
  const lat = obj(raw["decision_latency_ms"]);
  const link = typeof raw["link_state"] === "string" ? raw["link_state"] : null;
  const hub = typeof raw["hub_state"] === "string" ? raw["hub_state"] : null;
  const parseErr = num(c["parse_err"]);
  const dropped = num(c["frames_dropped"]);

  const problems: string[] = [];
  if (link !== "connected") problems.push("Board nicht verbunden");
  if (hub !== "up") problems.push("Hub nicht erreichbar");
  if (parseErr !== null && parseErr > 0) problems.push(`${parseErr} Parse-Fehler`);
  if (dropped !== null && dropped > 0) problems.push(`${dropped} Frames verworfen`);

  const version = typeof raw["version"] === "string" ? raw["version"] : "n/a";
  const head = problems.length === 0 ? "OK" : `ACHTUNG: ${problems.join(", ")}`;

  const helloTs = typeof raw["last_hello_ts"] === "string" ? Date.parse(raw["last_hello_ts"]) : NaN;
  const hello = Number.isFinite(helloTs)
    ? `letztes hello vor ${ago(nowMs - helloTs)}`
    : "kein hello seit Start (Board lief schon, der Zustand wird trotzdem gesendet)";

  const p95 = num(lat["p95"]);
  const n = num(lat["n"]);
  const latency = p95 === null ? "Latenz n/a (noch keine Entscheidung)" : `Latenz p95 ${p95} ms (n=${fmt(n)})`;

  return [
    `VoidWarden ${version} — ${head}`,
    `  Board:  ${link === "connected" ? "verbunden" : (link ?? "n/a")} — ${hello}`,
    `  Hub:    ${hub === "up" ? "erreichbar" : (hub ?? "n/a")} (${fmt(num(c["hub_polls"]))} Abfragen, ${fmt(num(c["hub_errors"]))} Fehler)`,
    `  Link:   ${fmt(num(c["frames_tx"]))} gesendet, ${fmt(num(c["frames_rx"]))} empfangen, ${fmt(dropped)} verworfen, ${fmt(parseErr)} Parse-Fehler, ${fmt(num(c["reconnects"]))} Reconnects`,
    `  Freigaben: ${fmt(num(c["decisions_sent"]))} entschieden, ${fmt(num(c["decisions_deduped"]))} doppelt abgefangen; ${latency}`,
  ].join("\n");
}
