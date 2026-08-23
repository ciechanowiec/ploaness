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
failures=0

fingerprint() {
    git ls-files -z | xargs -0 git hash-object | git hash-object --stdin
}

step() {
    label="$1"
    shift
    printf '\n=== %s ===\n' "$label"
    if "$@"; then
        return 0
    fi
    failures=$((failures + 1))
    printf '!!! %s FAILED\n' "$label"
}

gate() {
    step "gate $1" sh -c "$ploaness gate $1"
}

before="$(fingerprint)"

step build      pnpm run build
step typecheck  pnpm run typecheck
step lint       pnpm run lint
step lint:eslint pnpm run lint:eslint

# The gates whose rules are about a repository's shape, in the order `gates.ts` runs them.
gate conventions
gate editorconfig
gate suppressions
gate config-refs
gate docs
gate skills
gate image-assets
gate licenses
gate vulnerabilities
gate deps
gate actions
gate secrets

step test pnpm run test

# History gates last: they need no build, and a history failure is repaired differently from a source
# failure. `require-full-history` first, because the other two are meaningless on a shallow clone.
gate require-full-history
gate commit-history
gate linear-history

after="$(fingerprint)"
if [ "$before" != "$after" ]; then
    failures=$((failures + 1))
    printf '\n!!! the verification rewrote a tracked file. Review and commit `git status`, then rerun.\n'
fi

printf '\n'
if [ "$failures" -eq 0 ]; then
    printf 'verified: every check passed\n'
    exit 0
fi
printf '%s check(s) failed\n' "$failures"
exit 1
