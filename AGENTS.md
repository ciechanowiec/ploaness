# Repository Guidelines

## Project Structure & Module Organization

ploaness is a pnpm workspace publishing five packages that together form an external quality harness for
Payload CMS projects. It requires Node 26+ and pnpm 11+.

- `packages/governance` (`@ploaness/governance`) - every rule, as pure functions with **zero I/O**. This is
  where a rule belongs unless it physically cannot live here.
- `packages/config` (`@ploaness/config`) - the analyzer configurations, plus the
  dependencies on every tool ploaness invokes.
- `packages/assets` (`@ploaness/assets`) - `manifest.tsv` and the bodies of the managed files.
- `packages/cli` (`@ploaness/cli`) - all I/O: the gates, the commands, process invocation.
- `packages/ploaness` (`ploaness`) - the consumer-facing meta package. Re-exports every entry point.
- `it/` - consumer fixtures, deliberately outside the workspace. See `it/README.md`.

The governance/CLI split is the load-bearing one. A rule expressed as a pure function over already-read
strings can be unit-tested exhaustively and cheaply; the same rule expressed as a gate that reads its own
files can only be tested by building a fixture repository. Put the decision in `governance` and leave the
CLI holding nothing but `readFileSync` and a call.

## Build, Test, and Development Commands

- `pnpm run verify` - build, typecheck, lint, and the unit suite with coverage. Run this before finishing.
- `pnpm run it` - packs the five tarballs and runs the consumer fixtures. Run this whenever a rule, the
  scaffolder, or the packaging changes.
- `pnpm run pack:local` - packs the tarballs into `dist-tarballs/` without running the fixtures.

## Self-governance

ploaness cannot run `ploaness verify` on itself: the `preflight` gate hard-requires a declared `payload`
dependency, and ploaness is not a Payload project. That is a deliberate consequence of the Payload-only
scope, not an oversight, and it must not be worked around by weakening `preflight`.

What substitutes for it is stricter in the places that matter: `pnpm run verify` for the harness's own
source, `pnpm run it` for its behaviour as an installed package, and a real consumer project for the gates
that shell out to a toolchain. All three are required before a change is finished.

## Coding Style & Naming Conventions

TypeScript throughout, NodeNext resolution, `verbatimModuleSyntax` and `exactOptionalPropertyTypes` on.
Relative imports carry the `.js` suffix. Prefer explicit return types on exported functions.

Comments explain **why**, never what. A comment that restates the line beneath it is noise; a comment that
records the constraint which forced an unobvious choice is the most valuable thing in the file.

### A value the harness both writes and judges is declared once

The wiring gate checks files that `ploaness init` writes. Whenever both sides need to agree on a literal -
an `extends` specifier, a script body, a hook command - export it from `wiring-policy.ts` and have the rule
and the scaffolder consume the same constant. Two literals that must stay equal will not stay equal; this
has already produced a shipped defect where `init` scaffolded a project that failed the gate.

The same reasoning applies to a rule that must exempt what another rule mandates: derive the exemption from
the mandate rather than restating it. `config-refs` exempts the biome carve-outs by extracting them back
out of `requiredBiomeFiles()`, so adding a carve-out cannot create a contradiction.

## Testing Guidelines

Vitest. Specs live in `packages/*/test/*.spec.ts` and are named for the behaviour, for example
`rejectsATrailingPeriod`. Coverage thresholds are per-file at 80%, measured over `governance` only -
the CLI is I/O and is covered by `it/` instead.

Test the joint, not the value. A spec asserting that a constant equals its own literal proves nothing; a
spec asserting that two modules still agree about that constant catches the drift that actually happens.

Do not treat a failing fixture under `it/` as a broken build: five of the six fixtures are supposed to fail,
each on its own named gate.

## Commit & Pull Request Guidelines

Conventional commits, imperative mood, no trailing period. The type carries no `!` marker: the header
pattern in `commit-message.ts` accepts a type and an optional scope, and nothing else. Pull requests
explain intent and list the verification performed.
