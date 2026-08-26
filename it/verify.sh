#!/usr/bin/env sh
# Verifies the packed harness from an isolated consumer repository, the way a published consumer would
# install it. Nothing under the ploaness working tree is written.
#
# What this suite proves: that a project scaffolded by `ploaness init` satisfies the gates ploaness
# applies to a project's own shape, and that removing one guarantee fails that guarantee's gate rather
# than merely failing something.
#
# It also compiles and lints the fixture, which the paragraph above once said it could not. That was
# true while ploaness shipped only configurations; it stopped being true when ploaness began shipping
# executable specs it cannot read as code from its own side - it is a library with no Payload
# application, so `check-asset-bodies.sh` reaches those specs with Biome alone, which carries no type
# information and none of the rules the shipped ESLint config states. This fixture receives them from
# `ploaness init` exactly as a consumer does, so it is where they are first read as the code they are.
# Two defects had already escaped to real projects by the time that was noticed.
#
# What it still does not prove: `tests`, `build`, and `e2e`. Those need a real Payload application and
# a browser, and are proven end to end by a consumer project rather than by a fixture.
set -eu

# The gate report has two formats, and the ASCII one carries the `[PASS] <id>` token every assertion
# below greps for. `report.ts` chooses the rich format whenever FORCE_COLOR is set, TTY or not - which
# CI images commonly export - so every one of these assertions would fail on a verdict that was correct.
# Declared here rather than assumed, because the greps are a contract with that format.
NO_COLOR=1
export NO_COLOR
unset FORCE_COLOR

here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/.." && pwd)"
tarballs="$root/dist-tarballs"
failures=0

# Counted rather than named. The five package names and the version `1.0.0` were both written out here,
# a second copy of what `packages/` and its manifests already say - so a version bump would have failed
# this suite with "missing tarball, run pack-local.sh first", which would not have been true.
expected_tarballs="$(find "$root/packages" -maxdepth 2 -name package.json | wc -l | tr -d ' ')"
actual_tarballs="$(find "$tarballs" -maxdepth 1 -name '*.tgz' 2>/dev/null | wc -l | tr -d ' ')"
if [ "$actual_tarballs" != "$expected_tarballs" ]; then
    echo "found $actual_tarballs tarball(s) in $tarballs, expected $expected_tarballs;" >&2
    echo "run scripts/pack-local.sh first" >&2
    exit 1
fi

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
    if [ "$verdict" = PASS ]; then
        marker="\[PASS\] $gate"
    else
        marker="\[$verdict\] $gate"
    fi
    if ! printf '%s' "$output" | grep -q "$marker"; then
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

# Assert an ordinary CLI command's exit status and one piece of its report. Gate assertions use the
# structured marker above; commands such as `commit-message` and `init` deliberately have no gate marker.
expect_command() {
    name="$1"
    verdict="$2"
    needle="$3"
    shift 3
    directory="$scratch/$name"
    if output="$(cd "$directory" && "$@" 2>&1)"; then
        actual=PASS
    else
        actual=FAIL
    fi
    if [ "$actual" != "$verdict" ] || ! printf '%s' "$output" | grep -q "$needle"; then
        echo "FAILED $name: command was $actual, expected $verdict mentioning \"$needle\"" >&2
        echo "$output" | sed 's/^/    /' >&2
        failures=$((failures + 1))
        return
    fi
    echo "ok $name: command is $verdict ($needle)"
}

# The network guard runs inside the suite rather than inside a gate, so proving it needs a spec rather
# than an `expect`. The fixture's own vitest runs that spec, in the node environment and without
# coverage: neither the DOM nor the thresholds is what these two cases are about. No commit is made for
# them, because nothing here reads the history.
#
# The assertion is on the rule sentence, not merely on failure. An unguarded run would fail the remote
# case too - on a DNS error - and a case that cannot tell those two apart proves nothing.
expect_suite() {
    name="$1"
    verdict="$2"
    needle="$3"
    directory="$scratch/$name"
    if output="$(cd "$directory" && ./node_modules/.bin/vitest run --environment=node \
        tests/unit/network-guard.unit.spec.ts 2>&1)"; then
        actual=PASS
    else
        actual=FAIL
    fi
    if [ "$actual" != "$verdict" ]; then
        echo "FAILED $name: the suite was $actual, expected $verdict" >&2
        echo "$output" | sed 's/^/    /' >&2
        failures=$((failures + 1))
        return
    fi
    if [ -n "$needle" ] && ! printf '%s' "$output" | grep -q "$needle"; then
        echo "FAILED $name: the suite was $verdict but never mentioned \"$needle\"" >&2
        echo "$output" | sed 's/^/    /' >&2
        failures=$((failures + 1))
        return
    fi
    echo "ok $name: the suite is $verdict${needle:+ (${needle})}"
}

# Each mutation is a program in `it/lib/`, not a string passed to `node -e`. Inline, they were code no
# formatter, linter, or type checker read - the same blind spot the staged asset bodies exist to close.
lib="$(cd "$(dirname "$0")" && pwd)/lib"

edit_json() {
    node "$lib/edit-json.mjs" "$@"
}

duplicate_file() {
    node "$lib/duplicate-file.mjs" "$@"
}

# Reads one non-blank line out of the managed body ploaness ships. A fixture that restated the managed
# text in its own words is a second copy of a value ploaness owns, and it degrades into a silent no-op
# the moment ploaness rewords the block - which is exactly the defect this suite exists to catch.
managed_line() {
    node "$lib/managed-line.mjs" "$@"
}

drop_text() {
    node "$lib/drop-text.mjs" "$@"
}


CONFORMING_BODY='The fixture exercises the packed harness from outside the workspace, which is the
only arrangement that resolves the way a published install does.'

# The pass case: the untouched scaffold must satisfy every gate that judges a project's own shape.
new_case pass
commit_case pass 'feat(fixture): add the ploaness integration consumer' "$CONFORMING_BODY"
# `install-scripts` is here because its only other fixture is a failure case, and this file's own
# reasoning applies symmetrically: a rule that only ever failed proves as little as one that only ever
# passed - neither tells you the gate is wired to the scaffold at all.
for gate in preflight wiring assets conventions editorconfig suppressions generated-denial \
            payload-rules config-refs install-scripts require-full-history commit-history \
            linear-history; do
    expect pass "$gate" PASS
done

# The gates that compile and lint, run here because ploaness ships executable specs and can judge none
# of them itself: it is a library with no Payload application, so `check-asset-bodies.sh` reaches them
# with Biome alone, which carries no type information and none of the rules the shipped ESLint config
# states. This fixture IS a consumer, and it receives those specs from `ploaness init` like any other,
# so it is the first place in this repository where they are read as the code they are.
#
# Both defects that reached a real project were of exactly this kind: a type the sweep imported and the
# entry point never exported, and a callback passed by reference. Each would have failed here.
expect pass types PASS
expect pass eslint PASS

# The two history modes are options of `commit-message`, not global CLI flags. A global allowlist once
# rejected both documented forms before their handler could read them.
expect_command pass PASS 'commit message(s) conform' \
    ./node_modules/.bin/ploaness commit-message --all
expect_command pass PASS 'commit message(s) conform' \
    ./node_modules/.bin/ploaness commit-message --range HEAD

# Options are command-specific: a known option on the wrong command, and any unknown single-dash option,
# are invalid rather than positional text a handler silently ignores.
expect_command pass FAIL 'invalid arguments' ./node_modules/.bin/ploaness gates --extended
expect_command pass FAIL 'invalid arguments' ./node_modules/.bin/ploaness gates -x

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
    read: anyone,
    create: nobody,
    update: nobody,
    delete: nobody,
  },
"
commit_case fail-collection-access 'feat(fixture): omit the collection access rules' "$CONFORMING_BODY"
expect fail-collection-access payload-rules FAIL require-complete-access

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

# A tool-specific instruction file may exist or not, but one that exists points at AGENTS.md and states
# nothing else. Two agents answering to two contracts is the failure; both cases are asserted, because a
# rule that only ever passed would be indistinguishable from one that was never wired in.
new_case pass-agent-reference
printf 'Follow the rules in AGENTS.md at the repository root.\n' \
    > "$scratch/pass-agent-reference/GEMINI.md"
commit_case pass-agent-reference 'feat(fixture): point Gemini at the root instructions' "$CONFORMING_BODY"
expect pass-agent-reference assets PASS

new_case fail-agent-reference
printf 'See AGENTS.md.\n\nAlways use tabs for indentation in this project.\n' \
    > "$scratch/fail-agent-reference/GEMINI.md"
commit_case fail-agent-reference 'feat(fixture): give Gemini rules of its own' "$CONFORMING_BODY"
expect fail-agent-reference assets FAIL 'instructions of its own'

# Ambiguous markers are a separate verdict from drift, because they are the one managed-file defect
# `ploaness sync` cannot repair: the gate must send the project to a human rather than round a loop.
new_case fail-section-duplicated
duplicate_file "$scratch/fail-section-duplicated/AGENTS.md"
commit_case fail-section-duplicated 'feat(fixture): duplicate the managed section' "$CONFORMING_BODY"
expect fail-section-duplicated assets FAIL 'repair the markers by hand'
expect_command fail-section-duplicated FAIL 'Repair the markers by hand' \
    ./node_modules/.bin/ploaness init

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

# Harness Integrity. Each of these passed before: a project could swap a config the harness believes it
# owns, or undo a pinned version through an override.
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

# Left undeclared, every package in the resolved set may run code during install.
new_case fail-install-scripts
node "$lib/drop-install-allowlist.mjs" "$scratch/fail-install-scripts/pnpm-workspace.yaml"
commit_case fail-install-scripts 'feat(fixture): drop the install-script allowlist' "$CONFORMING_BODY"
expect fail-install-scripts install-scripts FAIL 'onlyBuiltDependencies'

# Payload fills the missing operations in during sanitisation, so a partial access block is invisible
# once the app boots. The rule this replaced accepted one operation out of four.
# An upload collection that restricts nothing takes whatever a client sends, and an SVG served from
# the application's own origin is script that runs as the site.
new_case fail-unrestricted-upload
drop_text "$scratch/fail-unrestricted-upload/src/collections/Media.ts" "    mimeTypes: ['image/png', 'image/jpeg'],
"
commit_case fail-unrestricted-upload 'feat(fixture): let the upload collection take any file' "$CONFORMING_BODY"
expect fail-unrestricted-upload payload-rules FAIL require-upload-restrictions

# `auth: true` is Payload's bare enable, and it caps nothing: without a login-attempt limit and a lock
# time the collection accepts guesses as fast as a client can make them. Unlike the always-true forms,
# this one a conforming project CAN write, which is why it is the auth rule worth a fixture.
new_case fail-unhardened-auth
drop_text "$scratch/fail-unhardened-auth/src/collections/Users.ts" "    maxLoginAttempts: 5,
"
commit_case fail-unhardened-auth 'feat(fixture): drop the login-attempt cap' "$CONFORMING_BODY"
expect fail-unhardened-auth payload-rules FAIL require-auth-hardening

new_case fail-partial-access
drop_text "$scratch/fail-partial-access/src/collections/Posts.ts" "    create: nobody,
"
commit_case fail-partial-access 'feat(fixture): leave one operation to the defaults' "$CONFORMING_BODY"
expect fail-partial-access payload-rules FAIL require-complete-access

# Globals were covered by no rule at all before this.
new_case fail-global-access
drop_text "$scratch/fail-global-access/src/globals/Header.ts" "    update: nobody,
"
commit_case fail-global-access 'feat(fixture): leave a global update undeclared' "$CONFORMING_BODY"
expect fail-global-access payload-rules FAIL require-complete-access

# A range on a package a gate depends on lets an upstream release change a verdict while the project
# stays unchanged, which is what pinning the toolchain exists to prevent.
new_case fail-ranged-toolchain
edit_json "$scratch/fail-ranged-toolchain/package.json" devDependencies.vitest '^4.1.11'
commit_case fail-ranged-toolchain 'feat(fixture): loosen a pinned toolchain version' "$CONFORMING_BODY"
expect fail-ranged-toolchain wiring FAIL 'ploaness pins it'

# An exclusion that matches nothing leaves the report reading exactly as it would have read without it,
# so it records a decision nobody can see the effect of - and it outlives the file it was written for.
new_case fail-dead-coverage-exclusion
edit_json "$scratch/fail-dead-coverage-exclusion/package.json" ploaness.coverageExclude \
    '[{"pattern":"src/legacy/**","reason":"vendored from the previous stack, not hand-written here"}]'
commit_case fail-dead-coverage-exclusion 'feat(fixture): exclude a path coverage never measures' "$CONFORMING_BODY"
expect fail-dead-coverage-exclusion config-refs FAIL 'excludes nothing'

new_case fail-unexplained-exclusion
edit_json "$scratch/fail-unexplained-exclusion/package.json" ploaness.typographyExclusions \
    '["^docs/"]'
commit_case fail-unexplained-exclusion 'feat(fixture): exclude a path without a reason' "$CONFORMING_BODY"
expect fail-unexplained-exclusion wiring FAIL 'states no reason'

# The standard pins the toolchain so an upstream release cannot change a verdict while the project
# stays unchanged. A range on an application dependency is that same hole one layer down: the build,
# the suite and the end-to-end run all execute against something nobody wrote down.
#
# The caret is on the PINNED version, so the range is the only defect the fixture carries. Written
# against `^16.3.1` the case failed for two reasons at once - a range, and a version that is not the
# pinned one - and a fixture with two reasons to fail does not prove which rule caught it.
new_case fail-ranged-dependency
edit_json "$scratch/fail-ranged-dependency/package.json" dependencies.next '^16.3.2'
commit_case fail-ranged-dependency 'feat(fixture): declare a dependency as a range' "$CONFORMING_BODY"
expect fail-ranged-dependency wiring FAIL 'which is a range'

# Corepack runs exactly the package manager named here, so it decides how every other pinned version
# resolves. A project on a different pnpm can build a different tree from the same lockfile.
new_case fail-package-manager
edit_json "$scratch/fail-package-manager/package.json" packageManager 'pnpm@10.0.0'
commit_case fail-package-manager 'feat(fixture): run a package manager ploaness does not pin' \
    "$CONFORMING_BODY"
expect fail-package-manager wiring FAIL 'packageManager'

# preflight reads the Node that is running. The engines block is what the project tells an installer
# and a CI image to use, which is a different statement and was unchecked.
new_case fail-engines
edit_json "$scratch/fail-engines/package.json" engines.node '>=20'
commit_case fail-engines 'feat(fixture): declare a runtime ploaness refuses' "$CONFORMING_BODY"
expect fail-engines wiring FAIL 'engines.node'

# The pnpm half of the same block, which is derived from `packageManager` rather than pinned beside it.
# A floor here is the range ban unapplied to the one tool that resolves every other pin: it tells an
# installer that any pnpm 11 will build the same tree, while `packageManager` names exactly one.
new_case fail-engines-pnpm
edit_json "$scratch/fail-engines-pnpm/package.json" engines.pnpm '>=11'
commit_case fail-engines-pnpm 'feat(fixture): declare a package manager floor beside an exact pin' \
    "$CONFORMING_BODY"
expect fail-engines-pnpm wiring FAIL 'engines.pnpm'

# ploaness owns the version of a Postgres driver without deciding that every project uses Postgres:
# an unrequired pin is matched when declared and forced on nobody.
new_case fail-ecosystem-version
edit_json "$scratch/fail-ecosystem-version/package.json" devDependencies.pg '8.22.0'
commit_case fail-ecosystem-version 'feat(fixture): take an ecosystem version ploaness does not pin' \
    "$CONFORMING_BODY"
expect fail-ecosystem-version wiring FAIL 'ploaness pins it'

# The same pin, absent: a project with no Postgres is not asked to grow one.
new_case pass-ecosystem-absent
node "$lib/delete-dependency.mjs" "$scratch/pass-ecosystem-absent/package.json" pg
commit_case pass-ecosystem-absent 'feat(fixture): drop a package ploaness pins but never requires' \
    "$CONFORMING_BODY"
expect pass-ecosystem-absent wiring PASS

# A type package is an input to tsc, so a patch release changes what type-checks while the project
# stays unchanged. Pinning one is the toolchain argument applied to types.
new_case fail-types-version
edit_json "$scratch/fail-types-version/package.json" 'devDependencies.@types/react' '19.2.17'
commit_case fail-types-version 'feat(fixture): take a type version ploaness does not pin' \
    "$CONFORMING_BODY"
expect fail-types-version wiring FAIL 'ploaness pins it'

# The required set is derived from the pin file, so a pinned package the project never declares is a
# missing dependency rather than an entry that quietly enforces nothing.
new_case fail-missing-pin
node "$lib/delete-dependency.mjs" "$scratch/fail-missing-pin/package.json" '@types/node'
commit_case fail-missing-pin 'feat(fixture): drop a package ploaness pins' "$CONFORMING_BODY"
expect fail-missing-pin wiring FAIL 'missing'

# Changing the version is not the only way to change what a version installs. A patch keeps the version
# and swaps the code, which is the quietest of the three and invisible in the dependency block.
new_case fail-patched-pin
edit_json "$scratch/fail-patched-pin/package.json" 'pnpm.patchedDependencies.vitest@4.1.11' \
    'patches/vitest.patch'
commit_case fail-patched-pin 'feat(fixture): patch a package ploaness pins' "$CONFORMING_BODY"
expect fail-patched-pin wiring FAIL 'changes what a version ploaness pins installs'

# ploaness owns the framework version outright, not merely the analyzers that measure it.
new_case fail-framework-version
edit_json "$scratch/fail-framework-version/package.json" dependencies.next '16.3.0'
commit_case fail-framework-version 'feat(fixture): take a framework version ploaness does not pin' \
    "$CONFORMING_BODY"
expect fail-framework-version wiring FAIL 'ploaness pins it'

# Payload fails at runtime when its own packages disagree. The rule is derived from the pinned payload
# version, so a package ploaness has never heard of is still covered.
new_case fail-payload-family
edit_json "$scratch/fail-payload-family/package.json" \
    'dependencies.@payloadcms/plugin-form-builder' '3.87.0'
commit_case fail-payload-family 'feat(fixture): mismatch a Payload package version' "$CONFORMING_BODY"
expect fail-payload-family wiring FAIL 'when its own packages disagree'

# An override of a package the project declares makes the installed version differ from the declared
# one, which guts every pin above it. An override of a purely transitive package stays legal.
new_case fail-declared-override
printf '  nanoid: "5.0.0"\n' >> "$scratch/fail-declared-override/pnpm-workspace.yaml"
commit_case fail-declared-override 'feat(fixture): override a package the project declares' \
    "$CONFORMING_BODY"
expect fail-declared-override wiring FAIL 'change the declaration instead'

# The rule is not "no overrides". A transitive package carrying an advisory with no upgrade path above
# it can be reached no other way, and the standard says to resolve it by upgrading.
new_case pass-transitive-override
printf '  dompurify: "^3.4.14"\n' >> "$scratch/pass-transitive-override/pnpm-workspace.yaml"
commit_case pass-transitive-override 'feat(fixture): override a purely transitive package' \
    "$CONFORMING_BODY"
expect pass-transitive-override wiring PASS

new_case fail-playwright-config-swapped
printf "import { defineConfig } from '@playwright/test'\n\nexport default defineConfig({ forbidOnly: false })\n" \
    > "$scratch/fail-playwright-config-swapped/playwright.config.ts"
commit_case fail-playwright-config-swapped 'feat(fixture): replace the owned playwright config' \
    "$CONFORMING_BODY"
expect fail-playwright-config-swapped wiring FAIL 'playwright.config.ts'

# ploaness ships the accessibility sweep as a managed spec, and that spec carries the one scoped lint
# exemption its crawl needs. A consumer can neither remove it nor be asked to justify it, so it must not
# spend a budget that on a small project is four or five in total. A ceiling of zero proves the joint:
# the only suppression in this tree is the one inside the file ploaness owns.
new_case pass-managed-suppression
edit_json "$scratch/pass-managed-suppression/package.json" ploaness.maxSuppressions 0
commit_case pass-managed-suppression 'feat(fixture): forbid every suppression the project owns' \
    "$CONFORMING_BODY"
expect pass-managed-suppression suppressions PASS

# Text the project owns below the block is not ploaness's to judge, so adding some must not fail.
new_case pass-section-project-text
printf '\n## Project notes\n\nThe project owns everything below the managed block.\n' \
    >> "$scratch/pass-section-project-text/AGENTS.md"
commit_case pass-section-project-text 'feat(fixture): add project text below the managed section' \
    "$CONFORMING_BODY"
expect pass-section-project-text assets PASS

# The network guard, from both sides. A database on loopback is the case the guard exists to leave
# alone, and a host beyond the machine is the case it exists to refuse.
new_case pass-guard-allows-loopback
mkdir -p "$scratch/pass-guard-allows-loopback/tests/unit"
cat > "$scratch/pass-guard-allows-loopback/tests/unit/network-guard.unit.spec.ts" <<'LOOPBACK'
import net from 'node:net'
import { expect, it } from 'vitest'

const LOOPBACK: string = ['127', '0', '0', '1'].join('.')

it('reaches a server listening on this machine', async () => {
  const server: net.Server = net.createServer((socket: net.Socket): void => {
    socket.end()
  })
  const port: number = await new Promise<number>((resolve: (value: number) => void): void => {
    server.listen(0, LOOPBACK, (): void => {
      const address: net.AddressInfo | string | null = server.address()
      resolve(typeof address === 'object' && address !== null ? address.port : 0)
    })
  })
  const reached: boolean = await new Promise<boolean>(
    (resolve: (value: boolean) => void, reject: (reason: Error) => void): void => {
      const client: net.Socket = net.connect(port, LOOPBACK)
      client.on('connect', (): void => {
        client.end()
        resolve(true)
      })
      client.on('error', reject)
    },
  )
  server.close()
  expect(reached).toBe(true)
})
LOOPBACK
expect_suite pass-guard-allows-loopback PASS 'passed'

new_case fail-guard-blocks-remote
mkdir -p "$scratch/fail-guard-blocks-remote/tests/unit"
cat > "$scratch/fail-guard-blocks-remote/tests/unit/network-guard.unit.spec.ts" <<'REMOTE'
import { expect, it } from 'vitest'

it('reaches a host beyond this machine', async () => {
  const response: Response = await fetch('https://ploaness.invalid/')
  expect(response.ok).toBe(true)
})
REMOTE
expect_suite fail-guard-blocks-remote FAIL 'no network beyond the machine'

echo
if [ "$failures" -eq 0 ]; then
    echo 'ploaness integration suite passed.'
else
    echo "ploaness integration suite failed: $failures assertion(s)." >&2
fi
exit "$failures"
