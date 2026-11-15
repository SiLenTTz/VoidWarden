/** Zeitzonen-Offset für `utc_offset_min` (EPIC-P4 T4.7, ADR-0007): Minuten Ost von UTC. */

/** Offset der Zeitzone `timeZone` (Default: Systemzone) zum Zeitpunkt `at`, DST-korrekt über Intl. */
export function utcOffsetMin(at: Date, timeZone?: string): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  });
  const p: Record<string, number> = {};
  for (const part of fmt.formatToParts(at)) if (part.type !== "literal") p[part.type] = Number(part.value);
  // Wandzeit der Zone als UTC gelesen, minus der echte UTC-Zeitpunkt (auf Minuten abgerundet).
  const asUtc = Date.UTC(p["year"] as number, (p["month"] as number) - 1, p["day"] as number, p["hour"] as number, p["minute"] as number, p["second"] as number);
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60000);
}
