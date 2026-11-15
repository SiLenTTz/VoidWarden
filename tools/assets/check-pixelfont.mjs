import { readFileSync } from "node:fs";
const buf = readFileSync("web/public/pixel-font.ttf");
const numTables = buf.readUInt16BE(4);
const dir = {};
for (let i = 0; i < numTables; i++) {
  const o = 12 + i * 16;
  const tag = buf.toString("ascii", o, o + 4).trim();
  dir[tag] = { off: buf.readUInt32BE(o + 8), len: buf.readUInt32BE(o + 12) };
}
const cm = dir.cmap;
const n = buf.readUInt16BE(cm.off + 2);
let sub = 0;
for (let i = 0; i < n; i++) {
  const plat = buf.readUInt16BE(cm.off + 4 + i * 8);
  const enc = buf.readUInt16BE(cm.off + 6 + i * 8);
  if (plat === 3 && enc === 1) sub = cm.off + buf.readUInt32BE(cm.off + 8 + i * 8);
}
function gidOf(cp) {
  const segCount = buf.readUInt16BE(sub + 6) / 2;
  for (let i = 0; i < segCount; i++) {
    const end = buf.readUInt16BE(sub + 14 + i * 2);
    if (cp <= end) {
      const start = buf.readUInt16BE(sub + 16 + segCount * 2 + i * 2);
      if (cp < start) return 0;
      let delta = buf.readInt16BE(sub + 16 + segCount * 4 + i * 2);
      let gid = cp + delta;
      gid = ((gid % 0x10000) + 0x10000) % 0x10000;
      return gid;
    }
  }
  return 0;
}
const head = dir.head;
const locFmt = buf.readInt16BE(head.off + 50);
const loca = dir.loca;
const glyf = dir.glyf;
function glyphOffset(i) {
  const v = locFmt === 0 ? buf.readUInt16BE(loca.off + i * 2) * 2 : buf.readUInt32BE(loca.off + i * 4);
  return glyf.off + v;
}
/** Liefert die Pixel-Menge (col,row) einer Glyphe aus dem TTF. */
function pixelsOf(gid) {
  const gs = glyphOffset(gid);
  const ge = glyphOffset(gid + 1);
  const ncont = buf.readInt16BE(gs);
  if (ncont <= 0) return new Set(); // z.B. Space: korrekt 0 Pixel
  const PX = 128, BASE = 896;
  const out = new Set();
  let off = gs + 10 + 2 * ncont + 2; // nach endPts + instructionLength(0)
  const endPts = [];
  for (let i = 0; i < ncont; i++) endPts.push(buf.readUInt16BE(gs + 10 + i * 2));
  const npts = endPts[ncont - 1] + 1;
  off += npts; // Flags überspringen
  const xs = [];
  let prev = 0;
  for (let i = 0; i < npts; i++) { prev += buf.readInt16BE(off); off += 2; xs.push(prev); }
  const ys = [];
  prev = 0;
  for (let i = 0; i < npts; i++) { prev += buf.readInt16BE(off); off += 2; ys.push(prev); }
  let start = 0;
  for (let e of endPts) {
    const cx = xs.slice(start, e + 1), cy = ys.slice(start, e + 1);
    const x0 = Math.min(...cx), y0 = Math.max(...cy);
    out.add(`${Math.round(x0 / PX)},${Math.round((BASE - y0) / PX)}`);
    start = e + 1;
  }
  if (off !== ge - (ge - gs) % 4 && off > ge) throw new Error("overrun");
  return out;
}
// TS-Daten als Wahrheit
const ts = readFileSync("web/src/pixelfont-data.g.ts", "utf8");
const entries = [...ts.matchAll(/\{ cp: "(.)", cols: \[([\d, ]+)\] \}/g)].map((mm) => [mm[1], mm[2].split(", ").map(Number)]);
let ok = 0;
const bad = [];
for (const [ch, cols] of entries) {
  const expected = new Set();
  for (let x = 0; x < 5; x++) for (let y = 0; y < 7; y++) if ((cols[x] >> y) & 1) expected.add(`${x},${y}`);
  const gid = gidOf(ch.codePointAt(0));
  const got = pixelsOf(gid);
  if (got !== null && got.size === expected.size && [...expected].every((p) => got.has(p))) ok++;
  else bad.push([ch, got === null ? "null" : `${got.size} vs ${expected.size}`]);
}
console.log(`pixel-identical: ${ok}/${entries.length}; bad: ${JSON.stringify(bad.slice(0, 8))}`);
// Klein-Mapping
const gA = pixelsOf(gidOf(0x41)), ga = pixelsOf(gidOf(0x61));
console.log("a==A pixels:", gA !== null && ga !== null && gA.size === ga.size && [...gA].every((p) => ga.has(p)));
console.log("gids:", { A: gidOf(0x41), a: gidOf(0x61), "ä": gidOf(0xe4), "Ä": gidOf(0xc4), "3": gidOf(0x33), "ß": gidOf(0xdf) });
