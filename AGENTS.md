# Repository Guidelines

## Repository Contract

Follow `README-guideline-software-project.adoc`, then these repository-specific instructions. Both are
binding; this file adds the implementation and verification details for Ploaness itself.

Ploaness governs Payload CMS repositories whose code is written by agents without human review.
A change must preserve the accuracy of the verdict, the ownership of each rule, and the usability of the
installed contract. A passing subset or a source scan that found nothing does not establish full assurance.

## Package Ownership

This pnpm workspace publishes six packages at one release version:

- `packages/governance`: pure policy functions over already-read values, with zero filesystem, process,
  or network I/O. Put decisions here so real input/output tests can measure them directly.
- `packages/runtime`: zero-dependency production helpers applications import from `@ploaness/runtime`.
- `packages/config`: analyzer configurations and the dependencies on tools Ploaness invokes.
- `packages/assets`: the managed-file catalogue and asset bodies.
- `packages/cli`: filesystem, network, process, and reporting adapters around governance decisions.
- `packages/ploaness`: the consumer-facing package and public re-exports.

Keep the dependency graph acyclic. A shared policy belongs below its consumers. A production helper
belongs in runtime, so a consumer need not install analyzers as production dependencies.

The packages declare exact versions of each other. The local workspace links those dependencies during
development; `it/` installs packed archives outside the workspace. Keep all package versions, internal
coordinates, fixture archive references, and the README release attribute aligned. The release-version
check measures their agreement.

## Implementation Conventions

Use TypeScript, NodeNext resolution, `.js` suffixes on relative imports, and explicit types under the
strict compiler and lint configuration. Published code is compiled into `dist`; Node's source type
stripping is used only for repository tooling outside `node_modules`.

- Declare shared wiring values once in `wiring-policy.ts`. Both the scaffolder and the wiring check
  consume them. Derive an exemption from the requirement that creates it.
- Preserve member ownership. Repository facts come from the repository root; member settings describe
  that member. Exclusions must not leak into siblings. Member kinds come from manifests, not opt-in flags.
- Enumerate tracked and non-ignored untracked source with the shared working-tree inventory. Do not
  cache an inventory across the start and end of verification.
- Tool failure, malformed output, incomplete evidence, and unexplained nonzero exits fail the check.
  Findings should name the problem and the concrete repair.
- Comments explain present constraints or non-obvious decisions. Keep history in Git; do not narrate
  earlier defects and rejected designs in operating instructions or source headers.
- Do not add a suppression while a structural fix exists. This applies to shell directives as well as
  the suppressions counted by the code budget.

Analyzer expansion requires a bounded audit of existing ownership, new coverage, valid code, scope, and
suppression behavior. Enable specific validated rules at error severity. Each semantic rule has one
owner; preserve the distinction between native core checks, application JSX checks, and library policy.
Do not enable whole rule categories to increase a rule count.

## Managed Sources and Documentation

Edit canonical sources, then regenerate their outputs:

- The software-project guideline and shared root dotfiles produce their paired asset bodies through
  `packages/assets/build.ts`.
- The consumer guide is authored in `packages/assets/files/.ploaness/agent-guide.md.asset`; the managed
  consumer instruction block is authored in `packages/assets/files/AGENTS.md.asset`.
- The managed browser specs and seeded proxy are authored as asset bodies. Their pure decisions belong
  in governance; browser and application interaction stays in the executable adapter.
- Package READMEs and licenses are generated during packing. Inlined meta-package configurations and
  declarations are build outputs. Do not maintain a second handwritten copy.

The README explains installation and the public workflow. This file explains maintaining Ploaness.
The installed guideline, managed instruction block, and agent guide must together be sufficient for a
consumer's agent. Keep the full gate and settings references in the guide, with concise operational
explanations and accurate limits. Do not duplicate the guideline or turn the guide into a change log.

Use `ploaness sync` in consumers and compare generated content with its canonical source. Preserve
project-owned text and legitimate seeded files. A harness defect is repaired here with a synthetic
regression, rather than hidden by a consumer-specific override. Keep client material out of this repository.

## Verification

Use Node 26 or later and the exact pnpm version in `packageManager`.

| Command | Role |
| --- | --- |
| `pnpm run verify` | Required full verification of Ploaness, including packing and integration fixtures. |
| `pnpm run verify:fast` | Declared development subset: build, typecheck, lint, and unit tests. |
| `pnpm run pack:local` | Build and pack the six archives into `dist-tarballs/`. |
| `pnpm run it` | Exercise packed consumer fixtures; pack first when iterating separately. |
| `sh it/verify.sh --native-only` | Diagnostic native-rule and suppression subset. |
| `sh it/verify.sh --jsx-only` | Diagnostic JSX and browser-name subset. |
| `pnpm run format` | Apply the formatting and fixes judged by the lint checks. |
| `pnpm run lint:eslint` | Type-aware lint subset. |

Ploaness has no Payload member, so it cannot run `ploaness verify` on itself. Do not weaken preflight to
change that. `scripts/verify.sh` runs applicable repository gates directly and uses repository-shaped
configs for architecture, dead code, and type coverage. Its gate-coverage check rejects an unaccounted
repository gate. Its shared working-tree fingerprint brackets the whole run, including the build.

The same command checks asset formatting, shell scripts, public tarball exports and declarations, and
the installed fixture's types and lint. These checks cover surfaces that application gates do not see.
Run it uninterrupted before finishing. Fix generated drift before starting the accepted run.

Changes affecting rules, scaffolding, configuration, or packaging also need real consumer verification.
The packed fixture establishes installation and exercised semantics; a real application's full command
establishes its production build, service startup, and browser behavior. Run resource-intensive consumer
suites sequentially. After a failure, focused checks may diagnose it, but a new full run establishes acceptance.

Keep verification logs outside the authored tree. When refreshing rebuilt archives with the same version,
compare their hashes, force the install, and retain lockfile integrity. A matching version number alone
is not evidence of matching bytes.

## Tests and Commits

Vitest specs live in `packages/*/test/*.spec.ts`. Per-file coverage floors apply to the pure governance
and runtime packages. CLI adapters also have real-filesystem tests and are exercised by `it/`. Do not
place a policy in the CLI to escape coverage. Do not bypass the test network guard through process APIs.
Use the integration fixture runner when a test needs to create an independent Git repository or subprocess.

Test observable behavior and agreement between independently consumed contracts. Include passing valid
code beside rejected inputs. A regression should fail when its repair is removed; an assertion repeating
a constant's declaration proves no behavior. Fixture failures are expected only on their named gate and
finding, as specified in `it/verify.sh`.

Use the guideline's Conventional Commit policy, including explanatory bodies for larger changes and the
ban on agent attribution. Stage explicit reviewed paths. Commit locally unless a push is requested, and
run the relevant post-commit verification so history checks include the new commit.
