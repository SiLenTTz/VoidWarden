#!/usr/bin/env node
/** npm run check:assets: Linter über assets/nyx/ (EPIC-P5 T5.5), Teil von npm run gate. */
import { existsSync, readFileSync } from "node:fs";
import { PNG } from "pngjs";
import { applyExceptions, lintAtlas } from "./lint.mjs";

const png = PNG.sync.read(readFileSync(process.argv[2] ?? "assets/nyx/nyx-atlas.png"));
const meta = JSON.parse(readFileSync(process.argv[3] ?? "assets/nyx/nyx-atlas.json", "utf8"));
const excPath = process.argv[4] ?? "assets/nyx/lint-exceptions.json";
const exceptions = existsSync(excPath) ? JSON.parse(readFileSync(excPath, "utf8")) : [];
const { violations, waived, stale } = applyExceptions(lintAtlas(png, meta), exceptions);
for (const w of waived) console.warn(`WARN [${w.rule}] ${w.message} — Ausnahme: ${w.reason}`);
for (const v of violations) console.error(`FAIL [${v.rule}] ${v.message}`);
for (const s of stale) console.error(`FAIL [exception] veraltete Ausnahme ${s.rule} "${s.prefix}" (Verstoß nicht mehr vorhanden oder ohne Begründung)`);
const bad = violations.length + stale.length;
console.log(bad ? `check:assets: ${bad} Problem(e)` : `check:assets: ${meta.frames.length} Frames, ${waived.length} begründete Ausnahme(n)`);
process.exit(bad ? 1 : 0);
