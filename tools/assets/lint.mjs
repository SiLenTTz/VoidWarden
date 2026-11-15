/**
 * Asset-Linter für den Nyx-Atlas (EPIC-P5 T5.5, AC-P5-5, W14). Rein: bekommt das
 * gelesene PNG (pngjs-Form) und das Atlas-JSON, liefert Verstöße je Regel. Jede Regel hat ein
 * rotes Fixture in tests/assets-lint.test.mjs.
 */
export const ALLOWED_SIZES = [64];
export const REQUIRED_STATES = ["idle", "listening", "approval_pending", "executing", "success", "error", "offline"];
/** Zustände ohne Schleife: Nahtprüfung entfällt. */
export const ONE_SHOT_STATES = ["success", "error"];
export const MAX_BODY_COLORS = 12;
export const MAX_IMAGE_BYTES = 1_200_000;
export const EYE_BAND_ROWS = 8;
export const EYE_DRIFT_PX = 3;
export const SEAM_MAX_PX = 2;
export const FOOT_ROW_SPAN_MAX = 3;
const MARKERS = new Set([0xff00ff, 0xc000c0, 0x800080]);

const rgb = (d, i) => (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];

/** Kennzahlen je Frame: Deckpixel, unterste Zeile, Schwerpunkt, Randberührung, Marker-Box. */
function frameStats(png, fw, fh, f) {
  const st = { opaque: 0, lowest: -1, sx: 0, sy: 0, border: false, markers: [], body: new Set() };
  for (let y = 0; y < fh; y++) {
    for (let x = 0; x < fw; x++) {
      const i = (y * png.width + f * fw + x) << 2;
      if (png.data[i + 3] === 0) continue;
      st.opaque++;
      st.sx += x;
      st.sy += y;
      if (y > st.lowest) st.lowest = y;
      if (x === 0 || y === 0 || x === fw - 1 || y === fh - 1) st.border = true;
      const c = rgb(png.data, i);
      if (MARKERS.has(c)) st.markers.push([x, y]);
      else st.body.add(c);
    }
  }
  return st;
}

/**
 * @param {{width: number, height: number, data: Uint8Array}} png
 * @param {{fw: number, fh: number, frames: Array<{state: string, index: number}>}} meta
 * @returns {Array<{rule: string, message: string}>}
 */
export function lintAtlas(png, meta) {
  const out = [];
  const add = (rule, message) => out.push({ rule, message });
  const { fw, fh, frames } = meta;

  if (fw !== fh || !ALLOWED_SIZES.includes(fw)) add("size", `Frame ${fw}x${fh} nicht erlaubt (erlaubt: ${ALLOWED_SIZES.join(", ")}, quadratisch)`);
  if (png.width !== fw * frames.length || png.height !== fh) {
    add("size", `PNG ${png.width}x${png.height} passt nicht zu ${frames.length} Frames à ${fw}x${fh}`);
    return out; // weitere Regeln würden außerhalb des Bildes lesen
  }

  const states = new Set(frames.map((fr) => fr.state));
  for (const s of REQUIRED_STATES) if (!states.has(s)) add("tags", `Pflicht-Zustand ${s} fehlt`);
  for (const s of states) if (!REQUIRED_STATES.includes(s)) add("tags", `Unbekannter Zustand ${s}`);

  const stats = frames.map((_, f) => frameStats(png, fw, fh, f));
  const bodyAll = new Set();
  stats.forEach((st, f) => {
    const label = `${frames[f].state}[${frames[f].index}]`;
    if (st.opaque === 0) add("empty", `${label}: leerer Frame`);
    if (st.border) add("border", `${label}: opake Pixel am Rand des Frames (abgeschnitten?)`);
    st.body.forEach((c) => bodyAll.add(c));
  });
  if (bodyAll.size > MAX_BODY_COLORS) add("palette", `${bodyAll.size} Körperfarben, erlaubt sind ${MAX_BODY_COLORS}`);

  // Marker: Zeilenband und Deckung (Augenmaske) über alle Frames mit Markern
  const withMarkers = stats.map((st, f) => ({ st, f })).filter((e) => e.st.markers.length > 0);
  const ys = withMarkers.flatMap((e) => e.st.markers.map((m) => m[1]));
  if (ys.length && Math.max(...ys) - Math.min(...ys) + 1 > EYE_BAND_ROWS) {
    add("eyes", `Marker über ${Math.max(...ys) - Math.min(...ys) + 1} Zeilen, erlaubt sind ${EYE_BAND_ROWS} (nur in den Augen)`);
  }
  if (withMarkers.length) {
    const ref = withMarkers[0].st.markers;
    const box = [Math.min(...ref.map((m) => m[0])), Math.max(...ref.map((m) => m[0])), Math.min(...ref.map((m) => m[1])), Math.max(...ref.map((m) => m[1]))];
    for (const { st, f } of withMarkers) {
      const drift = st.markers.some((m) => m[0] < box[0] - EYE_DRIFT_PX || m[0] > box[1] + EYE_DRIFT_PX || m[1] < box[2] - EYE_DRIFT_PX || m[1] > box[3] + EYE_DRIFT_PX);
      if (drift) add("eyes", `${frames[f].state}[${frames[f].index}]: Augenmarker weichen von der Augenmaske ab (> ${EYE_DRIFT_PX} px)`);
    }
  }

  // Standpunkt/Pivot je Zustand und Loop-Naht
  for (const s of states) {
    const idx = frames.map((fr, f) => (fr.state === s ? f : -1)).filter((f) => f >= 0);
    const feet = idx.map((f) => stats[f].lowest);
    if (Math.max(...feet) - Math.min(...feet) > FOOT_ROW_SPAN_MAX) {
      add("pivot", `${s}: Standpunkt springt um ${Math.max(...feet) - Math.min(...feet)} px (erlaubt ${FOOT_ROW_SPAN_MAX})`);
    }
    if (ONE_SHOT_STATES.includes(s) || idx.length < 2) continue;
    const a = stats[idx[0]];
    const b = stats[idx[idx.length - 1]];
    if (a.opaque === 0 || b.opaque === 0) continue;
    const dx = Math.abs(a.sx / a.opaque - b.sx / b.opaque);
    const dy = Math.abs(a.sy / a.opaque - b.sy / b.opaque);
    if (dx > SEAM_MAX_PX || dy > SEAM_MAX_PX) add("seam", `${s}: Loop-Naht springt (dx ${dx.toFixed(1)}, dy ${dy.toFixed(1)} px, erlaubt ${SEAM_MAX_PX})`);
  }

  const bytes = (frames.length * fw * fh) / 2;
  if (bytes > MAX_IMAGE_BYTES) add("size", `Pixeldaten ${bytes} B über ${MAX_IMAGE_BYTES} B`);
  return out;
}

/**
 * Bekannte, begründete Ausnahmen (assets/nyx/lint-exceptions.json). Eine Ausnahme gilt für
 * Regel + Textanfang der Meldung. Verstöße ohne Ausnahme bleiben rot; eine Ausnahme ohne Treffer
 * (Kunst wurde korrigiert) ist veraltet und ebenfalls rot, damit sie nicht liegen bleibt.
 * @param {Array<{rule: string, message: string}>} issues
 * @param {Array<{rule: string, prefix: string, reason: string}>} exceptions
 */
export function applyExceptions(issues, exceptions) {
  const used = new Set();
  const violations = [];
  const waived = [];
  for (const issue of issues) {
    const hit = exceptions.findIndex((e) => e.rule === issue.rule && issue.message.startsWith(e.prefix));
    if (hit >= 0 && exceptions[hit].reason) {
      used.add(hit);
      waived.push({ ...issue, reason: exceptions[hit].reason });
    } else {
      violations.push(issue);
    }
  }
  const stale = exceptions.filter((_, i) => !used.has(i));
  return { violations, waived, stale };
}
