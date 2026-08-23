#!/usr/bin/env sh
# Verifies the packed harness from an isolated consumer repository, the way a published consumer would
# install it. Nothing under the ploaness working tree is written.
#
# What this suite proves: that a project scaffolded by `ploaness init` satisfies the gates ploaness
# applies to a project's own shape, and that removing one guarantee fails that guarantee's gate rather
# than merely failing something. What it does not prove: the gates that shell out to a toolchain
# (types, biome, eslint, tests, build). Those need a real Payload application and are proven end to end
# by a consumer project, not by a fixture.
set -eu

here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/.." && pwd)"
tarballs="$root/dist-tarballs"
failures=0

for package in ploaness ploaness-cli ploaness-config ploaness-assets ploaness-governance; do
    if [ ! -f "$tarballs/$package-1.0.0.tgz" ]; then
        echo "missing $tarballs/$package-1.0.0.tgz; run scripts/pack-local.sh first" >&2
        exit 1
    fi
done

# Fixtures live under the home directory so a Docker-backed gate could mount them later: a macOS daemon
# shares the home directory and need not share the system temporary directory, and an unshared source
# mounts as an empty directory rather than as an error.
scratch="$(mktemp -d "$HOME/.ploaness-it-XXXXXX")"
trap 'chmod -R u+w "$scratch" 2>/dev/null || true; rm -rf "$scratch" 2>/dev/null || true' EXIT INT TERM

template="$scratch/template"
mkdir -p "$template"
tar cf - -C "$here/project" . | tar xf - -C "$template"
sed "s#__TARBALLS__#$tarballs#g" "$here/project/pnpm-workspace.yaml" > "$template/pnpm-workspace.yaml"

echo "installing the packed harness into the fixture template"
(cd "$template" && pnpm install --silent >/dev/null)
# `init` writes the wiring the wiring gate then requires, so the pass case doubles as the regression
# test that the scaffolder and the rule it is judged by still agree.
(cd "$template" && ./node_modules/.bin/ploaness init >/dev/null)

# One case directory per scenario, each a byte-for-byte copy of the template plus exactly one defect, so
# a failure can only be attributed to that defect. node_modules is shared by symlink: node resolves
# through it normally and copying a pnpm store per case would cost more than the whole suite.
new_case() {
    name="$1"
    directory="$scratch/$name"
    mkdir -p "$directory"
    tar cf - -C "$template" --exclude node_modules . | tar xf - -C "$directory"
    ln -s "$template/node_modules" "$directory/node_modules"
}

commit_case() {
    directory="$scratch/$1"
    subject="$2"
    body="$3"
    git -C "$directory" init -q -b main
    git -C "$directory" add -A
    git -C "$directory" \
        -c user.name='ploaness integration suite' \
        -c user.email='it@ploaness.invalid' \
        -c commit.gpgsign=false \
        commit -q -m "$subject" -m "$body"
}

# Assert one gate's verdict, and when it must fail, that the reported findings name the expected rule.
# Asserting the gate identifier is what makes a fixture prove its own defect rather than any defect.
expect() {
    name="$1"
    gate="$2"
    verdict="$3"
    needle="${4-}"
    directory="$scratch/$name"
    if output="$(cd "$directory" && ./node_modules/.bin/ploaness gate "$gate" 2>&1)"; then
        actual=PASS
    else
        actual=FAIL
    fi
    if [ "$actual" != "$verdict" ]; then
        echo "FAILED $name: gate $gate was $actual, expected $verdict" >&2
        echo "$output" | sed 's/^/    /' >&2
        failures=$((failures + 1))
        return
    fi
    if ! printf '%s' "$output" | grep -q "\[$verdict\] $gate"; then
        echo "FAILED $name: gate $gate exited correctly but did not report [$verdict] $gate" >&2
        echo "$output" | sed 's/^/    /' >&2
        failures=$((failures + 1))
        return
    fi
    if [ -n "$needle" ] && ! printf '%s' "$output" | grep -q "$needle"; then
        echo "FAILED $name: gate $gate reported $verdict but never mentioned \"$needle\"" >&2
        echo "$output" | sed 's/^/    /' >&2
        failures=$((failures + 1))
        return
    fi
    echo "ok $name: $gate is $verdict${needle:+ (${needle})}"
}

edit_json() {
    node -e '
      const { readFileSync, writeFileSync } = require("node:fs")
      const [file, pointer, value] = process.argv.slice(1)
      const parsed = JSON.parse(readFileSync(file, "utf8"))
      const keys = pointer.split(".")
      let cursor = parsed
      for (const key of keys.slice(0, -1)) { cursor = cursor[key] }
      cursor[keys.at(-1)] = value
      writeFileSync(file, `${JSON.stringify(parsed, null, 2)}\n`)
    ' "$@"
}

# Reads the file fully before writing, because a shell append that redirects a file into itself never
# terminates: the redirect keeps extending the very file the reader is still consuming.
duplicate_file() {
    node -e '
      const { readFileSync, writeFileSync } = require("node:fs")
      const [file] = process.argv.slice(1)
      const text = readFileSync(file, "utf8")
      writeFileSync(file, `${text}\n${text}`)
    ' "$@"
}

drop_text() {
    node -e '
      const { readFileSync, writeFileSync } = require("node:fs")
      const [file, needle] = process.argv.slice(1)
      const text = readFileSync(file, "utf8")
      if (!text.includes(needle)) {
        console.error(`the fixture no longer contains ${needle}; the mutation would be a no-op`)
        process.exit(1)
      }
      writeFileSync(file, text.replace(needle, ""))
    ' "$@"
}

CONFORMING_BODY='The fixture exercises the packed harness from outside the workspace, which is the
only arrangement that resolves the way a published install does.'

# The pass case: the untouched scaffold must satisfy every gate that judges a project's own shape.
new_case pass
commit_case pass 'feat(fixture): add the ploaness integration consumer' "$CONFORMING_BODY"
for gate in preflight wiring assets conventions payload-rules config-refs \
            require-full-history commit-history linear-history; do
    expect pass "$gate" PASS
done

# Each failing case is the pass case minus exactly one guarantee.
new_case fail-wiring
edit_json "$scratch/fail-wiring/package.json" scripts.verify 'echo ok'
commit_case fail-wiring 'feat(fixture): neutralise the verify script' "$CONFORMING_BODY"
expect fail-wiring wiring FAIL 'scripts.verify'

new_case fail-unbounded-find
drop_text "$scratch/fail-unbounded-find/src/lib/reads.ts" ', depth: 0, limit: 10'
commit_case fail-unbounded-find 'feat(fixture): drop the bounds from a local read' "$CONFORMING_BODY"
expect fail-unbounded-find payload-rules FAIL no-unbounded-find

new_case fail-collection-access
drop_text "$scratch/fail-collection-access/src/collections/Posts.ts" "  access: {
    read: (): boolean => true,
    create: (): boolean => false,
    update: (): boolean => false,
    delete: (): boolean => false,
  },
"
commit_case fail-collection-access 'feat(fixture): omit the collection access rules' "$CONFORMING_BODY"
expect fail-collection-access payload-rules FAIL require-collection-access

new_case fail-commit-message
commit_case fail-commit-message 'wip' ''
expect fail-commit-message commit-history FAIL 'invalid header'

new_case fail-asset-drift
printf 'drift\n' >> "$scratch/fail-asset-drift/.editorconfig"
commit_case fail-asset-drift 'feat(fixture): edit a pinned managed file' "$CONFORMING_BODY"
expect fail-asset-drift assets FAIL .editorconfig

# A pinned file and a managed section fail for different reasons, so proving one says nothing about the
# other: the section is spliced rather than rewritten, and only the marked block is judged.
new_case fail-section-drift
drop_text "$scratch/fail-section-drift/AGENTS.md" \
    '2. Follow the complete ploaness contract in `.ploaness/agent-guide.md`.'
commit_case fail-section-drift 'feat(fixture): edit the managed section' "$CONFORMING_BODY"
expect fail-section-drift assets FAIL 'managed block drifted'

# Ambiguous markers are a separate verdict from drift, because they are the one managed-file defect
# `ploaness sync` cannot repair: the gate must send the project to a human rather than round a loop.
new_case fail-section-duplicated
duplicate_file "$scratch/fail-section-duplicated/AGENTS.md"
commit_case fail-section-duplicated 'feat(fixture): duplicate the managed section' "$CONFORMING_BODY"
expect fail-section-duplicated assets FAIL 'repair the markers by hand'

# Text the project owns below the block is not ploaness's to judge, so adding some must not fail.
new_case pass-section-project-text
printf '\n## Project notes\n\nThe project owns everything below the managed block.\n' \
    >> "$scratch/pass-section-project-text/AGENTS.md"
commit_case pass-section-project-text 'feat(fixture): add project text below the managed section' \
    "$CONFORMING_BODY"
expect pass-section-project-text assets PASS

echo
if [ "$failures" -eq 0 ]; then
    echo 'ploaness integration suite passed.'
else
    echo "ploaness integration suite failed: $failures assertion(s)." >&2
fi
exit "$failures"
