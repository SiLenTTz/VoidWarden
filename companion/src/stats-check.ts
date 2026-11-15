/**
 * Schwellen für `stats`-Frames der Firmware (observability §4). fps 0 heißt „kein Messfenster“
 * (die Firmware zeichnet nur bei Änderung, ein ruhiges Bild liefert keine Bilder): das ist
 * keine Unterschreitung von W3, die Firmware meldet echte Einbrüche selbst als `fps_unter_25`.
 */
export interface StatsLike {
  rx_overrun: number;
  heap_free: number;
  fps: number;
}

export interface StatsWarning {
  level: "warn" | "error";
  msg: string;
  fields: Record<string, number>;
}

export function checkStats(frame: StatsLike): StatsWarning[] {
  const out: StatsWarning[] = [];
  if (frame.rx_overrun > 0) out.push({ level: "error", msg: "firmware:rx_overrun", fields: { count: frame.rx_overrun } });
  if (frame.heap_free < 20000) out.push({ level: "warn", msg: "firmware:heap_low", fields: { heap_free: frame.heap_free } });
  if (frame.fps > 0 && frame.fps < 25) out.push({ level: "warn", msg: "firmware:fps_low", fields: { fps: frame.fps } });
  return out;
}
