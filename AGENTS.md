# Repository Guidelines

## Repository Contract

Follow the repository contract from general to specific:

1. Follow `README-guideline-software-project.adoc`.
2. Follow the project-owned instructions in this file.

Both layers are binding. The project-owned instructions may strengthen but never weaken the software-project guideline.

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
- `it/` - consumer fixtures, deliberately outside the workspace. See `it/verify.sh`.

The governance/CLI split is the load-bearing one. A rule expressed as a pure function over already-read
strings can be unit-tested exhaustively and cheaply; the same rule expressed as a gate that reads its own
files can only be tested by building a fixture repository. Put the decision in `governance` and leave the
CLI holding nothing but `readFileSync` and a call.

## Build, Test, and Development Commands

- `pnpm run verify` - the verification command: `scripts/verify.sh`. Run this before finishing.
- `pnpm run verify:fast` - build, typecheck, lint, and the unit suite only. A declared subset for
  everyday work; it is not a verdict.
- `pnpm run it` - runs the consumer fixtures against the packed tarballs. Run this whenever a rule, the
  scaffolder, or the packaging changes. Run `pnpm run pack:local` first.
- `pnpm run pack:local` - packs the tarballs into `dist-tarballs/` without running the fixtures.
- `pnpm run format` - applies the formatting `pnpm run lint` judges.
- `pnpm run lint:eslint` - the type-aware pass, part of `pnpm run verify`.

## Self-governance

ploaness cannot run `ploaness verify` on itself: the `preflight` gate hard-requires a declared `payload`
dependency, and ploaness is not a Payload project. That is a deliberate consequence of the Payload-only
scope, not an oversight, and it must not be worked around by weakening `preflight`.

What substitutes for it reimplements no rule. `ploaness gate <id>` builds its context from the working
directory and never runs `preflight`, so every gate whose rule is about a repository's shape rather than
about Payload runs here unchanged. `scripts/verify.sh` is that list, and `pnpm run verify` runs it:
`biome-schema`, `conventions`, `editorconfig`, `suppressions`, `config-refs`, `docs`, `skills`,
`image-assets`, `licenses`, `vulnerabilities`, `install-scripts`, `deps`, `actions`, `secrets`,
`require-full-history`, `commit-history`, and `linear-history`, around the build, the type check, the
lint, and the unit suite.

Three analyzers the shipped gates point at a Payload layout run here against this workspace instead,
because only their globs are project-shaped: dependency-cruiser through
`packages/config/dependency-cruiser-repo.json`, knip through `knip-repo.json`, and `type-coverage` over
`tsconfig.lint.json`. The framework-neutral half of the architecture contract lives in
`dependency-cruiser-core.json` and is shared with what a consumer receives, for the reason
`eslint-core.js` exists. Each `-repo` config is named that way because `.dependency-cruiser.json` and
`knip.json` are FORBIDDEN paths in a governed project; a file with either name here would read as a
counterexample.

Two more checks are about files a governed project has no equivalent of. `scripts/lib/check-asset-bodies.sh`
pipes every TypeScript asset body back through Biome under the path it will occupy in a consumer,
because the `.asset` suffix hides the language from every tool that would otherwise read it and the one
shipped body that is code once reached a consumer unformatted. And shellcheck reads the shell scripts
that implement these checks, which the standard makes source code of this repository: the analyzer runs
in a digest-pinned image declared in `toolchain-pins.ts` beside the three the gates use.

What remains genuinely inapplicable is `preflight`, `wiring`, and `assets`, which judge a consumer's
installation of ploaness; `payload-generated` and `payload-rules`, which are about Payload; `css`,
`docker`, `bundle`, and `e2e`, for which this repository has no stylesheet, Dockerfile, client bundle,
or browser. Everything else is on. A gate that ploaness cannot turn on itself is a gate this repository
is not held to, so prefer adding one here over asserting that it cannot apply - `arch` was absent on
that reasoning, and a module cycle grew in `packages/governance` where nothing was looking.

A tracked-tree fingerprint brackets the whole run. A verification that rewrote a source file would
describe a tree nobody committed, so `build` regenerating a stale asset body is reported as a failure to
commit rather than silently repaired.

Three legs are required before a change is finished: `pnpm run verify` for the harness's own source,
`pnpm run it` for its behaviour as an installed package, and a real consumer project for the gates that
shell out to a toolchain.

### The repository is linted by the config it publishes

`packages/config/eslint.js` carries every cap and ban the governing standard states, and for a long
time this repository never ran it on itself. The framework-neutral half now lives in
`packages/config/eslint-core.js`, shared by the shipped config and by the root `eslint.config.mjs`, so
neither restates a rule; only the globs differ, which is the one genuinely repository-shaped part.
`tsconfig.lint.json` puts the specs in a project, so a type-aware pass can read them and the compiler
checks them too.

Turning it on reported 495 findings and clearing them changed real code: the character scanners became
folds and recursions, the imperative accumulators became `flatMap`, every bare number acquired a name,
and the two configuration rules that proposed methods the `lib` target does not carry were turned off
rather than obeyed. Three of those findings were defects rather than style - a suppression comment
wrapped onto a second line had silently disarmed itself, a boolean-returning function was named as
though it returned data, and `.filter(fn)` over `git ls-files` crashed on a symlink.

Do not clear a new finding with a suppression while the budget is the thing standing between this
repository and the ceiling. `ploaness gate suppressions` reports where it stands.

Note what the ceiling does NOT count: it measures files whose extension is code, so a shell script's
`# shellcheck disable=` is free. Resolve a shell finding structurally rather than by directive - that is
why the asset-body check is a script rather than a function, and why the fixture mutations are programs
in `it/lib/` rather than arguments to `node -e`.

### The suite runs under the guard it ships

`packages/config/vitest-setup.js` is loaded ahead of every other setup file, here and in a consumer. It
installs the network guard - `net.Socket.prototype.connect`, the DNS lookups, and the resolver family,
all made non-writable and non-configurable so a spec cannot put the originals back - and the shipped
`sequence` block shuffles the suite under a fixed seed. Both were prose in the agent guide until they
were checks, and `README-guideline-software-project.adoc` says a rule automation can verify reliably
belongs in a check rather than in an instruction file.

That file may import node builtins and `@ploaness/governance`, and NOTHING else. It lives inside
`node_modules/@ploaness/config`, so a `vitest`, `fast-check`, or `@testing-library/*` reached from there
is the harness's copy rather than the project's: a hook, a matcher, or a global seed registered against
one of those attaches to a module instance the suite never loads, and fails by doing nothing. Resolving
from the project root does not rescue it either, because that yields a package's CommonJS entry while
the suite loads its ESM one. This is why the fast-check seed stays in a project's own `vitest.setup.ts`
and why `NO_FAST_CHECK_SEED` says whose job it is instead of claiming ploaness has done it.

Every decision the guard makes is in `packages/governance/src/network-policy.ts`, where it can be
unit-tested against the three `connect` overloads without opening a socket. What is left in the setup
file is the interception, which is the one part that cannot be pure.

### Test code and the two measurements it is not held to

Test code passes the same static-analysis checks as production code: tsc at full strictness, every
ESLint rule, and the coverage floors. Two measurements are deliberately not applied to it, each for a
reason about what the measurement means rather than about convenience.

Type coverage, at `--strict`, counts every type assertion as uncovered - and a test exists to construct
inputs the production types cannot express. A Payload access predicate takes a full `PayloadRequest`, so
asserting a partial one is the correct way to test the predicate; reaching 100% would mean building
framework objects nobody reads. The bare-number ban is off in tests for the same kind of reason: a
test's expected value IS its specification, and naming it moves the specification away from the
assertion that reads it.

Everything else that was relaxed for tests has been turned back on, including the size caps, the
explicitness rules, and the immutability rules.

### The one asset that is executable

Every other managed file is a configuration, read by a tool. The accessibility sweep, whose body is
`packages/assets/files/tests/e2e/a11y.e2e.spec.ts.asset`, is a spec that runs, and it is managed for the
same reason a rule is: a check a project can edit is not a rule. Three consequences follow, and each is
handled where it arises rather than waived.

A consumer cannot remove a suppression inside a file it does not own, so the suppressions gate leaves
managed paths out of both the count and the line total. Counting them would spend a fifth of a small
project's whole allowance on a decision the project never made.

`ploaness` is not a Payload application and has no browser to drive, so this body has no root file to
pair with and is listed in `ASSET_AUTHORED_PATHS`. Nothing here compiles it. What proves it is the third
verification leg: a real consumer runs it, which is the reason that leg exists.

Shipping a spec makes the end-to-end suite mandatory, so `playwright.config.ts` joined the files the
wiring gate requires as a bare re-export, and the `e2e` gate no longer reports a pass for a project that
declares no suite.

### Roles this repository declares

The `ploaness` key of `package.json` carries two exclusions, each a role rather than a convenience:

- `.vale/styles/**` is exempt from the typography ban because those files are Vale detector definitions
  whose content *is* the banned character. It is the same self-reference `banned-typography.ts` solves
  by naming characters as code points.
- The JavaScript allowlist covers the analyzer configs and package entry shims. An ESLint flat config
  and a `bin` shim are loaded as JavaScript by the tools that read them and cannot be TypeScript. Both
  patterns name the two directories rather than listing filenames: an enumeration is a second copy of
  what the directory already contains, and shipping the Playwright entry point failed the conventions
  gate the moment the file was tracked because the list had not been extended with it.

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
`rejectsATrailingPeriod`. Coverage thresholds are per-file at 80%, measured over `governance` only.
That exclusion is a **file role**, not a convenience: `packages/cli` is the I/O adapter layer, every
module of which exists to read a file or start a process and hand the result to a pure rule, and it is
exercised as an installed package by `it/`. A rule that could live in `governance` and was put in the
CLI to escape measurement is a defect, not an exclusion.

A test fails when the behaviour its name states is removed from the code under test. No check verifies
this reliably, so it is stated here and an inspection decides it. The same is true of the ban on
attributing a commit to an AI agent: the check knows the markers it knows, and a marker it does not yet
know is still a violation.

Test the joint, not the value. A spec asserting that a constant equals its own literal proves nothing; a
spec asserting that two modules still agree about that constant catches the drift that actually happens.

Do not treat a failing fixture under `it/` as a broken build: most fixtures are supposed to fail, each on
its own named gate. `it/verify.sh` defines them, and each case carries the reason it exists.

## Commit & Pull Request Guidelines

Conventional commits, imperative mood, no trailing period. The type carries no `!` marker: the header
pattern in `commit-message.ts` accepts a type and an optional scope, and nothing else. There is no
`revert` type - the governing standard does not list one, so a revert is described by what it does. A
junk word (`wip`, `tmp`, `temp`, `misc`, `stuff`, `asdf`, `fixup`) is rejected anywhere in the subject,
not only as its first word. Pull requests
explain intent and list the verification performed.
