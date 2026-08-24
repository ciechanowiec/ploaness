# Integration fixtures

`it/` sits deliberately outside the pnpm workspace. Everything under `packages/` is tested as source; this
directory is the only place ploaness is tested the way a consumer actually receives it - installed from a
packed tarball, resolved through `node_modules`, invoked as the `ploaness` binary. A packaging mistake that
every unit test survives dies here: a missing `files` entry, an entry point absent from the exports map, a
`workspace:*` specifier that cannot resolve once it leaves the workspace.

Run it with `sh it/verify.sh`, or `pnpm run it`. It packs the five tarballs first, so no separate build step
is needed.

## What the suite proves

That a project scaffolded by `ploaness init` satisfies the gates ploaness applies to a project's own shape,
and that removing one guarantee fails **that guarantee's** gate rather than merely failing something.

The second half is the part worth stating. A suite that only asserted "the bad fixture exits non-zero" would
pass just as happily if every fixture failed on `preflight` for an unrelated reason, and would then quietly
stop testing anything. So each negative case asserts the exit status, the `[VERDICT] <gate>` line, and a
needle from the rule name - `no-unbounded-find`, not merely `payload-rules`.

| Case | Mutation | Must fail on |
| --- | --- | --- |
| `pass` | none | nothing; twelve gates PASS |
| `fail-wiring` | `scripts.verify` rewritten to `echo ok` | `wiring`, naming `scripts.verify` |
| `fail-unbounded-find` | `depth` and `limit` dropped from a `payload.find` | `payload-rules`, naming `no-unbounded-find` |
| `fail-collection-access` | `access` dropped from a collection | `payload-rules`, naming `require-collection-access` |
| `fail-commit-message` | a commit with a non-conventional header | `commit-history` |
| `fail-asset-drift` | an edit to the PINNED `.editorconfig` | `assets`, naming `.editorconfig` |
| `fail-section-drift` | an edit inside the managed block of `AGENTS.md` | `assets`, naming the drifted block |
| `fail-section-duplicated` | a second copy of the managed block | `assets`, asking for a hand repair |
| `fail-commit-junk-word` | a junk word later in the subject, not first | `commit-history`, naming `low-effort` |
| `fail-commit-revert-type` | a `revert:` header | `commit-history`, naming `invalid header` |
| `fail-editorconfig` | trailing whitespace in a source file | `editorconfig`, naming `trailing whitespace` |
| `fail-typography-css` | an em dash in a stylesheet | `conventions`, naming `em dash` |
| `fail-suppressions` | `maxSuppressions: 0` plus one suppression | `suppressions`, naming `ceiling` |
| `fail-generated-denial` | the write denial removed from `.claude/settings.json` | `generated-denial`, naming `no write denial` |
| `fail-install-scripts` | the install-script allowlist removed | `install-scripts`, naming `onlyBuiltDependencies` |
| `fail-report-only-ci` | `--enforce=false` added to the CI invocation | `wiring`, naming `not a pass` |
| `fail-vitest-config-swapped` | `vitest.config.mts` replaced with a local config | `wiring`, naming the file |
| `fail-pinned-override` | an override redefining a version ploaness pins | `wiring`, naming `pins` |
| `pass-section-project-text` | project prose added below the managed block | nothing; the project owns that text |

The two `commit-` cases named above exist because both rules diverged from the governing standard once:
`revert` was an accepted type the standard does not list, and a junk word was rejected only as the first
word of a subject the standard says must not contain one anywhere. A fixture pins each corrected rule so
the divergence cannot return quietly.

The three `section` cases exist because the SECTION disposition is the only one where ploaness and the
project write the same file, so a single "it fails" assertion would not distinguish the three outcomes that
matter: a drifted block must fail, ambiguous markers must fail *differently* (sync cannot repair them, so
advising sync would send the project round a loop), and project prose below the block must not fail at all.
A gate that could not tell the third case from the first would make the disposition useless.

The `pass` fixture carries no `scripts` of its own: `ploaness init` writes them.
That makes the pass case double as the regression test that the scaffolder and the wiring rule agree about
what correct wiring looks like - the two read the same exported constants, and this is what proves it. Both
defects that shipped in the first draft of the wiring gate were of exactly that kind.

## What the suite does not prove

The gates that shell out to a toolchain: `types`, `biome`, `eslint`, `css`, `arch`, `type-coverage`, `knip`,
`tests`, `build`, `bundle`, `e2e`, and the one that needs Docker (`secrets`). Those need a real
Payload application - a database, a Next.js build, a browser - and a fixture large enough to exercise them
honestly would be a second product to maintain. They are proven end to end by a consumer project instead.
`payload_blank` is that consumer, and its `pnpm run verify:full` is the other half of this suite.

This boundary is a choice, not an oversight. The fixtures cover the rules ploaness *is*; the consumer covers
the tools ploaness *runs*.

## How it works

`verify.sh` builds one template project under `$HOME`, installs the tarballs into it once, and runs
`ploaness init`. Every case is then a copy of that template with `node_modules` symlinked rather than
copied, so every fixture costs one install. Node resolves through a symlinked `node_modules` normally,
which is what makes this safe - and the symlink is also why a gate that reads tracked files must skip a
path that is not a regular file. Three gates crashed on exactly that until these cases caught it.

The scratch directory lives under `$HOME` rather than `/tmp` because a container mount of the repository
does not extend to the system temporary directory, so a fixture built there is invisible to the gates that
run their tool inside a container.

Mutations are applied by Node one-liners (`edit_json`, `drop_text`) rather than `sed`. `drop_text` fails
loudly when its needle is absent, so a fixture can never silently degrade into a no-op that still "passes"
because the gate it targets was never actually disarmed.
