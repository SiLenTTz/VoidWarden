/**
 * Bewertung eines HIL-Laufs (EPIC-P2 T2.8). Rein: bekommt aufgezeichnete Frames mit
 * Zeitstempel, damit jede Prüfung ohne Uhr und ohne Board testbar ist (docs/testing.md §2.2).
 */

/** AC-P2-4: Reset → hello in ≤ 3 s. */
export const HELLO_DEADLINE_MS = 3000;
/** BUG-0001: korrigiertes Panelprofil ILI9341 im Querformat. */
export const SCREEN = { w: 320, h: 240 };
/** AC-P2-5 als Sanity-Grenze; der 30-min-Dauerlauf bleibt Messlauf. */
export const MIN_HEAP_MIN = 20000;
/** Die sieben Nyx-Zustände aus spec.md §5, in Durchlaufreihenfolge. */
export const STATES = ["idle", "listening", "approval_pending", "executing", "success", "error", "offline"];
export const HOLD_MS = 4000;
export const RESET_COUNT = 5;
/** stats kommt alle 30 s nach Boot; etwas Spielraum für die Anlaufzeit. */
export const STATS_DEADLINE_MS = 35000;

/**
 * @param {Array<{at: number, frame: object}>} events
 * @param {number} afterMs  Zeitpunkt des Resets
 * @returns {{found: boolean, latencyMs: number|null, frame: object|null}}
 */
export function findHello(events, afterMs, deadlineMs = HELLO_DEADLINE_MS) {
  const hit = events.find(
    (e) => e.frame.type === "hello" && e.at >= afterMs && e.at <= afterMs + deadlineMs,
  );
  if (!hit) return { found: false, latencyMs: null, frame: null };
  return { found: true, latencyMs: Math.round(hit.at - afterMs), frame: hit.frame };
}

export function screenMatches(frame) {
  return frame?.screen?.w === SCREEN.w && frame?.screen?.h === SCREEN.h;
}

/**
 * @param {object} stats  letztes stats-Frame
 * @returns {Array<{name: string, ok: boolean, detail: string}>}
 */
export function assessStats(stats) {
  return [
    {
      name: "stats: parse_err = 0",
      ok: stats.parse_err === 0,
      detail: `parse_err=${stats.parse_err}`,
    },
    {
      name: "stats: rx_overrun = 0",
      ok: stats.rx_overrun === 0,
      detail: `rx_overrun=${stats.rx_overrun}`,
    },
    {
      name: `stats: heap_min ≥ ${MIN_HEAP_MIN} B`,
      ok: stats.heap_min >= MIN_HEAP_MIN,
      detail: `heap_min=${stats.heap_min} B`,
    },
  ];
}

/**
 * Stats-Frame aus der Ereignisliste nach dem letzten Reset.
 * @returns {object|null}
 */
export function lastStatsAfter(events, afterMs) {
  const hits = events.filter((e) => e.frame.type === "stats" && e.at >= afterMs);
  return hits.length ? hits[hits.length - 1].frame : null;
}

/**
 * Zerlegt einen Rohzeilen-Strom in Frames. ROM-Bootbytes vor dem ersten `{` werden
 * gezählt, nicht still verworfen (Fail loud; offener Befund T2.9).
 * @returns {{frames: Array<{at: number, frame: object}>, romPrefix: number, junk: number}}
 */
export function parseStream(chunks) {
  const frames = [];
  let romPrefix = 0;
  let junk = 0;
  let buf = "";
  for (const { at, text } of chunks) {
    buf += text;
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const raw = buf.slice(0, nl).replace(/\r$/, "");
      buf = buf.slice(nl + 1);
      const start = raw.indexOf("{");
      if (start < 0) {
        if (raw.trim()) romPrefix++;
        continue;
      }
      if (start > 0) romPrefix++;
      try {
        frames.push({ at, frame: JSON.parse(raw.slice(start)) });
      } catch {
        junk++;
      }
    }
  }
  return { frames, romPrefix, junk };
}

/** W3 (spec.md §9): Untergrenze fps und Obergrenze je Frame im Dauerlauf. */
export const W3_FPS_FLOOR = 25;
export const W3_FRAME_LOG = "frame_ueber_80ms";
export const W3_FPS_LOG = "fps_unter_25";

/**
 * Bewertung des Dauerlaufs (EPIC-P2 T2.7, AC-P2-2 und AC-P2-5). Rein; Eingabe sind die
 * mitgeschnittenen Frames. Die maximale Frame-Zeit kommt nur als Warnung (`log`), ein
 * Lauf ohne die Warnung belegt „kein Frame > 80 ms" im Rahmen der Log-Ringpuffer-Regel
 * (5/s mit dropped-Sammel, observability §4).
 * @param {Array<{at: number, frame: object}>} events
 * @returns {{stats: number, fpsMin: number|null, fpsMedian: number|null, heapMin: number|null,
 *   frameWarnings: number, fpsWarnings: number, rebooted: boolean, checks: Array<{name: string, ok: boolean, detail: string}>}}
 */
export function summarizeSoak(events, minStats = 1) {
  const stats = events.filter((e) => e.frame.type === "stats").map((e) => e.frame);
  const logs = events.filter((e) => e.frame.type === "log").map((e) => e.frame);
  const fps = stats.map((s) => s.fps).sort((a, b) => a - b);
  const heapMin = stats.length ? Math.min(...stats.map((s) => s.heap_min)) : null;
  const median = fps.length ? fps[Math.floor(fps.length / 2)] : null;
  const frameWarnings = logs.filter((l) => l.msg === W3_FRAME_LOG).length;
  const fpsWarnings = logs.filter((l) => l.msg === W3_FPS_LOG).length;
  const rebooted = stats.some((s, i) => i > 0 && s.uptime_s < stats[i - 1].uptime_s);
  const last = stats[stats.length - 1];
  const checks = [
    { name: `stats-Samples ≥ ${minStats}`, ok: stats.length >= minStats, detail: `${stats.length}` },
    { name: `W3: fps min ≥ ${W3_FPS_FLOOR}`, ok: fps.length > 0 && fps[0] >= W3_FPS_FLOOR, detail: `min ${fps[0] ?? "n/a"}` },
    { name: "W3: keine Warnung Frame > 80 ms", ok: frameWarnings === 0, detail: `${frameWarnings} Warnung(en)` },
    { name: "W3: keine Warnung fps < 25", ok: fpsWarnings === 0, detail: `${fpsWarnings} Warnung(en)` },
    { name: `AC-P2-5: heap_min ≥ ${MIN_HEAP_MIN} B`, ok: heapMin !== null && heapMin >= MIN_HEAP_MIN, detail: `${heapMin ?? "n/a"} B` },
    { name: "kein Neustart (uptime monoton)", ok: !rebooted, detail: rebooted ? "uptime gesunken" : "ok" },
    { name: "parse_err = 0, rx_overrun = 0", ok: !!last && last.parse_err === 0 && last.rx_overrun === 0, detail: last ? `parse_err=${last.parse_err}, rx_overrun=${last.rx_overrun}` : "n/a" },
  ];
  return { stats: stats.length, fpsMin: fps[0] ?? null, fpsMedian: median, heapMin, frameWarnings, fpsWarnings, rebooted, checks };
}
