#!/usr/bin/env node
/**
 * Host-Vorschau der Nyx-Animationen (EPIC-P2, Asset-Import v2): kompiliert den echten
 * Renderer (firmware/src/render) nativ, rendert alle Frames aller sieben Zustände mit
 * den Augenfarben der Firmware und legt ein Blatt (eine Zeile je Zustand) sowie je
 * Zustand ein animiertes Vorschaubild-Set unter data/preview/ ab.
 *
 * Grenze: zeigt Pixel und Frame-Dauer, nicht das Panel (Gamma, Helligkeit, Glitch-Übergang
 * und fps zeigt nur das Board). Braucht einen C++-Compiler (c++/g++/clang++).
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PNG } from "pngjs";

const W = 192;
const H = 192;
const SCALE = Number(process.argv[2] ?? 1);
const OUT_DIR = "data/preview";

const dir = mkdtempSync(join(tmpdir(), "vw-preview-"));
try {
  const bin = join(dir, "nyx_dump");
  const cxx = ["c++", "g++", "clang++"].find((c) => spawnSync(c, ["--version"]).status === 0);
  if (!cxx) throw new Error("kein C++-Compiler gefunden (c++/g++/clang++)");
  const cc = spawnSync(cxx, ["-std=c++17", "-O1", "-Ifirmware/src", "tools/preview/nyx_dump.cpp", "firmware/src/state/bubble_view.cpp", "-o", bin], {
    encoding: "utf8",
  });
  if (cc.status !== 0) throw new Error(`Compiler-Fehler:\n${cc.stderr}`);
  const run = spawnSync(bin, ["firmware/data/nyx.spr"], { maxBuffer: 1 << 28 });
  if (run.status !== 0) throw new Error(`nyx_dump: ${run.stderr.toString()} (zuerst: npm run assets)`);

  // Strom parsen: "<state> <frames> <ms>\n" gefolgt von frames × W×H×2 Byte
  const buf = run.stdout;
  let pos = 0;
  const states = [];
  while (pos < buf.length) {
    const nl = buf.indexOf(0x0a, pos);
    const [name, frames, ms] = buf.toString("ascii", pos, nl).split(" ");
    pos = nl + 1;
    const list = [];
    for (let i = 0; i < Number(frames); i++) {
      list.push(buf.subarray(pos, pos + W * H * 2));
      pos += W * H * 2;
    }
    states.push({ name, ms: Number(ms), frames: list });
  }

  const toRgba = (raw, png, ox, oy) => {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const v = raw.readUInt16BE((y * W + x) * 2);
        const r = (((v >> 11) & 31) * 255) / 31;
        const g = (((v >> 5) & 63) * 255) / 63;
        const b = ((v & 31) * 255) / 31;
        for (let dy = 0; dy < SCALE; dy++) {
          for (let dx = 0; dx < SCALE; dx++) {
            const p = ((oy + y * SCALE + dy) * png.width + (ox + x * SCALE + dx)) * 4;
            png.data[p] = r;
            png.data[p + 1] = g;
            png.data[p + 2] = b;
            png.data[p + 3] = 255;
          }
        }
      }
    }
  };

  mkdirSync(OUT_DIR, { recursive: true });
  const cols = Math.max(...states.map((s) => s.frames.length));
  const sheet = new PNG({ width: cols * W * SCALE, height: states.length * H * SCALE });
  states.forEach((s, row) => {
    s.frames.forEach((raw, col) => toRgba(raw, sheet, col * W * SCALE, row * H * SCALE));
    // Einzelbilder je Zustand für Bildbetrachter/ffmpeg (Dauer steht im Dateinamen der ersten Datei)
    s.frames.forEach((raw, i) => {
      const one = new PNG({ width: W * SCALE, height: H * SCALE });
      toRgba(raw, one, 0, 0);
      writeFileSync(join(OUT_DIR, `${s.name}-${i}.png`), PNG.sync.write(one));
    });
  });
  writeFileSync(join(OUT_DIR, "nyx-states.png"), PNG.sync.write(sheet));
  for (const s of states) console.log(`${s.name.padEnd(17)} ${s.frames.length} Frames, ${s.ms} ms/Frame`);
  console.log(`Blatt: ${OUT_DIR}/nyx-states.png (Zeilen = Zustände, Spalten = Frames); Einzelbilder ${OUT_DIR}/<zustand>-<n>.png`);
} catch (err) {
  console.error(`FAIL: ${err.message}`);
  process.exitCode = 1;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
