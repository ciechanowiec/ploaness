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
      // Create a missing parent rather than crashing: a case that sets `ploaness.maxSuppressions` on a
      // fixture that declares no `ploaness` key is setting it for the first time, which is the point.
      for (const key of keys.slice(0, -1)) {
        if (typeof cursor[key] !== "object" || cursor[key] === null) { cursor[key] = {} }
        cursor = cursor[key]
      }
      // argv is text. A value that parses as JSON is stored as JSON, so a numeric ceiling of 0 is
      // written as 0 and not as "0", which the settings reader would drop as malformed.
      let parsedValue = value
      try { parsedValue = JSON.parse(value) } catch { parsedValue = value }
      cursor[keys.at(-1)] = parsedValue
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

# Reads one non-blank line out of the managed body ploaness ships. A fixture that restated the managed
# text in its own words is a second copy of a value ploaness owns, and it degrades into a silent no-op
# the moment ploaness rewords the block - which is exactly the defect this suite exists to catch.
managed_line() {
    node -e '
      const { readFileSync } = require("node:fs")
      const [file, index] = process.argv.slice(1)
      const lines = readFileSync(file, "utf8")
        .split("\n")
        .filter((line) => line.trim().length > 0)
      const line = lines[Number(index)]
      if (line === undefined) {
        console.error(`the managed body has no non-blank line ${index}`)
        process.exit(1)
      }
      process.stdout.write(line)
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
for gate in preflight wiring assets conventions editorconfig suppressions generated-denial \
            payload-rules config-refs require-full-history commit-history linear-history; do
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
    "$(managed_line "$root/packages/assets/files/AGENTS.md.asset" 4)"
commit_case fail-section-drift 'feat(fixture): edit the managed section' "$CONFORMING_BODY"
expect fail-section-drift assets FAIL 'managed block drifted'

# Ambiguous markers are a separate verdict from drift, because they are the one managed-file defect
# `ploaness sync` cannot repair: the gate must send the project to a human rather than round a loop.
new_case fail-section-duplicated
duplicate_file "$scratch/fail-section-duplicated/AGENTS.md"
commit_case fail-section-duplicated 'feat(fixture): duplicate the managed section' "$CONFORMING_BODY"
expect fail-section-duplicated assets FAIL 'repair the markers by hand'

# A junk word is rejected anywhere in the subject, not only as its first word. The gate accepted
# `fix: clear the tmp directory` until the anchor came off, so this case pins the unanchored form.
new_case fail-commit-junk-word
commit_case fail-commit-junk-word 'fix: clear the tmp directory' ''
expect fail-commit-junk-word commit-history FAIL 'low-effort'

# `revert` is not a type the governing standard lists. A spec once asserted the opposite, so the
# fixture proves the gate and the standard now agree.
new_case fail-commit-revert-type
commit_case fail-commit-revert-type 'revert: restore the previous gate' "$CONFORMING_BODY"
expect fail-commit-revert-type commit-history FAIL 'invalid header'

# The committed .editorconfig is pinned, and until now nothing checked a file against it.
new_case fail-editorconfig
printf 'const trailing = 1   \n' >> "$scratch/fail-editorconfig/src/lib/reads.ts"
commit_case fail-editorconfig 'feat(fixture): add trailing whitespace to a source file' "$CONFORMING_BODY"
expect fail-editorconfig editorconfig FAIL 'trailing whitespace'

# The typography ban reads every tracked text file, not an allowlist of extensions. A stylesheet was
# outside that allowlist, so this case proves the widened scope rather than the rule.
new_case fail-typography-css
printf '/* an em %s dash in a stylesheet */\n' "$(printf '\342\200\224')" \
    > "$scratch/fail-typography-css/src/app.css"
commit_case fail-typography-css 'feat(fixture): add a stylesheet with banned typography' "$CONFORMING_BODY"
expect fail-typography-css conventions FAIL 'em dash'

# A project may declare a stricter ceiling and never a looser one. Zero states that no suppression is
# permitted, which is the cheapest way to prove the gate binds.
new_case fail-suppressions
edit_json "$scratch/fail-suppressions/package.json" ploaness.maxSuppressions 0
printf '// @ts-expect-error the fixture needs one suppression to exceed a ceiling of zero\nexport const unused: number = "text"\n' \
    > "$scratch/fail-suppressions/src/lib/suppressed.ts"
commit_case fail-suppressions 'feat(fixture): exceed a declared suppression ceiling' "$CONFORMING_BODY"
expect fail-suppressions suppressions FAIL 'ceiling'

# `init` writes the write denial for the generated Payload artefacts. Removing it must fail the gate
# that requires it, which is what proves the scaffolder and that gate still agree.
new_case fail-generated-denial
edit_json "$scratch/fail-generated-denial/.claude/settings.json" permissions.deny '[]'
commit_case fail-generated-denial 'feat(fixture): drop the generated-file write denial' "$CONFORMING_BODY"
expect fail-generated-denial generated-denial FAIL 'no write denial'

# The finding tells the project to run `ploaness sync`, so sync must actually be able to repair it. It
# could not: the write denial was written by `init` alone, and a project following the advice went round
# a loop. This case pins the repair to the advice.
new_case pass-denial-repaired
edit_json "$scratch/pass-denial-repaired/.claude/settings.json" permissions.deny '[]'
(cd "$scratch/pass-denial-repaired" && ./node_modules/.bin/ploaness sync >/dev/null 2>&1)
commit_case pass-denial-repaired 'feat(fixture): let sync repair the write denial' "$CONFORMING_BODY"
expect pass-denial-repaired generated-denial PASS

# Harness Integrity. Each of these passed before: a project could go green forever with one flag, swap a
# config the harness believes it owns, or undo a pinned version through an override.
new_case fail-report-only-ci
node -e '
  const { readFileSync, writeFileSync } = require("node:fs")
  const file = process.argv[1]
  const text = readFileSync(file, "utf8")
  writeFileSync(file, text.replace("run verify:full", "run verify:full --enforce=false"))
' "$scratch/fail-report-only-ci/.github/workflows/verify.yml"
commit_case fail-report-only-ci 'feat(fixture): run verification in report-only mode' "$CONFORMING_BODY"
expect fail-report-only-ci wiring FAIL 'not a pass'

new_case fail-vitest-config-swapped
printf "import { defineConfig } from 'vitest/config'\n\nexport default defineConfig({})\n" \
    > "$scratch/fail-vitest-config-swapped/vitest.config.mts"
commit_case fail-vitest-config-swapped 'feat(fixture): replace the owned vitest config' "$CONFORMING_BODY"
expect fail-vitest-config-swapped wiring FAIL 'vitest.config.mts'

new_case fail-pinned-override
# Into the existing overrides block, which sits last in the file. A second `overrides:` key would be
# invalid YAML, and pnpm would read only the first.
printf '  vitest: "3.0.0"\n' >> "$scratch/fail-pinned-override/pnpm-workspace.yaml"
commit_case fail-pinned-override 'feat(fixture): override a version ploaness pins' "$CONFORMING_BODY"
expect fail-pinned-override wiring FAIL 'pins'

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
