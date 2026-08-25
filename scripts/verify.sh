#!/usr/bin/env sh
# The verification command for the ploaness repository itself.
#
# ploaness cannot run `ploaness verify` on itself: the `preflight` gate hard-requires a declared
# `payload` dependency, and ploaness is not a Payload project. That is a deliberate consequence of the
# Payload-only scope. But `ploaness gate <id>` builds its context from the working directory and never
# runs preflight, so every gate whose rule is about a repository's shape rather than about Payload runs
# here unchanged. This script is that list, and it reimplements no rule.
#
# The tracked-tree fingerprint brackets the whole run. A verification that rewrote a source file would
# describe a tree nobody committed, so `build` regenerating a stale asset body is reported as a failure
# to commit rather than silently repaired.
set -eu

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

ploaness="node $root/packages/cli/dist/bin.js"

fingerprint() {
    git ls-files -z | xargs -0 git hash-object | git hash-object --stdin
}

# Reported on the way out of a failing run as well as at the end of a passing one. A check that failed
# after rewriting a source file leaves two problems, and the one nobody looked for is the file: `git
# status` would show it, but only to someone who thought to look.
report_tree() {
    if [ "$before" != "$(fingerprint)" ]; then
        printf '\n!!! the verification rewrote a tracked file. Review and commit what git status shows, then rerun.\n'
        return 1
    fi
    return 0
}

# The run stops at the first failing check. It once carried on and counted, which produced a page of
# passes below a failure - and nothing below a failing check has been verified, so those passes describe
# a state nobody established.
step() {
    label="$1"
    shift
    printf '\n=== %s ===\n' "$label"
    if "$@"; then
        return 0
    fi
    printf '!!! %s FAILED\n' "$label"
    report_tree || true
    printf '\nhalted at %s: the checks below it did not run\n' "$label"
    exit 1
}

gate() {
    step "gate $1" sh -c "$ploaness gate $1"
}

before="$(fingerprint)"

step build      pnpm run build
step typecheck  pnpm run typecheck
step lint       pnpm run lint
step lint:eslint pnpm run lint:eslint
step lint:assets sh "$root/scripts/lib/check-asset-bodies.sh"

# Three analyzers the `ploaness verify` gates run against a Payload layout. Their rules are about a
# repository's shape, so they apply here unchanged; only the globs differ, which is what the `-repo`
# configs carry. They are invoked from the CLI package's own install rather than through
# `ploaness gate`, because the gate would hand them the shipped configs and those describe `src/`.
#
# `arch` is the reason this block exists. It never ran here, and a cycle grew in `packages/governance`
# where nothing was looking.
cli_bin="$root/packages/cli/node_modules/.bin"

step arch "$cli_bin/depcruise" packages scripts \
    --config packages/config/dependency-cruiser-repo.json
step knip "$cli_bin/knip" --config packages/config/knip-repo.json

# The standard makes a check a repository implements itself into its source code, held to the same rules
# as everything else - and these scripts were read by nothing. The image is pinned by digest beside the
# other containerised analyzers, and the run is at shellcheck's own default severity: an `info` finding
# is a finding, because a check has two verdicts and neither of them is a warning.
shellcheck_image="$(node --input-type=module -e \
    "import { CONTAINER_IMAGES } from '$root/packages/governance/dist/index.js'
     process.stdout.write(CONTAINER_IMAGES.shellcheck)")"
step shellcheck docker run --rm -v "$root:/mnt" "$shellcheck_image" \
    scripts/verify.sh scripts/lib/check-asset-bodies.sh scripts/pack-local.sh it/verify.sh

# The specs are exempt for the reason AGENTS.md records: `--strict` counts every type assertion as
# uncovered, and a spec exists to construct inputs the production types cannot express. Reaching 100%
# there would mean building objects nobody reads. Everything else is measured, and clearing it removed
# fifty assertions rather than adding one exemption - six modules each carried their own copy of the
# same two narrowing helpers, and every copy narrowed with a claim the compiler could not check.
step type-coverage "$cli_bin/type-coverage" \
    --at-least 100 --strict --cache false -p tsconfig.lint.json \
    --ignore-files 'packages/*/test/**' \
    --ignore-files 'vitest.config.mts' \
    --ignore-files 'vitest.setup.ts'

# The gates whose rules are about a repository's shape, in the order `gates.ts` runs them.
gate biome-schema
gate conventions
gate editorconfig
gate suppressions
gate config-refs
gate docs
gate skills
gate image-assets
gate licenses
gate vulnerabilities
gate install-scripts
gate deps
gate actions
gate secrets

step test pnpm run test

# History gates last: they need no build, and a history failure is repaired differently from a source
# failure. `require-full-history` first, because the other two are meaningless on a shallow clone.
gate require-full-history
gate commit-history
gate linear-history

if ! report_tree; then
    exit 1
fi

printf '\nverified: every check passed\n'
