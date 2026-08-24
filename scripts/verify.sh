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

# Biome cannot read a shipped body where it lives: the `.asset` suffix hides the language, and the root
# config excludes that whole directory because most bodies there are prose rather than code. The one
# body that IS code therefore reached a consumer unformatted, and the first thing to report it was that
# consumer's own `biome` gate - which turns a ploaness packaging defect into something that reads as the
# project's problem.
#
# So the bodies are staged under the paths they will occupy in a consumer, beside the consumer-facing
# config a consumer actually receives, and checked there. Piping them through `--stdin-file-path` was
# tried first and cannot work: that mode reports "the contents aren't fixed" and exits non-zero for
# every input, clean or not.
check_asset_bodies() {
    stage="$(mktemp -d)"
    # The shipped config declares `root: false`, because in a consumer it is extended rather than used
    # directly. Biome ignores a non-root config's settings and silently formats with its own defaults,
    # so the staged stand-in for the consumer's root config has that flag removed.
    node -e '
      const { readFileSync, writeFileSync } = require("node:fs")
      const [source, destination] = process.argv.slice(1)
      const config = JSON.parse(readFileSync(source, "utf8"))
      delete config.root
      writeFileSync(destination, JSON.stringify(config, null, 2))
    ' "$root/packages/ploaness/biome.json" "$stage/biome.json"
    # Named one by one rather than as the whole directory: the config sits there too, and Biome would
    # otherwise judge a file this repository generates and does not format.
    staged_paths=''
    for body in $(find packages/assets/files -name '*.ts.asset' | sort); do
        relative="${body#packages/assets/files/}"
        relative="${relative%.asset}"
        mkdir -p "$stage/$(dirname "$relative")"
        cp "$body" "$stage/$relative"
        staged_paths="$staged_paths $relative"
    done
    status=0
    (cd "$stage" && "$root/node_modules/.bin/biome" check $staged_paths) || status=1
    rm -rf "$stage"
    return "$status"
}

before="$(fingerprint)"

step build      pnpm run build
step typecheck  pnpm run typecheck
step lint       pnpm run lint
step lint:eslint pnpm run lint:eslint
step lint:assets check_asset_bodies

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
