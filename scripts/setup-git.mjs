#!/usr/bin/env node
/**
 * `npm install` (prepare): activate this repo's git hooks and commit template
 * (docs/commit-notation.md, EPIC-P0 T0.2). A copy without .git (git archive)
 * has nothing to set up.
 */
import { execFileSync } from "node:child_process";

try {
  execFileSync("git", ["rev-parse", "--git-dir"], { stdio: "ignore" });
} catch {
  process.exit(0);
}
execFileSync("git", ["config", "core.hooksPath", ".githooks"]);
execFileSync("git", ["config", "commit.template", ".gitmessage"]);
