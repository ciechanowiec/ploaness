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

ploaness_bin="$root/packages/cli/dist/bin.js"

# This module uses only Node builtins, so the same inventory can bracket the build on a fresh clone.
fingerprint() {
    node --input-type=module -e '
        import { workingTreeFingerprint } from "./packages/cli/src/working-tree.ts"
        process.stdout.write(workingTreeFingerprint(process.cwd()))
    '
}

# Reported on the way out of a failing run as well as at the end of a passing one. A check that failed
# after rewriting a source file leaves two problems, and the one nobody looked for is the file: `git
# status` would show it, but only to someone who thought to look.
report_tree() {
    if [ "$before" != "$(fingerprint)" ]; then
        printf '\n!!! the working tree changed during verification. Review and commit what git status shows, then rerun.\n'
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

# argv, not a shell string. The interpreter path was interpolated into `sh -c`, where the inner shell
# re-splits it - so a checkout under a path containing a space broke every one of the gate invocations,
# while every other command in this file was already passed properly.
gate() {
    step "gate $1" node "$ploaness_bin" gate "$1"
}

before="$(fingerprint)"

step build      pnpm run build
step typecheck  pnpm run typecheck
step lint       pnpm run lint
step lint:eslint pnpm run lint:eslint
step lint:assets sh "$root/scripts/lib/check-asset-bodies.sh"

# The packages are one release, pinned to each other at an exact version, and nothing derives that
# version from one place. It is written down in every manifest, in every cross-reference between
# them, in the fixture's overrides and in the user guide, and `pack` names several of those in
# the tarball filenames the fixture installs by path - so a bump that misses one halts here rather than
# in an install error that reports a missing file.
step release-version node "$root/scripts/lib/check-release-version.ts"

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

# The gates whose rules are about a repository's shape, in this file's own order: the reads that need
# nothing but the tree first, then the ones that need a registry or a container. `gates.ts` orders them
# differently, because it is ordering a Payload project's run rather than this one - and the comment
# here used to claim it followed that order, which it has not for some time.
# Whichever repository-scope gates are NOT run above, named with the reason each cannot apply here. A
# gate absent from both lists is a gate nobody decided about, which is the failure that let `arch` sit
# unrun while a module cycle grew behind it. `preflight` and `wiring` judge a consumer's installation of
# the harness; `assets` judges managed files a consumer receives and this repository does not; the tree
# fingerprint brackets a gate run rather than being one; `generated-denial` is about artefacts only a
# Payload project generates.
inapplicable_gates='preflight wiring assets tree-snapshot tree-verify generated-denial'

check_gate_coverage() {
    missing=''
    registry_ids="$(node "$ploaness_bin" gates --scope=repository --ids)"
    if [ -z "$registry_ids" ]; then
        echo 'the gate registry returned no repository gates' >&2
        exit 1
    fi
    for id in $registry_ids; do
        case " $(grep -o '^gate [a-z-]*' "$0" | cut -d' ' -f2 | tr '\n' ' ') $inapplicable_gates " in
            *" $id "*) ;;
            *) missing="$missing $id" ;;
        esac
    done
    if [ -n "$missing" ]; then
        echo "repository-scope gate(s) neither run nor declared inapplicable:$missing" >&2
        echo 'add each to this script, or to inapplicable_gates with the reason it cannot apply' >&2
        exit 1
    fi
    echo 'gate coverage: every repository-scope gate is run here or declared inapplicable'
}
check_gate_coverage

gate biome-schema
gate conventions
gate tailwind-tokens
gate oxlint
gate editorconfig
gate suppressions
gate config-refs
gate environment
gate docs
gate skills
gate image-assets
gate licenses
gate vulnerabilities
gate install-scripts
gate release-age
gate blocklist
gate deps
gate actions
# The scripts this repository implements its own checks into, read by the gate a consumer gets rather
# than by a block written here. It replaced exactly that block: the same pinned image at the same
# default severity, plus `--norc` and the scripts a shebang names rather than only those an extension
# does. The run moved later as a consequence, into the gate block where it belongs.
gate shell
# Run for the reason the container gate below is: this repository ships no `.tf`, so the gate passes
# over an empty set without starting a container, and the day somebody adds infrastructure it is
# already judged rather than newly unjudged.
gate infra
# The same reason again: no Dockerfile, so no image to scan and no container started; the day one is
# added, its base image is judged from the start.
gate base-images
# Run rather than declared inapplicable, which is what the guide asks for wherever a gate CAN answer:
# with no Dockerfile and no compose file it passes over an empty set without starting a container, and
# the day somebody adds one it is already linted rather than newly unlinted.
gate docker
gate secrets

step test pnpm run test

# A package harness is not proven by its workspace layout alone. Pack the published packages and
# install them into the isolated fixture, so the verification command covers the same resolution path a
# consumer receives. `pnpm run it` remains a declared subset for iterating on this leg by itself.
step pack pnpm run pack:local

# Between packing and installing, because it judges the artefact rather than the install. The fixture
# below exercises the entry points it happens to import; this reads every one the `exports` map
# declares, under each resolution mode a consumer might use.
step packaging sh "$root/scripts/lib/check-packaging.sh"

step integration pnpm run it

# History gates last: they need no build, and a history failure is repaired differently from a source
# failure. `require-full-history` first, because the other two are meaningless on a shallow clone.
gate require-full-history
gate commit-history
gate linear-history

if ! report_tree; then
    exit 1
fi

printf '\nverified: every check passed\n'
