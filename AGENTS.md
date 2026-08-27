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
about Payload runs here unchanged.

`preflight` now asks whether the REPOSITORY contains a Payload member rather than whether one directory
declares Payload, which is the same refusal one level up: a workspace legitimately holds packages that
are not applications, and refusing each of those would refuse the repository they belong to. ploaness
still has no Payload member, so it still cannot run `ploaness verify` on itself. That is unchanged and
deliberate. What did change is that the list below is no longer trusted to be complete on its own: a gate
declares its scope in the registry, and `scripts/verify.sh` asks `ploaness gates --scope=repository
--ids` whether it runs every one of them. A gate in neither the run list nor the declared-inapplicable
list fails the check, which is the failure that let `arch` sit unrun while a cycle grew behind it - and
it found `docker` missing the first time it ran. The ORDER stays this script's own, because it is
ordering this repository's run rather than a Payload project's. `scripts/verify.sh` is that list, and
`pnpm run verify` runs it:
`biome-schema`, `conventions`, `tailwind-tokens`, `editorconfig`, `suppressions`, `config-refs`,
`docs`, `skills`, `image-assets`, `licenses`, `vulnerabilities`, `install-scripts`, `deps`, `actions`,
`secrets`, `docker`, `require-full-history`, `commit-history`, and `linear-history`, around the build, the type
check, the lint, and the unit suite. That order is the script's own - the reads that need nothing but the tree
first, then the ones that need a registry or a container - and is not the order `gates.ts` runs them in,
which is ordering a Payload project's run rather than this one.

Three analyzers the shipped gates point at a Payload layout run here against this workspace instead,
because only their globs are project-shaped: dependency-cruiser through
`packages/config/dependency-cruiser-repo.json`, knip through `packages/config/knip-repo.json`, and
`type-coverage` over `tsconfig.lint.json`. The framework-neutral half of the architecture contract lives in
`dependency-cruiser-core.json` and is shared with what a consumer receives, for the reason
`eslint-core.ts` exists. Each `-repo` config is named that way because `.dependency-cruiser.json` and
`knip.json` are FORBIDDEN paths in a governed project; a file with either name here would read as a
counterexample.

A third check is about the artefacts themselves. `scripts/lib/check-packaging.sh` runs `publint` and
`attw` over the packed tarballs, because an `exports` map is data no compiler resolves and no linter
parses: a subpath naming a file the tarball does not carry, or one whose declarations no resolution mode
can reach, is invisible from inside the tree and lands as a broken install outside it. It found
`@ploaness/assets` shipping a `./files/` subpath - a trailing-slash target node REMOVED rather than
deprecated, so the export resolved for nobody. `--profile esm-only` states a role rather than silencing
findings one at a time: every package here is `"type": "module"` on `node >= 26`, so the two resolutions
it drops describe consumers these packages do not have. It cannot be a gate, because a gate ships to
Payload projects and an application has no tarball to read.

Two more checks are about files a governed project has no equivalent of. `scripts/lib/check-asset-bodies.sh`
pipes every TypeScript asset body back through Biome under the path it will occupy in a consumer,
because the `.asset` suffix hides the language from every tool that would otherwise read it and the one
shipped body that is code once reached a consumer unformatted. And shellcheck reads the shell scripts
that implement these checks, which the standard makes source code of this repository: the analyzer runs
in a digest-pinned image declared in `toolchain-pins.ts` beside the three the gates use.

Each of those four is declared as `<repo>:<tag>@sha256:<digest>`, and both halves are load-bearing. The
digest is what makes a verdict reproducible; the tag is what the `deps` gate reads to ask the registry
whether a newer release exists. The tag used to be a comment, which no check could read - and two of the
four had gone stale there, the hadolint pin commented `2.14.0` while carrying the bytes of `v2.15.1` and
the actionlint pin commented `1.7.7` while carrying `1.7.12`. Nothing was wrong with the pins; the prose
beside them was wrong, and only a person reading carefully could have noticed.

An image update is reported and never fails, because the freshness bound is a claim about a release line
and a tag is not required to carry one. What does fail is a registry that cannot say what is current,
which is the same fail-closed rule the coordinate half already followed. The decisions - what a stable
tag is, which tags share the pinned tag's scheme, which is newest - are in
`packages/governance/src/container-freshness.ts`, so they are unit-tested against tag lists no live
registry would produce on demand; `packages/cli/src/checks/images.ts` holds the HTTP and nothing else.

What remains genuinely inapplicable is `preflight`, `wiring`, and `assets`, which judge a consumer's
installation of ploaness; `payload-generated`, `payload-rules`, and `generated-denial`, which are about
Payload - the last of those denies write access to the three artefacts `payload generate` owns, and this
repository has none of them; `css`, `bundle`, and `e2e`, for which this repository has no stylesheet,
client bundle, or browser. `docker` runs: with no container definition it passes over an empty set
without starting one, and the day somebody adds a Dockerfile it is already linted. Everything else is on. A gate that ploaness cannot turn on itself is a gate this repository
is not held to, so prefer adding one here over asserting that it cannot apply - `arch` was absent on
that reasoning, and a module cycle grew in `packages/governance` where nothing was looking.

### Three scopes, and why the run order did not move

A gate judges a repository, a package, or a Payload package. The distinction is not cosmetic: reading a
repository-level fact from a package's directory is what made `install-scripts` demand a workspace file
where one cannot exist, and made the overrides check report no violation because it had read no file at
all - vouching for pins the root had already replaced. The workspace file is a field of the repository
half now, so a package-scope rule cannot reach it. That is the difference between a bug fixed and a bug
made unrepresentable, and `wiring-partition.spec.ts` asserts it as a property.

Registry order remains the only ordering rule, and that is a decision rather than an omission. Grouping
a run by member reads better in a multi-member report and was the first design here; it was dropped
because it also reorders a SINGLE-member run, which is every consumer that exists today. A project's
first finding would have changed without one rule changing. Making workspaces work is not a licence to
renumber the run for projects that have no workspace, so `run-plan.spec.ts` pins the one-member sequence
against the list that shipped, and `it/project` passes byte-identically with no assertion edited.

A member's kind - Payload, application, library - is derived from what it declares, never declared. A
package cannot receive a weaker configuration by describing itself differently, and the pins state which
kinds must declare them, so a shared library is not told to depend on Payload.

A tracked-tree fingerprint brackets the whole run. A verification that rewrote a source file would
describe a tree nobody committed, so `build` regenerating a stale asset body is reported as a failure to
commit rather than silently repaired.

Two legs are required before a change is finished: `pnpm run verify`, which covers the harness's source
and calls `pnpm run it` against the packed packages, and a real consumer project for the gates that shell
out to a Payload toolchain. `pnpm run it` remains available as a declared subset while iterating.

Nothing runs those two legs but a person. This repository ships no workflow, so `gate actions` passes
here over an empty set. That is worth knowing when reading a green tree: it says the last person to run
the legs saw them pass, not that they pass now.

### TypeScript is held at 6 by the lint pass, not by inertia

The update report names `typescript 7.0.2` and will keep naming it. It is not taken, and the reason is a
hard one rather than a preference: `typescript-eslint`, on its own latest release, declares a peer range
of `>=4.8.4 <6.1.0`, and the type-aware pass refuses outright with `typescript-eslint does not support
TS 7.0`. `tsc --build` itself succeeds on 7, so a run that only compiled would look like a clean
upgrade; it is `pnpm run lint:eslint` that fails, which is why the attempt has to reach that step before
it is believed.

The standard resolves a finding by upgrading rather than by excusing, and here no upgrade exists yet:
the move is to raise `typescript` and `typescript-eslint` together, the moment the latter declares 7.
Until then the gap is one major, which the freshness bound reports and does not fail. Worth watching
rather than filing away - if TypeScript 8 ships first, the gap reaches the bound with still no upgrade
path, and every consumer fails on a pin none of them can move.

### The repository is linted by the config it publishes

`packages/config/src/eslint.ts` carries every cap and ban the governing standard states, and for a long
time this repository never ran it on itself. The framework-neutral half now lives in
`packages/config/src/eslint-core.ts`, shared by the shipped config and by the root `eslint.config.mjs`, so
neither restates a rule; only the globs differ, which is the one genuinely repository-shaped part.
`tsconfig.lint.json` puts the specs in a project, so a type-aware pass can read them and the compiler
checks them too.

Turning it on reported 495 findings and clearing them changed real code: the character scanners became
folds and recursions, the imperative accumulators became `flatMap`, every bare number acquired a name,
and the two configuration rules that proposed methods the `lib` target does not carry were turned off
rather than obeyed. Three of those findings were defects rather than style - a suppression comment
wrapped onto a second line had silently disarmed itself, a boolean-returning function was named as
though it returned data, and `.filter(fn)` over `git ls-files` crashed on a symlink.

The JavaScript half took longer, and is now finished by there being no JavaScript half. `eslint.config.mjs`
ignored every `.js` and `.mjs` file, which was right for an analyzer config and a `bin` shim - they carried
no type information for a type-aware pass to read - but wrong for the programs that IMPLEMENT a check: the
fixture mutations in `it/lib/`, the asset-body staging helper, the two package build scripts, and the setup
file that installs the network guard. The standard makes each of those source code of this repository, and
Biome alone was reading them, which covers the complexity cap and nothing else. That round replaced two
`process.exit(1)` calls with thrown errors, a `delete` with a rebuilt object, and a hand-written wrapper in
the network guard with a Proxy - which also stopped the guard from having to copy `dns.lookup`'s promisify
symbol by hand.

The premise underneath it - that these files cannot be TypeScript - was true only of what SHIPS. Node
refuses to type-strip a file under a `node_modules` path, so a published `.ts` would fail to load in every
consumer; nothing stops the source being TypeScript and the published artefact being the compiled output,
which is what `packages/governance` and `packages/cli` always did. `packages/config` and `packages/ploaness`
build the same way now, from `src/` into a gitignored `dist/`, and the check programs are plain `.ts` that
node strips where it runs them - outside `node_modules`, where stripping is allowed. `tsconfig.lint.json`
names them so the compiler and the type-aware pass read them.

Two things fell out of that. Every hand-written `.d.ts` is gone: eight files that restated shapes their
implementations already knew, replaced by declarations `tsc` emits, so `packages/ploaness/src/a11y.ts` now
re-exports a type instead of describing it a second time. And the `javascriptAllowlist` in the root
`package.json` shrank from four directory-wide patterns to one file, which is what turns "prefer
TypeScript" from a preference into `gate conventions` failing on the next `.js` anybody adds.

One trap is worth naming, because the compiler will not: an entry point whose type is INFERRED from a
runner's own config helper emits a declaration naming that runner's types. `@ploaness/config/vitest` did,
and `vite` reaches this package only as a transitive dependency pnpm's strict layout does not expose - so
the reference would have degraded to `any` under `skipLibCheck` in every consumer, silently. Both runner
configs are annotated structurally for that reason, exactly as the hand-written declarations they replaced
were.

Do not clear a new finding with a suppression while a structural fix exists. `ploaness gate
suppressions` reports where the budget stands; a comfortable margin is not permission to spend it,
because the margin is what a genuinely unavoidable suppression will need later.

Note what the ceiling does NOT count: it measures files whose extension is code, so a shell script's
`# shellcheck disable=` is free. Resolve a shell finding structurally rather than by directive - that is
why the asset-body check is a script rather than a function, and why the fixture mutations are programs
in `it/lib/` rather than arguments to `node -e`.

### The suite runs under the guard it ships

`packages/config/src/vitest-setup.ts` is loaded ahead of every other setup file, here and in a consumer. It
installs the network guard - `net.Socket.prototype.connect`, the DNS lookups, and the resolver family,
all made non-writable and non-configurable so a spec cannot put the originals back - and the shipped
`sequence` block shuffles the suite under a fixed seed. Both were prose in the agent guide until they
were checks, and `README-guideline-software-project.adoc` says a rule automation can verify reliably
belongs in a check rather than in an instruction file.

Raw datagrams, child or cluster processes, and workers do not pass through a setup file installed in the
test runtime. `NO_NETWORK_GUARD_ESCAPE` therefore bans those entry points in test code instead of
pretending a wrapper in this process can govern another transport or runtime.

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

### The assets that are executable

Most managed files are configurations, read by a tool. Three are specs that run, and they are managed
for the same reason a rule is: a check a project can edit is not a rule. Each judges something only a
running application knows, which is the whole reason it runs rather than reads.

- the accessibility sweep, `packages/assets/files/tests/e2e/a11y.e2e.spec.ts.asset`, for a contrast
  defect that appears only under `:hover` or `:focus` and a page nobody remembered to list;
- the security-headers sweep, `security-headers.e2e.spec.ts.asset`, because a Next.js application sends
  no security header unless the project sets one and every static gate stays green while it does not;
- the access-boundary sweep, `access-boundary.e2e.spec.ts.asset`, which asks Payload through
  `/api/access`, with no credential, what it grants a stranger. The source rules read the access block a
  project wrote; they cannot read what `read: anyone` decides, nor what Payload made of the config after
  sanitisation, so a project can satisfy all of them and still serve every document to everyone.

Three consequences follow, and each is handled where it arises rather than waived.

A consumer cannot remove a suppression inside a file it does not own, so the suppressions gate leaves
managed paths out of both the count and the line total. Counting them would spend a fifth of a small
project's whole allowance on a decision the project never made.

`ploaness` is not a Payload application and has no browser to drive, so these bodies have no root file
to pair with and are listed in `ASSET_AUTHORED_PATHS`. For a while nothing here compiled them and
`scripts/lib/check-asset-bodies.sh` was the only thing that read them as code at all - which is Biome,
carrying no type information and none of the rules the shipped ESLint config states. Two defects
reached real projects through that gap: a type the sweep imported and `ploaness/access` never exported,
and a callback passed to `.map` by reference. Neither was findable from this side.

`it/verify.sh` now runs the `types` and `eslint` gates over its fixture, which receives the specs from
`ploaness init` exactly as a consumer does. That is where a shipped spec is first read as the code it
is. Running the suite with either defect restored fails the matching gate, which is what makes those
two assertions worth their run time rather than decoration.

What still proves the specs RUN is the third verification leg: a real consumer drives them in a
browser, which is the reason that leg exists.

Shipping a spec makes the end-to-end suite mandatory, so `playwright.config.ts` joined the files the
wiring gate requires as a bare re-export, and the `e2e` gate no longer reports a pass for a project that
declares no suite.

Requiring that re-export also took away the only seam the file had, and the harness that took it owes
what it carried. A project's own Playwright config used to open by loading `.env`, which is what let a
spec helper seed through `getPayload`: a Payload config validates `process.env` at module scope, so
importing that helper boots the configuration before a browser or a server is involved, and the failure
lands at spec collection rather than in a test. Next reads those files itself, so the application under
test never showed the gap. `playwright.js` now reads them, over the order `environment-files.ts`
declares - the order is the whole of the meaning, since `process.loadEnvFile` never replaces a value
already set, and it is stated in `governance` rather than at the call site because a list in
`packages/config` is measured by no coverage floor. `vitest-setup.ts` reads the same list, which is
what the shared constant is for: an integration spec boots the project exactly as an end-to-end helper
does. A project may still load them in its own `vitest.setup.ts`, and nothing breaks if it does,
because neither read replaces a value already set - but the promise that a gate running the
application uses the real environment cannot hold only for the projects that remembered.

### Roles this repository declares

The `ploaness` key of `package.json` carries two exclusions, each a role rather than a convenience:

- `.vale/styles/**` is exempt from the typography ban because those files are Vale detector definitions
  whose content *is* the banned character. It is the same self-reference `banned-typography.ts` solves
  by naming characters as code points.
- The JavaScript allowlist is one entry, `eslint.config.mjs`, and it is the only hand-written JavaScript
  left in the repository. ESLint's own loader reads a flat config as JavaScript unless `jiti` is
  installed, and adding a dependency to author one file is a worse trade than keeping the file. The
  analyzer configs and the package entry shims used to be listed here too; they are TypeScript sources
  compiled into `dist` now, so the two directory-wide patterns that covered them are gone. Shrinking
  this list is what makes the ban enforceable: `gate conventions` fails on the next `.js` anybody
  tracks, which is how shipping the Playwright entry point was caught the moment the file appeared.

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
