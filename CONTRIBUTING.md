# Contributing to VoidWarden

VoidWarden lives on two hard boundaries: the **link protocol** (`protocol/`)
between companion and firmware, and the **hub boundary** to AncientVoid.
Respect them and contributions stay small and local. The rules below apply
to humans and coding agents alike.

## Where things live

| You want to … | Go to |
|---|---|
| Add a frame/field to the link | `protocol/` (schema + fixtures) + `docs/spec.md` §4 + ADR-0002 |
| Know what is being built, in which order | the roadmap section in the README (epics are tracked internally) |
| Hub integration, aggregation, serial bridge | `companion/` |
| Renderer, state machine, touch | `firmware/` |
| Nyx pixel art | `assets/` + `tools/assets/` (palette ≤ 12 colors) |
| Testing / measurement | `docs/testing.md`, `docs/observability.md` |
| Technology decisions | `docs/adr/` |

## Required for every contribution

1. `npm test && npm run lint && npm run typecheck` — green. For firmware
   changes additionally `npm run test:fw && npm run build:fw`, for protocol
   changes `npm run check:protocol`.
2. New behavior: first a test that fails without the change.
3. Every feature references a quality bar (`docs/spec.md` §9, W1–W9) and an
   epic — no feature without both.
4. No secrets, no raw logs, no serial numbers. `data/` and
   `voidwarden.config.json` stay git-ignored.
5. Update spec, ADR and epic in the same commit when behavior changes.
6. Name visible skips (no board, no hub) in the PR; a skip never counts as
   a pass.

## Protocol stability

`protocol/` is the shared contract. Additive fields: fixture + spec update,
no version bump (the firmware ignores and counts unknowns). Incompatible
changes: ADR + `v` bump + transition rule. Commit protocol changes separately
from implementations.

## Commits / PRs

- **Commit notation:** `<risk> <intent> <area>: <sentence>`, e.g.
  `^ F companion: send heartbeat every 5 s`. Criteria in
  [`docs/commit-notation.md`](docs/commit-notation.md). The `commit-msg` hook
  and `npm run check:commits` enforce it; it applies to PR titles, too. Hooks
  are activated by `npm install` (`scripts/setup-git.mjs` sets
  `core.hooksPath=.githooks` and `commit.template=.gitmessage`).
- **pre-push hook:** `npm run lint` and `npm run typecheck`; full test set via
  `npm run gate`.
- One topic per PR; protocol changes separate from implementation.
- There is no CI pipeline yet — the **local** `npm run gate` is what counts.
- Merge via GitHub PR (squash or merge commit, either is fine), never commit
  directly to `main`.

## Git hygiene

`main` is the only long-lived branch; everything else is short-lived.

| Rule | Detail |
|---|---|
| Naming | `feat/<scope>-<slug>` · `fix/<problem>` · `docs/<scope>` · `test/<scope>` · `ops/<scope>` |
| Lifetime | One branch = one task = one PR; delete locally + remotely after merge |
| PR target | `main`; epic chains stay short-lived |
| No zombies | `git fetch --prune`; close draft PRs without a purpose |

Clean history: one behavior change per commit, no force-push, no history
rewrite of published commits.

## Note on languages

Code, schemas and logs are English. Most engineering docs (`docs/`, `epics/`)
are currently German — translations are welcome.
