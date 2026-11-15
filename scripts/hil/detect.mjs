/**
 * Board-Erkennung für test:hil (EPIC-P2 T2.8). Rein: die Verzeichnisliste wird
 * injiziert, damit die Auswahl ohne Hardware testbar ist (docs/testing.md §2.2).
 */

export const TTY_RE = /^tty(USB|ACM)\d+$/;

/**
 * @param {Array<{dir: string, name: string}>} entries
 * @returns {string[]} alle Gerätepfade in der Reihenfolge der Eingabe
 */
export function boardPaths(entries) {
  return entries.filter((e) => TTY_RE.test(e.name)).map((e) => `${e.dir}/${e.name}`);
}

/**
 * Wählt das erste Board. Mehrere Treffer werden nicht still gewählt: Der Aufrufer
 * meldet sie, damit man den falschen Port nicht unbemerkt testet.
 * @param {Array<{dir: string, name: string}>} entries
 * @returns {{path: string|null, all: string[]}}
 */
export function pickBoard(entries) {
  const all = boardPaths(entries);
  return { path: all[0] ?? null, all };
}
