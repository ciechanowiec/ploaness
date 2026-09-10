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
# The accessibility name contracts also run the pinned browser sweep against a real Next server.
# Full Payload tests, builds, and end-to-end flows still require the real consumer verification leg.
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
# mounts as an empty directory rather than as an error. Keep the directory visible: the pinned Biome
# scanner skips nested members when an ancestor such as .cache is hidden.
scratch="$(mktemp -d "$HOME/ploaness-it-XXXXXX")"
trap 'chmod -R u+w "$scratch" 2>/dev/null || true; rm -rf "$scratch" 2>/dev/null || true' EXIT INT TERM

template="$scratch/template"
mkdir -p "$template"
tar cf - -C "$here/project" . | tar xf - -C "$template"
sed "s#__TARBALLS__#$tarballs#g" "$here/project/pnpm-workspace.yaml" > "$template/pnpm-workspace.yaml"

# Temporary fixtures generate their lockfiles from the scenario's manifest. Exercise CI install
# defaults locally too, and allow only these disposable lockfiles to change when a scenario adds a
# dependency. Retain installer diagnostics so a setup failure explains why the gate was never reached.
install_case() {
    directory="$1"
    if (cd "$directory" && CI=true pnpm install --no-frozen-lockfile > "$scratch/install.log" 2>&1); then
        return 0
    fi
    echo "FAILED fixture installation in $directory" >&2
    cat "$scratch/install.log" >&2
    return 1
}

echo "installing the packed harness into the fixture template"
install_case "$template"
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

# Assert a gate's verdict when it is run from INSIDE a member rather than at the repository root. Both
# scope defects were only visible from there: at the root the gates read the right files by accident.
expect_in() {
    name="$1"
    member="$2"
    gate="$3"
    verdict="$4"
    needle="${5-}"
    directory="$scratch/$name/$member"
    if output="$(cd "$directory" && "$scratch/$name/node_modules/.bin/ploaness" gate "$gate" 2>&1)"; then
        actual=PASS
    else
        actual=FAIL
    fi
    if [ "$actual" != "$verdict" ]; then
        echo "FAILED $name: gate $gate in $member was $actual, expected $verdict" >&2
        echo "$output" | sed 's/^/    /' >&2
        failures=$((failures + 1))
        return
    fi
    if [ -n "$needle" ] && ! printf '%s' "$output" | grep -q "$needle"; then
        echo "FAILED $name: gate $gate in $member was $verdict but never mentioned \"$needle\"" >&2
        echo "$output" | sed 's/^/    /' >&2
        failures=$((failures + 1))
        return
    fi
    echo "ok $name: $gate in $member is $verdict${needle:+ (${needle})}"
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
    printf '%s\n' "$output" > "$directory/command-output.log"
    if [ "$actual" != "$verdict" ] || ! printf '%s' "$output" | grep -q "$needle"; then
        echo "FAILED $name: command was $actual, expected $verdict mentioning \"$needle\"" >&2
        echo "$output" | sed 's/^/    /' >&2
        failures=$((failures + 1))
        return
    fi
    echo "ok $name: command is $verdict ($needle)"
}

# The network guard runs inside the suite rather than inside a gate, so proving it needs a spec rather
# than an `expect`. The fixture's own vitest runs that spec, in the node suite and without coverage:
# neither the DOM nor the thresholds is what these two cases are about. No commit is made for them,
# because nothing here reads the history.
#
# The suite is chosen by where the spec is WRITTEN rather than by `--environment=node`, which the
# shipped config no longer honours: it declares per-environment projects, and a project's environment is
# its own. The flag was also hiding a property of this fixture. A case shares one install by symlinking
# its `node_modules` at a template outside the case directory, so the store's real path lies outside
# `searchForWorkspaceRoot(root)` - the one entry Vite's file-serving allow-list holds by default. The
# jsdom suite fetches its setup files THROUGH that server, as `/@fs/<path>`, and would be refused the
# harness setup file; the node suite imports them natively and never asks. No consumer has this shape,
# because a project's own `.pnpm` store sits under its workspace root; the template, which has a real
# `node_modules`, runs the same spec under jsdom and passes.
#
# The assertion is on the rule sentence, not merely on failure. An unguarded run would fail the remote
# case too - on a DNS error - and a case that cannot tell those two apart proves nothing.
expect_suite() {
    name="$1"
    verdict="$2"
    needle="$3"
    directory="$scratch/$name"
    if output="$(cd "$directory" && ./node_modules/.bin/vitest run \
        tests/int/network-guard.int.spec.ts 2>&1)"; then
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
    node "$lib/edit-json.ts" "$@"
}

duplicate_file() {
    node "$lib/duplicate-file.ts" "$@"
}

# Reads one non-blank line out of the managed body ploaness ships. A fixture that restated the managed
# text in its own words is a second copy of a value ploaness owns, and it degrades into a silent no-op
# the moment ploaness rewords the block - which is exactly the defect this suite exists to catch.
managed_line() {
    node "$lib/managed-line.ts" "$@"
}

drop_text() {
    node "$lib/drop-text.ts" "$@"
}

replace_text() {
    node "$lib/replace-text.ts" "$@"
}


CONFORMING_BODY='The fixture exercises the packed harness from outside the workspace, which is the
only arrangement that resolves the way a published install does.'

# Kept in two context-free fragments so the verifier itself does not match the analyzer rule. The
# fixture cases below assemble the bytes beside an assembled key label only after their commit.
probe_part_one='dGhpcy1pc19hX3Zlcnlfc2VjcmV0'
probe_part_two='X2tleV93aXRoX2VudHJvcHk'

# A declared focused subset for iterating on the new analyzer; the default run remains complete.
case "${1-}" in
    ''|--jsx-only|--native-only) ;;
    *) echo 'usage: verify.sh [--jsx-only|--native-only]' >&2; exit 1 ;;
esac

# The pass case: the untouched scaffold must satisfy every gate that judges a project's own shape.
new_case pass
commit_case pass 'feat(fixture): add the ploaness integration consumer' "$CONFORMING_BODY"
# The native accessibility contracts execute the actual packed CLI and its generated configuration.
expect pass preflight PASS
expect pass wiring PASS
expect pass assets PASS
expect pass oxlint PASS
new_case native-contracts
commit_case native-contracts 'test(fixture): establish native core conformance cases' "$CONFORMING_BODY"
expect_command native-contracts PASS '30 native source and suppression contracts passed' \
    node "$lib/oxlint-conformance.ts" "$here/fixtures/oxlint-core.json" \
    "$scratch/native-contracts/node_modules/.bin/ploaness"

if [ "${1-}" = --native-only ]; then
    if [ "$failures" -ne 0 ]; then
        echo "$failures native fixture assertion(s) failed" >&2
        exit 1
    fi
    echo 'native core fixture contracts passed'
    exit 0
fi

new_case jsx-contracts
commit_case jsx-contracts 'test(fixture): establish native JSX conformance cases' "$CONFORMING_BODY"
expect_command jsx-contracts PASS '70 JSX detection and valid-markup contracts passed' \
    node "$lib/jsx-conformance.ts" "$here/fixtures/jsx-accessibility.json" \
    "$scratch/jsx-contracts/node_modules/.bin/ploaness"

# Source written after a commit remains in scope, and an unrelated ignore file cannot hide it.
new_case fail-untracked-jsx
commit_case fail-untracked-jsx 'test(fixture): establish new JSX source coverage' "$CONFORMING_BODY"
printf '%s\n' 'export const image = <img src="/photo.png" />' > "$scratch/fail-untracked-jsx/src/Untracked.tsx"
printf '%s\n' 'src/Untracked.tsx' > "$scratch/fail-untracked-jsx/.eslintignore"
expect fail-untracked-jsx oxlint FAIL 'jsx-a11y(alt-text)'

new_case fail-nested-oxlint
mkdir -p "$scratch/fail-nested-oxlint/src/nested"
printf '%s\n' '{"rules":{"jsx-a11y/alt-text":"off"}}' > "$scratch/fail-nested-oxlint/src/nested/.oxlintrc.json"
commit_case fail-nested-oxlint 'test(fixture): try to shadow native JSX policy' "$CONFORMING_BODY"
expect fail-nested-oxlint assets FAIL 'Oxlint configuration is owned'
expect fail-nested-oxlint oxlint FAIL 'Oxlint configuration is owned'

new_case pass-native-suppression
mkdir -p "$scratch/pass-native-suppression/widgets"
printf '%s\n' '// oxlint-disable-next-line jsx-a11y/alt-text -- the fixture deliberately exercises a justified exception' \
    'export const image = <img src="/photo.png" />' > "$scratch/pass-native-suppression/widgets/Suppressed.tsx"
commit_case pass-native-suppression 'test(fixture): exercise an explained JSX exception' "$CONFORMING_BODY"
expect pass-native-suppression oxlint PASS
edit_json "$scratch/pass-native-suppression/package.json" ploaness.maxSuppressions 0
expect pass-native-suppression suppressions FAIL 'suppression ceiling is 0'

new_case fail-unused-native-suppression
printf '%s\n' '// oxlint-disable-next-line jsx-a11y/alt-text -- the fixture leaves a stale exception' \
    'export const image = <img src="/photo.png" alt="Portrait" />' > "$scratch/fail-unused-native-suppression/src/Suppressed.tsx"
commit_case fail-unused-native-suppression 'test(fixture): leave an unused JSX exception' "$CONFORMING_BODY"
expect fail-unused-native-suppression oxlint FAIL 'Unused'

new_case fail-bare-native-suppression
printf '%s\n' '// oxlint-disable-next-line' 'export const image = <img src="/photo.png" />' \
    > "$scratch/fail-bare-native-suppression/src/Suppressed.tsx"
commit_case fail-bare-native-suppression 'test(fixture): try an unexplained blanket JSX exception' "$CONFORMING_BODY"
expect fail-bare-native-suppression oxlint FAIL 'name the exact governed'

new_case fail-legacy-native-suppression
printf '%s\n' '// eslint-disable-next-line alt-text -- an unqualified alias must not bypass governance' \
    'export const image = <img src="/photo.png" />' > "$scratch/fail-legacy-native-suppression/src/Suppressed.tsx"
commit_case fail-legacy-native-suppression 'test(fixture): try an unqualified legacy JSX exception' "$CONFORMING_BODY"
expect fail-legacy-native-suppression oxlint FAIL 'use a named, explained Oxlint'

# The native unused-directive reporter also reads ESLint comments. Their real owner still runs.
new_case pass-foreign-suppression
printf '%s\n' '// eslint-disable-next-line @typescript-eslint/typedef -- infer this fixture literal to exercise ownership' \
    'export const answer = 1' > "$scratch/pass-foreign-suppression/src/Typed.tsx"
commit_case pass-foreign-suppression 'test(fixture): retain a typed ESLint exception' "$CONFORMING_BODY"
expect pass-foreign-suppression oxlint PASS
expect pass-foreign-suppression eslint PASS
replace_text "$scratch/pass-foreign-suppression/src/Typed.tsx" 'export const answer = 1' 'export const answer: number = 1'
expect pass-foreign-suppression eslint FAIL 'Unused eslint-disable directive'
replace_text "$scratch/pass-foreign-suppression/src/Typed.tsx" 'export const answer: number = 1' 'export const answer = 1'
printf '%s\n' '// oxlint-disable-next-line jsx-a11y/iframe-has-title -- deliberately leave an unused native exception' \
    'export const frame = <iframe title="External content" src="/frame" />' \
    >> "$scratch/pass-foreign-suppression/src/Typed.tsx"
expect pass-foreign-suppression oxlint FAIL 'Unused oxlint-disable'

new_case fail-oxlint-override
edit_json "$scratch/fail-oxlint-override/package.json" pnpm.overrides.oxlint '"1.80.0"'
commit_case fail-oxlint-override 'test(fixture): try to replace the native analyzer pin' "$CONFORMING_BODY"
expect fail-oxlint-override wiring FAIL 'oxlint'

# Read the packed generated Biome config through the actual pinned tool. JSX delegation must not
# disable the same accessibility check in HTML, which the native gate does not analyze.
new_case biome-a11y-ownership
printf '%s\n' 'export const frame = <iframe src="/frame" />' > "$scratch/biome-a11y-ownership/src/Frame.tsx"
printf '%s\n' '<iframe src="/frame"></iframe>' > "$scratch/biome-a11y-ownership/src/frame.html"
commit_case biome-a11y-ownership 'test(fixture): preserve HTML accessibility ownership' "$CONFORMING_BODY"
expect_command biome-a11y-ownership PASS 'Checked 1 file' \
    "$root/packages/cli/node_modules/.bin/biome" lint --error-on-warnings src/Frame.tsx
expect_command biome-a11y-ownership FAIL 'lint/a11y/useIframeTitle' \
    "$root/packages/cli/node_modules/.bin/biome" lint --error-on-warnings src/frame.html

# Nested applications delegate the same rules; a sibling library retains core Biome ownership.
new_case nested-a11y-ownership
node "$lib/make-workspace.ts" "$scratch/nested-a11y-ownership"
(cd "$scratch/nested-a11y-ownership" && ./node_modules/.bin/ploaness init >/dev/null)
mkdir -p "$scratch/nested-a11y-ownership/packages/ui/src"
printf '%s\n' 'export const frame = <iframe src="/frame" />' \
    > "$scratch/nested-a11y-ownership/apps/web/src/Frame.tsx"
printf '%s\n' '<iframe src="/frame"></iframe>' \
    > "$scratch/nested-a11y-ownership/apps/web/src/frame.html"
cp "$scratch/nested-a11y-ownership/apps/web/src/Frame.tsx" "$scratch/nested-a11y-ownership/packages/ui/src/Frame.tsx"
commit_case nested-a11y-ownership 'test(fixture): distinguish nested JSX owners' "$CONFORMING_BODY"
expect_command nested-a11y-ownership/apps/web PASS 'Checked 1 file' \
    "$root/packages/cli/node_modules/.bin/biome" lint --error-on-warnings src/Frame.tsx
expect_in nested-a11y-ownership apps/web oxlint FAIL 'jsx-a11y(iframe-has-title)'
expect_command nested-a11y-ownership/apps/web FAIL 'lint/a11y/useIframeTitle' \
    "$root/packages/cli/node_modules/.bin/biome" lint --error-on-warnings src/frame.html
expect_command nested-a11y-ownership/packages/ui FAIL 'lint/a11y/useIframeTitle' \
    "$root/packages/cli/node_modules/.bin/biome" lint --error-on-warnings src/Frame.tsx

# A package cannot spend its siblings' exceptions or receive a larger ceiling from their source.
edit_json "$scratch/nested-a11y-ownership/package.json" ploaness.maxSuppressions 0
edit_json "$scratch/nested-a11y-ownership/apps/web/package.json" ploaness.maxSuppressions 0
printf '%s\n' '// oxlint-disable-next-line jsx-a11y/iframe-has-title -- deliberate member-scoped fixture exception' \
    'export const frame = <iframe src="/frame" />' \
    > "$scratch/nested-a11y-ownership/apps/web/src/Frame.tsx"
expect nested-a11y-ownership suppressions PASS
expect_in nested-a11y-ownership apps/web suppressions FAIL 'suppression ceiling is 0'

# Core policy reaches libraries and hidden tooling while member budgets remain separate.
expect_in nested-a11y-ownership packages/ui oxlint PASS '2 native rules'
mkdir -p "$scratch/nested-a11y-ownership/packages/ui/.storybook"
printf '%s\n' '// oxlint-disable-next-line eslint/no-promise-executor-return -- deliberate library exception' \
    'export const value = new Promise(() => 1)' \
    > "$scratch/nested-a11y-ownership/packages/ui/.storybook/preview.ts"
edit_json "$scratch/nested-a11y-ownership/packages/ui/package.json" ploaness.maxSuppressions 0
expect nested-a11y-ownership suppressions PASS
expect_in nested-a11y-ownership packages/ui oxlint PASS '2 native rules'
expect_in nested-a11y-ownership packages/ui suppressions FAIL 'suppression ceiling is 0'
printf '%s\n' 'export const value = new Promise(() => 1)' \
    > "$scratch/nested-a11y-ownership/packages/ui/.storybook/preview.ts"
expect_in nested-a11y-ownership packages/ui oxlint FAIL 'eslint(no-promise-executor-return)'

# An alias cannot revive the retired plugin: the real installed inventory reports its canonical name.
new_case fail-retired-jsx-analyzer
edit_json "$scratch/fail-retired-jsx-analyzer/package.json" devDependencies.retired-jsx-checker \
    '"npm:eslint-plugin-jsx-a11y@6.10.2"'
rm "$scratch/fail-retired-jsx-analyzer/node_modules"
install_case "$scratch/fail-retired-jsx-analyzer"
commit_case fail-retired-jsx-analyzer 'test(fixture): install the retired JSX analyzer through an alias' "$CONFORMING_BODY"
expect fail-retired-jsx-analyzer blocklist FAIL 'retired JSX accessibility analyzer'

# A real Next server executes the pinned sweep. Its default scan must catch accessible-name
# defects that the static JSX rules cannot establish, and accept the corrected forms.
(cd "$template" && pnpm exec playwright install chromium >/dev/null)
new_case pass-browser-names
node "$lib/create-a11y-page.ts" "$scratch/pass-browser-names" valid
commit_case pass-browser-names 'test(fixture): render accessible controls in Next' "$CONFORMING_BODY"
expect_command pass-browser-names PASS '1 passed' \
    pnpm exec playwright test tests/e2e/a11y.e2e.spec.ts --reporter=line
new_case fail-browser-names
node "$lib/create-a11y-page.ts" "$scratch/fail-browser-names" invalid
commit_case fail-browser-names 'test(fixture): render controls without accessible names' "$CONFORMING_BODY"
expect_command fail-browser-names FAIL 'button-name' \
    pnpm exec playwright test tests/e2e/a11y.e2e.spec.ts --reporter=line
if ! grep -q '"id": "label"' "$scratch/fail-browser-names/command-output.log"; then
    echo 'FAILED fail-browser-names: the sweep did not report the unlabeled input' >&2
    failures=$((failures + 1))
fi

if [ "${1-}" = --jsx-only ]; then
    if [ "$failures" -ne 0 ]; then
        echo "$failures JSX integration contract(s) failed" >&2
        exit 1
    fi
    echo 'JSX integration contracts passed; run pnpm run verify for the complete verdict'
    exit 0
fi

# `install-scripts` is here because its only other fixture is a failure case, and this file's own
# reasoning applies symmetrically: a rule that only ever failed proves as little as one that only ever
# passed - neither tells you the gate is wired to the scaffold at all.
for gate in preflight wiring assets conventions editorconfig suppressions generated-denial \
            payload-rules payload-defaults config-refs environment install-scripts release-age blocklist arch \
            shell infra \
            require-full-history \
            commit-history linear-history; do
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

# The secret scan has two owners inside one gate: committed history and the governed working tree. The
# untouched fixture proves both halves accept a clean project before the mutations below ask each
# boundary to fail or stay out of scope.
expect pass secrets PASS

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

new_case fail-user-access-control
drop_text "$scratch/fail-user-access-control/src/lib/reads.ts" ', overrideAccess: false'
commit_case fail-user-access-control 'feat(fixture): bypass access for the supplied user' \
    "$CONFORMING_BODY"
expect fail-user-access-control payload-rules FAIL require-user-access-control

# Payload defaults overrideAccess to true, so this case removes no visible guard - it removes the
# only thing that was holding the default back, which is precisely why the rule reads the omission.
new_case fail-endpoint-access
drop_text "$scratch/fail-endpoint-access/src/endpoints/reports.ts" ', overrideAccess: false'
commit_case fail-endpoint-access 'feat(fixture): let a route inherit administrator privilege' \
    "$CONFORMING_BODY"
expect fail-endpoint-access payload-rules FAIL require-endpoint-access

new_case fail-privileged-field-create
drop_text "$scratch/fail-privileged-field-create/src/collections/Users.ts" "        create: nobodyField,
"
commit_case fail-privileged-field-create 'feat(fixture): expose account authority during creation' \
    "$CONFORMING_BODY"
expect fail-privileged-field-create payload-rules FAIL require-privileged-field-access

new_case fail-privileged-field-update
drop_text "$scratch/fail-privileged-field-update/src/collections/Users.ts" "        update: nobodyField,
"
commit_case fail-privileged-field-update 'feat(fixture): expose account authority during updates' \
    "$CONFORMING_BODY"
expect fail-privileged-field-update payload-rules FAIL require-privileged-field-access

new_case fail-open-secret-guard
{
cat <<'FIXTURE'
/**
 * Decide whether a supplied cron credential is accepted.
 * @param cronSecret - the configured credential.
 * @param supplied - the credential the caller supplied.
 * @returns whether the caller is admitted.
 */
FIXTURE
printf 'export const acceptsCron = (cronSecret%s string | undefined, supplied%s string)%s boolean => {\n' \
    ':' ':' ':'
cat <<'FIXTURE'
  if (cronSecret && supplied !== cronSecret) {
    return false
  }
  return true
}
FIXTURE
} > "$scratch/fail-open-secret-guard/src/lib/cron-auth.ts"
commit_case fail-open-secret-guard 'feat(fixture): leave a cron guard open without a secret' \
    "$CONFORMING_BODY"
expect fail-open-secret-guard payload-rules FAIL no-fail-open-secret-guard

# The mirror of the guard above, and the shape a real project shipped: the absence is tested and the
# answer to it is admission, so the endpoint is open exactly when the credential is unset. Neither rule
# can see the other's spelling - one requires a top-level `&&` in the condition, the other refuses one -
# which is why the two cases stand side by side.
new_case fail-absent-secret-acceptance
cat > "$scratch/fail-absent-secret-acceptance/src/lib/webhook-auth.ts" <<'FIXTURE'
/**
 * Decide whether a supplied webhook credential is accepted.
 * @param expectedSecret - the configured credential.
 * @param providedSecret - the credential the caller supplied.
 * @returns whether the caller is admitted.
 */
export const acceptsWebhook = (
  expectedSecret: string | undefined,
  providedSecret: string,
): boolean => {
  if (expectedSecret === undefined || expectedSecret.length === 0) {
    return true
  }
  return providedSecret === expectedSecret
}
FIXTURE
commit_case fail-absent-secret-acceptance 'feat(fixture): admit a caller when the secret is unset' \
    "$CONFORMING_BODY"
expect fail-absent-secret-acceptance payload-rules FAIL no-absent-secret-acceptance

# A schema applied by push rather than by a migration. Nothing is written down, so there is no artefact
# to review before it runs and none to roll back after - and the template's own `push: false` is what
# this case removes.
new_case fail-schema-push
replace_text "$scratch/fail-schema-push/src/payload.config.ts" 'push: false' 'push: true'
commit_case fail-schema-push 'feat(fixture): push the schema instead of recording it' \
    "$CONFORMING_BODY"
expect fail-schema-push payload-rules FAIL no-unreviewed-schema-push

# The other half of the same guarantee: an adapter that does not push needs a migration to state the
# schema, because push is skipped where NODE_ENV is production and nothing else would create it.
new_case fail-missing-migrations
rm -r "$scratch/fail-missing-migrations/src/migrations"
commit_case fail-missing-migrations 'feat(fixture): drop the recorded schema migrations' \
    "$CONFORMING_BODY"
expect fail-missing-migrations payload-rules FAIL require-recorded-migrations

# The shape a real configuration shipped: the hook itself performs no Local API call at all, it calls a
# seed that writes in its own body. A rule that read only the hook would find nothing and pass, so this
# case is what keeps the one-hop resolution honest - it fails the moment that hop is lost.
new_case fail-boot-time-writes
mkdir -p "$scratch/fail-boot-time-writes/src/seed"
cat > "$scratch/fail-boot-time-writes/src/seed/seed.ts" <<'FIXTURE'
import type { Payload } from 'payload'

/**
 * Write the published content a fresh database needs.
 * @param payload - the instance to write through.
 * @returns nothing; the globals are written in place.
 */
export const seedContent = async (payload: Payload): Promise<void> => {
  await payload.updateGlobal({ slug: 'header', data: {}, overrideAccess: false })
}
FIXTURE
replace_text "$scratch/fail-boot-time-writes/src/payload.config.ts" \
    "import { buildConfig } from 'payload'" \
    "import { buildConfig } from 'payload'
import { seedContent } from '@/seed/seed'"
replace_text "$scratch/fail-boot-time-writes/src/payload.config.ts" "  globals: [Header]," \
    "  globals: [Header],
  onInit: async (payload) => {
    await seedContent(payload)
  },"
commit_case fail-boot-time-writes 'feat(fixture): seed content on every boot' "$CONFORMING_BODY"
expect fail-boot-time-writes payload-rules FAIL no-boot-time-writes

# Docker WARNS on a --build-arg the Dockerfile never declared and builds anyway, so an image can ship
# with a build-time value silently absent while every smoke test still passes. The read is what the rule
# sees; the missing ARG is what it reports.
new_case fail-environment-build-arg
printf 'FROM node:26-alpine\nWORKDIR /app\nRUN echo build\n' \
    > "$scratch/fail-environment-build-arg/Dockerfile"
printf '\nexport const cmsUrl: string = process.env.NEXT_PUBLIC_CMS_URL ?? ""\n' \
    >> "$scratch/fail-environment-build-arg/src/lib/environment.ts"
commit_case fail-environment-build-arg 'feat(fixture): inline a variable the image never declares' \
    "$CONFORMING_BODY"
expect fail-environment-build-arg environment FAIL NEXT_PUBLIC_CMS_URL

# The same read with the declaration present, which is what stops the case above from passing for the
# wrong reason - a gate that reported any project holding a Dockerfile would satisfy it too.
new_case pass-environment-build-arg
printf 'FROM node:26-alpine\nARG NEXT_PUBLIC_CMS_URL\nWORKDIR /app\nRUN echo build\n' \
    > "$scratch/pass-environment-build-arg/Dockerfile"
printf '\nexport const cmsUrl: string = process.env.NEXT_PUBLIC_CMS_URL ?? ""\n' \
    >> "$scratch/pass-environment-build-arg/src/lib/environment.ts"
commit_case pass-environment-build-arg 'feat(fixture): declare the build argument the image inlines' \
    "$CONFORMING_BODY"
expect pass-environment-build-arg environment PASS

# An unquoted expansion, which is the defect shellcheck is best known for and the one an operational
# script is most likely to carry. Written through a QUOTED heredoc, so the expansions reach the fixture
# rather than this script - the same reason every other case here quotes its delimiter.
new_case fail-shell
mkdir -p "$scratch/fail-shell/scripts"
cat > "$scratch/fail-shell/scripts/release.sh" <<'FIXTURE'
#!/bin/sh
set -eu
target=$1
cp $target /tmp/backup
FIXTURE
commit_case fail-shell 'feat(fixture): leave an expansion unquoted in a release script' \
    "$CONFORMING_BODY"
expect fail-shell shell FAIL SC2086

# The same script with the code named. A per-code directive is the legitimate form and shellcheck offers
# no flag to refuse one, so the gate must not either - this is what proves it does not.
new_case pass-shell-directive
mkdir -p "$scratch/pass-shell-directive/scripts"
cat > "$scratch/pass-shell-directive/scripts/release.sh" <<'FIXTURE'
#!/bin/sh
set -eu
target=$1
# shellcheck disable=SC2086
cp $target /tmp/backup
FIXTURE
commit_case pass-shell-directive 'feat(fixture): suppress one shellcheck code by name' \
    "$CONFORMING_BODY"
expect pass-shell-directive shell PASS

# The in-file equivalent of an rc file. `--norc` removes the project-wide spelling; this case is what
# removes the per-file one.
new_case fail-shell-blanket
mkdir -p "$scratch/fail-shell-blanket/scripts"
cat > "$scratch/fail-shell-blanket/scripts/release.sh" <<'FIXTURE'
#!/bin/sh
# shellcheck disable=all
set -eu
target=$1
cp $target /tmp/backup
FIXTURE
commit_case fail-shell-blanket 'feat(fixture): disable shellcheck wholesale in a script' \
    "$CONFORMING_BODY"
expect fail-shell-blanket shell FAIL 'disable=all'

# No extension at all, which is how a hook is written. An extension-only rule would read nothing here,
# so this case fails the moment shebang discovery is lost.
new_case fail-shell-shebang
mkdir -p "$scratch/fail-shell-shebang/hooks"
cat > "$scratch/fail-shell-shebang/hooks/pre-commit" <<'FIXTURE'
#!/bin/sh
set -eu
target=$1
cp $target /tmp/backup
FIXTURE
commit_case fail-shell-shebang 'feat(fixture): ship a hook that quotes nothing' "$CONFORMING_BODY"
expect fail-shell-shebang shell FAIL SC2086

# The defect a real consumer shipped: both deploy roles carried AdministratorAccess, so the stage
# pipeline could drop the production database. It is asserted by check id, which is what proves the
# curated list actually reaches the container rather than the run passing on an empty selection.
new_case fail-infra-admin-policy
mkdir -p "$scratch/fail-infra-admin-policy/infra"
cat > "$scratch/fail-infra-admin-policy/infra/iam.tf" <<'FIXTURE'
resource "aws_iam_role_policy_attachment" "deploy" {
  role       = "deploy"
  policy_arn = "arn:aws:iam::aws:policy/AdministratorAccess"
}
FIXTURE
commit_case fail-infra-admin-policy 'feat(fixture): attach administrator access to a deploy role' \
    "$CONFORMING_BODY"
expect fail-infra-admin-policy infra FAIL CKV_AWS_274

# The pattern rules, one case each. checkov ships no check for either argument, which is what makes
# them this harness's business rather than the analyzer's.
new_case fail-infra-force-destroy
mkdir -p "$scratch/fail-infra-force-destroy/infra"
cat > "$scratch/fail-infra-force-destroy/infra/media.tf" <<'FIXTURE'
resource "aws_s3_bucket" "media" {
  bucket        = "eoc-media"
  force_destroy = true
}
FIXTURE
commit_case fail-infra-force-destroy 'feat(fixture): let a destroy remove a bucket that holds objects' \
    "$CONFORMING_BODY"
expect fail-infra-force-destroy infra FAIL no-force-destroy

new_case fail-infra-placeholder-secret
mkdir -p "$scratch/fail-infra-placeholder-secret/infra"
cat > "$scratch/fail-infra-placeholder-secret/infra/secrets.tf" <<'FIXTURE'
resource "aws_secretsmanager_secret_version" "preview" {
  secret_id     = "preview-auth"
  secret_string = "REPLACE-ME"
}
FIXTURE
commit_case fail-infra-placeholder-secret 'feat(fixture): guard a secret with a placeholder value' \
    "$CONFORMING_BODY"
expect fail-infra-placeholder-secret infra FAIL no-placeholder-secret

# Without this the curated checks are advisory: one comment turns the flagship check off and the run
# still passes.
new_case fail-infra-suppression
mkdir -p "$scratch/fail-infra-suppression/infra"
cat > "$scratch/fail-infra-suppression/infra/iam.tf" <<'FIXTURE'
#checkov:skip=CKV_AWS_274:temporary
resource "aws_iam_role" "deploy" {
  name = "deploy"
}
FIXTURE
commit_case fail-infra-suppression 'feat(fixture): skip an enabled check from inside the file' \
    "$CONFORMING_BODY"
expect fail-infra-suppression infra FAIL no-analyzer-suppression

# The guard the whole `0.0.0.0/0` decision rests on. The same address is correct on egress, and a
# reader that matched it anywhere would report nearly every conforming module.
new_case pass-infra-egress
mkdir -p "$scratch/pass-infra-egress/infra"
cat > "$scratch/pass-infra-egress/infra/network.tf" <<'FIXTURE'
resource "aws_security_group" "tasks" {
  name = "tasks"

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}
FIXTURE
commit_case pass-infra-egress 'feat(fixture): allow outbound traffic from the task security group' \
    "$CONFORMING_BODY"
expect pass-infra-egress infra PASS

# The gate used to pass a project on a cloud it had no check for: a `--check` id bound to nothing
# matches nothing and raises no error, so the analyzer exited 0 and the summary claimed checks that
# never ran. A provider nobody classified is refused rather than guessed at.
new_case fail-infra-unclassified-provider
mkdir -p "$scratch/fail-infra-unclassified-provider/infra"
cat > "$scratch/fail-infra-unclassified-provider/infra/compute.tf" <<'FIXTURE'
resource "alicloud_instance" "web" {
  instance_name = "web"
}
FIXTURE
commit_case fail-infra-unclassified-provider 'feat(fixture): declare a server on an unclassified cloud' \
    "$CONFORMING_BODY"
expect fail-infra-unclassified-provider infra FAIL 'not classified'

# A cloud the analyzer ships no check for passes on the pattern rules alone, and the summary says so
# rather than claiming checks that could not have run. No image is pulled for it.
new_case pass-infra-unsupported-provider
mkdir -p "$scratch/pass-infra-unsupported-provider/infra"
cat > "$scratch/pass-infra-unsupported-provider/infra/compute.tf" <<'FIXTURE'
resource "hcloud_server" "web" {
  name        = "web"
  server_type = "cx22"
  image       = "debian-12"
}
FIXTURE
commit_case pass-infra-unsupported-provider 'feat(fixture): declare a server on a cloud without checks' \
    "$CONFORMING_BODY"
expect pass-infra-unsupported-provider infra PASS 'ships no check for hcloud'

# Variables, outputs and a module reference declare nothing the analyzer can judge, and the summary
# says that too rather than counting checks over an empty set.
new_case pass-infra-declarations-only
mkdir -p "$scratch/pass-infra-declarations-only/infra"
cat > "$scratch/pass-infra-declarations-only/infra/main.tf" <<'FIXTURE'
variable "region" {
  type = string
}

module "network" {
  source = "./modules/network"
  region = var.region
}

output "region" {
  value = var.region
}
FIXTURE
commit_case pass-infra-declarations-only 'feat(fixture): declare variables and a module and no resource' \
    "$CONFORMING_BODY"
expect pass-infra-declarations-only infra PASS 'no resource'

# Every port from the whole internet, in the inline block the analyzer's check reads. The SSH and RDP
# checks read a rule referencing another security group as unrestricted and blocked the correct form,
# so this check is what remains of theirs in the analyzer; the standalone rule resource it does not
# read is the pattern rules' business.
new_case fail-infra-open-ports
mkdir -p "$scratch/fail-infra-open-ports/infra"
cat > "$scratch/fail-infra-open-ports/infra/network.tf" <<'FIXTURE'
resource "aws_security_group" "tasks" {
  name = "tasks"

  ingress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}
FIXTURE
commit_case fail-infra-open-ports 'feat(fixture): admit every port from the whole internet' \
    "$CONFORMING_BODY"
expect fail-infra-open-ports infra FAIL CKV_AWS_277

# A correct configuration in the current provider's idiom, touching the resource types whose checks
# decide on an ABSENT argument, so that an addition which fails the correct form is caught here rather
# than in a consumer. With no per-check opt-out, this fixture is the guard the whole AWS list rests on.
new_case pass-infra-aws-modern
mkdir -p "$scratch/pass-infra-aws-modern/infra"
cat > "$scratch/pass-infra-aws-modern/infra/platform.tf" <<'FIXTURE'
variable "vpc_id" {
  type = string
}

variable "github_repository" {
  type = string
}

variable "certificate_arn" {
  type = string
}

resource "aws_security_group" "bastion" {
  name   = "bastion"
  vpc_id = var.vpc_id
}

resource "aws_security_group" "alb" {
  name   = "alb"
  vpc_id = var.vpc_id
}

resource "aws_security_group" "tasks" {
  name   = "tasks"
  vpc_id = var.vpc_id
}

resource "aws_vpc_security_group_ingress_rule" "ssh_from_bastion" {
  security_group_id            = aws_security_group.tasks.id
  referenced_security_group_id = aws_security_group.bastion.id
  from_port                    = 22
  to_port                      = 22
  ip_protocol                  = "tcp"
}

resource "aws_vpc_security_group_ingress_rule" "all_tcp_from_alb" {
  security_group_id            = aws_security_group.tasks.id
  referenced_security_group_id = aws_security_group.alb.id
  from_port                    = 0
  to_port                      = 65535
  ip_protocol                  = "tcp"
}

resource "aws_vpc_security_group_egress_rule" "all" {
  security_group_id = aws_security_group.tasks.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}

resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
}

resource "aws_iam_role" "deploy" {
  name = "deploy"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRoleWithWebIdentity"
      Principal = { Federated = aws_iam_openid_connect_provider.github.arn }
      Condition = {
        StringEquals = { "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com" }
        StringLike   = { "token.actions.githubusercontent.com:sub" = "repo:${var.github_repository}:*" }
      }
    }]
  })
}

resource "aws_api_gateway_domain_name" "api" {
  domain_name              = "api.example.com"
  regional_certificate_arn = var.certificate_arn
  endpoint_configuration {
    types = ["REGIONAL"]
  }
}

resource "aws_s3_bucket" "media" {
  bucket = "site-media"
}

resource "aws_s3_bucket_public_access_block" "media" {
  bucket                  = aws_s3_bucket.media.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "media" {
  bucket = aws_s3_bucket.media.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_instance" "worker" {
  ami           = "ami-0123456789abcdef0"
  instance_type = "t3.small"
  root_block_device {
    encrypted = true
  }
  metadata_options {
    http_tokens = "required"
  }
}

resource "aws_db_instance" "postgres" {
  identifier          = "site"
  engine              = "postgres"
  instance_class      = "db.t4g.micro"
  allocated_storage   = 20
  storage_encrypted   = true
  publicly_accessible = false
  username            = "site"
  manage_master_user_password = true
}

resource "aws_elasticache_replication_group" "cache" {
  replication_group_id       = "site"
  description                = "site cache"
  node_type                  = "cache.t4g.micro"
  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
}

resource "aws_lb" "site" {
  name               = "site"
  load_balancer_type = "application"
}

resource "aws_cloudfront_distribution" "site" {
  enabled = true
  origin {
    domain_name = aws_lb.site.dns_name
    origin_id   = "alb"
    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }
  default_cache_behavior {
    target_origin_id       = "alb"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }
  }
  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }
  viewer_certificate {
    cloudfront_default_certificate = true
  }
}
FIXTURE
commit_case pass-infra-aws-modern 'feat(fixture): declare a correct platform in the current idiom' \
    "$CONFORMING_BODY"
expect pass-infra-aws-modern infra PASS 'curated check'

new_case fail-sensitive-log
cat > "$scratch/fail-sensitive-log/src/lib/credential-log.ts" <<'FIXTURE'
type Credential = Readonly<Record<'token', string>>

/** Write the supplied credential to the application log. */
export const logCredential = (credential: Credential): void => {
  console.info(credential.token)
}
FIXTURE
commit_case fail-sensitive-log 'feat(fixture): write a credential to the application log' \
    "$CONFORMING_BODY"
expect fail-sensitive-log eslint FAIL sensitive-data-logged

new_case fail-error-message-leak
cat > "$scratch/fail-error-message-leak/src/lib/error-response.ts" <<'FIXTURE'
/** Return an internal failure directly to the caller. */
export const errorResponse = (error: Error): Response => Response.json({ error: error.message })
FIXTURE
commit_case fail-error-message-leak 'feat(fixture): return an internal failure to a caller' \
    "$CONFORMING_BODY"
expect fail-error-message-leak eslint FAIL leaks-error-message

# The Core Web Vitals preset is mounted for `src/**`, and this is the only place it is read as the code
# a consumer writes: the untouched fixture carries no `.tsx` at all, so the pass case above proves
# nothing about it. A raw `<img>` is the rule's plainest case - `next/image` would size and lazy-load
# it - and the page sits under `src/app` so the link rule finds the app directory it scans.
new_case fail-raw-img
mkdir -p "$scratch/fail-raw-img/src/app/(frontend)"
cat > "$scratch/fail-raw-img/src/app/(frontend)/page.tsx" <<'FIXTURE'
import type { ReactElement } from 'react'

const Page = (): ReactElement => <img src="/logo.png" alt="The project logo" />

export default Page
FIXTURE
commit_case fail-raw-img 'feat(fixture): render a raw image element on the landing page' \
    "$CONFORMING_BODY"
expect fail-raw-img eslint FAIL no-img-element

# The credential is assembled at runtime so this verifier does not commit the very secret-shaped value
# it asks Gitleaks to find. It is written AFTER the case commit: history is clean, so only the new
# bounded working-tree scan can report it.
new_case fail-working-tree-secret
commit_case fail-working-tree-secret 'feat(fixture): prepare the working-tree secret case' \
    "$CONFORMING_BODY"
printf '%s_%s = "%s%s"\n' 'api' 'key' "$probe_part_one" "$probe_part_two" \
    > "$scratch/fail-working-tree-secret/src/untracked-credential.txt"
expect fail-working-tree-secret secrets FAIL 'governed working tree'

# The mirror is bounded by Git's own enumeration. The identical runtime value under an ignored path
# must stay outside it, or directory mode has regressed into scanning local state the repository does
# not own.
new_case pass-secret-ignored
printf 'ignored-secrets/\n' >> "$scratch/pass-secret-ignored/.gitignore"
commit_case pass-secret-ignored 'feat(fixture): ignore local secret material' "$CONFORMING_BODY"
mkdir -p "$scratch/pass-secret-ignored/ignored-secrets"
printf '%s_%s = "%s%s"\n' 'api' 'key' "$probe_part_one" "$probe_part_two" \
    > "$scratch/pass-secret-ignored/ignored-secrets/local.txt"
expect pass-secret-ignored secrets PASS

new_case fail-collection-access
drop_text "$scratch/fail-collection-access/src/collections/Posts.ts" "  access: {
    read: anyone,
    create: nobody,
    update: nobody,
    delete: nobody,
    // The fail-version-read-access case drops this line.
    readVersions: nobody,
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

# The same rule, over a file that has been WRITTEN but not staged. Every check used to enumerate the
# git index, so a new file was invisible to all twelve of them: a session could write ten source files,
# see twelve gates pass, commit, and have the commit rejected by a rule that had never been shown them.
# The probe is created after the commit precisely because `commit_case` stages everything - staging it
# would test the case that already worked.
new_case fail-typography-untracked
commit_case fail-typography-untracked 'feat(fixture): prepare the untracked scan case' "$CONFORMING_BODY"
printf '/* an em %s dash nobody staged */\n' "$(printf '\342\200\224')" \
    > "$scratch/fail-typography-untracked/src/unstaged.css"
expect fail-typography-untracked conventions FAIL 'em dash'

# The other half of the same rule: what a project IGNORES stays out, so a build output or a coverage
# report cannot arrive as new source. Without this the case above would pass for the wrong reason - a
# gate that reads every file on disk rather than every file the project owns.
new_case pass-typography-ignored
printf 'ignored-output/\n' >> "$scratch/pass-typography-ignored/.gitignore"
commit_case pass-typography-ignored 'feat(fixture): ignore a build output directory' "$CONFORMING_BODY"
mkdir -p "$scratch/pass-typography-ignored/ignored-output"
printf '/* an em %s dash in ignored output */\n' "$(printf '\342\200\224')" \
    > "$scratch/pass-typography-ignored/ignored-output/build.css"
expect pass-typography-ignored conventions PASS

# The environment gate, whose whole point is that nothing links the places a variable has to reach. The
# scaffold declares none, so the pass case above proves it passes over an empty set rather than by
# accident; these two prove it binds. A compose file interpolating a name is a promise the example file
# has to keep, and - because CI has no `.env` to interpolate from - a promise the verifying workflow has
# to keep as well.
# The interpolation is ASSEMBLED rather than written out. shellcheck reads `${NAME}` inside a single-
# quoted string as an expansion somebody expected and did not get - and the literal text is exactly what
# a compose file needs - so writing it out would cost a suppression rather than state anything.
compose_interpolating() {
    printf 'services:\n  db:\n    image: postgres:18\n    ports:\n      - "%s{%s}:5432"\n' '$' "$1"
}

new_case fail-environment-undocumented
compose_interpolating FIXTURE_DB_PORT \
    > "$scratch/fail-environment-undocumented/docker-compose.yml"
commit_case fail-environment-undocumented 'feat(fixture): interpolate an undocumented variable' "$CONFORMING_BODY"
expect fail-environment-undocumented environment FAIL FIXTURE_DB_PORT

# Documented and still missing from the job, which is the half that fails on CI alone: a developer's own
# `.env` resolves the interpolation locally, so nothing here is visible until the workflow runs.
new_case fail-environment-workflow
compose_interpolating FIXTURE_DB_PORT > "$scratch/fail-environment-workflow/docker-compose.yml"
printf 'FIXTURE_DB_PORT=5432\n' > "$scratch/fail-environment-workflow/.env.example"
commit_case fail-environment-workflow 'feat(fixture): document a variable the workflow omits' "$CONFORMING_BODY"
expect fail-environment-workflow environment FAIL 'verify.yml'

# `arch` forbids `src/**` from importing a devDependency, because a devDependency is absent from a
# production install. That rule and the guide's instruction to call `safeHref` used to contradict each
# other: the helper shipped inside `ploaness`, which every project declares as a devDependency, so the
# one module a consumer's application was told to call was the one it could not import. The pass case
# above proves the repair - `@ploaness/runtime` in `dependencies`, imported by value from src/lib/links.ts
# - and this case proves the rule it was repaired WITHOUT weakening.
new_case fail-arch-dev-dep
printf "import { safeHref } from 'ploaness/runtime'\n\nexport const viaHarness = (href: string): string => safeHref(href)\n" \
    > "$scratch/fail-arch-dev-dep/src/lib/links.ts"
commit_case fail-arch-dev-dep 'feat(fixture): import the runtime helper through the devDependency' "$CONFORMING_BODY"
expect fail-arch-dev-dep arch FAIL not-to-dev-dep

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
node "$lib/drop-install-allowlist.ts" "$scratch/fail-install-scripts/pnpm-workspace.yaml"
commit_case fail-install-scripts 'feat(fixture): drop the install-script allowlist' "$CONFORMING_BODY"
expect fail-install-scripts install-scripts FAIL 'onlyBuiltDependencies'

# A Dockerfile pulling MongoDB, whose server is SSPL. The licence gate reads manifests and never sees an
# image, so this gate is the only thing that refuses it.
new_case fail-blocklist-image
printf 'FROM mongo:7.0.14\n' > "$scratch/fail-blocklist-image/Dockerfile"
commit_case fail-blocklist-image 'feat(fixture): pull the MongoDB image in a Dockerfile' "$CONFORMING_BODY"
expect fail-blocklist-image blocklist FAIL 'mongo'

# A tag nothing pins: what `latest` pulls changes without the repository changing.
new_case fail-blocklist-mutable
printf 'FROM dpage/pgadmin4:latest\n' > "$scratch/fail-blocklist-mutable/Dockerfile"
commit_case fail-blocklist-mutable 'feat(fixture): pull an image by its latest tag' "$CONFORMING_BODY"
expect fail-blocklist-mutable blocklist FAIL 'not pinned to a tag'

# Without strict, an exact pin below pnpm's release-age floor installs anyway and pnpm writes an
# exclusion for it into the workspace file; the gate requires the refusal instead.
new_case fail-release-age-lenient
drop_text "$scratch/fail-release-age-lenient/pnpm-workspace.yaml" 'minimumReleaseAgeStrict: true'
commit_case fail-release-age-lenient 'feat(fixture): let pnpm install below the release-age floor' "$CONFORMING_BODY"
expect fail-release-age-lenient release-age FAIL 'minimumReleaseAgeStrict'

# The harness is the one permitted exclusion; anything else is the way around a held update.
new_case fail-release-age-exclusion
node "$lib/add-list-item.ts" "$scratch/fail-release-age-exclusion/pnpm-workspace.yaml" \
    minimumReleaseAgeExclude "'@types/react-dom@19.2.5'"
commit_case fail-release-age-exclusion 'feat(fixture): exclude a framework pin from the release-age floor' "$CONFORMING_BODY"
expect fail-release-age-exclusion release-age FAIL '@types/react-dom'

# Payload fills the missing operations in during sanitisation, so a partial access block is invisible
# once the app boots. The rule this replaced accepted one operation out of four.
# An upload collection that restricts nothing takes whatever a client sends, and an SVG served from
# the application's own origin is script that runs as the site.
new_case fail-unrestricted-upload
drop_text "$scratch/fail-unrestricted-upload/src/collections/Media.ts" "    mimeTypes: ['image/png', 'image/jpeg'],
"
commit_case fail-unrestricted-upload 'feat(fixture): let the upload collection take any file' "$CONFORMING_BODY"
expect fail-unrestricted-upload payload-rules FAIL require-upload-restrictions

# Payload adds script-src 'none' to an SVG response but skips its own scripted-SVG check for a file that
# opens with an XML declaration, so a collection admitting SVG must also decide the headers it is served
# with. The template admits none; this case admits it and decides nothing.
new_case fail-svg-headers
replace_text "$scratch/fail-svg-headers/src/collections/Media.ts" "'image/jpeg'" "'image/jpeg', 'image/svg+xml'"
commit_case fail-svg-headers 'feat(fixture): admit SVG uploads without deciding their headers' "$CONFORMING_BODY"
expect fail-svg-headers payload-rules FAIL require-svg-response-headers

# `auth: true` is Payload's bare enable, and it caps nothing: without a login-attempt limit and a lock
# time the collection accepts guesses as fast as a client can make them. Unlike the always-true forms,
# this one a conforming project CAN write, which is why it is the auth rule worth a fixture.
new_case fail-unhardened-auth
drop_text "$scratch/fail-unhardened-auth/src/collections/Users.ts" "    maxLoginAttempts: 5,
"
commit_case fail-unhardened-auth 'feat(fixture): drop the login-attempt cap' "$CONFORMING_BODY"
expect fail-unhardened-auth payload-rules FAIL require-auth-hardening

# The cap above, undone from inside. `unlock` is one of the operations Payload fills the access block
# with, so a collection can cap attempts, lock the account, decide all four ordinary operations, and
# still let any signed-in user clear the lockout - which is advisory GHSA-jg8r-5jh2-v2xj.
new_case fail-unlock-access
drop_text "$scratch/fail-unlock-access/src/collections/Users.ts" "    unlock: nobody,
"
commit_case fail-unlock-access 'feat(fixture): leave the account unlock to the defaults' "$CONFORMING_BODY"
expect fail-unlock-access payload-rules FAIL require-unlock-access

# A version carries the whole document, and `readVersions` is the one access operation Payload never
# fills in, so an undeclared rule falls through to every signed-in user and a scoped read is bypassed by
# asking for a version instead of the document.
new_case fail-version-read-access
drop_text "$scratch/fail-version-read-access/src/collections/Posts.ts" "    readVersions: nobody,
"
commit_case fail-version-read-access 'feat(fixture): leave the version read to the defaults' "$CONFORMING_BODY"
expect fail-version-read-access payload-rules FAIL require-version-read-access

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

# Payload builds the folder collection itself, with an access block no source file carries, so the
# static rule cannot see it and the anonymous sweep cannot either: its default admits every signed-in
# user to every operation. The template decides it through an override; this leaves it to the default.
new_case fail-folders-default-access
replace_text "$scratch/fail-folders-default-access/src/payload.config.ts" \
    "folders: { collectionOverrides: [foldersAccess] }," "folders: {},"
commit_case fail-folders-default-access 'feat(fixture): leave the folder tree to the default access' \
    "$CONFORMING_BODY"
expect fail-folders-default-access payload-defaults FAIL payload-folders

# The code that DECIDES a framework-built collection's access is an override function, and the
# configuration literal it is given is a call ARGUMENT, not the annotated binding. The reader used to
# anchor on the type name and then take the next brace anywhere after it, so it adopted that argument as
# though it were the collection and reported it for declaring no access - the very code written to close
# the hole was the finding, and there was nothing the project could write instead.
new_case pass-override-call-argument
replace_text "$scratch/pass-override-call-argument/src/lib/folders.ts" \
    "  access: { create: nobody, read: nobody, readVersions: nobody, update: nobody, delete: nobody },
})" \
    "  access: { create: nobody, read: nobody, readVersions: nobody, update: nobody, delete: nobody },
})

/** The folder collection this configuration builds, decided by the override above. */
export const folders: CollectionConfig = foldersAccess({
  collection: { slug: 'payload-folders', fields: [] },
})"
commit_case pass-override-call-argument \
    'feat(fixture): build the folder collection through its override' "$CONFORMING_BODY"
expect pass-override-call-argument payload-rules PASS

# The job queue is the other collection the framework builds, and it declares no access at all.
new_case fail-jobs-default-access
replace_text "$scratch/fail-jobs-default-access/src/payload.config.ts" "  globals: [Header]," \
    "  globals: [Header],
  jobs: { tasks: [{ slug: 'noop', handler: async () => ({ output: {} }) }] },"
commit_case fail-jobs-default-access 'feat(fixture): queue a task and leave the queue to the default' \
    "$CONFORMING_BODY"
expect fail-jobs-default-access payload-defaults FAIL payload-jobs

# The defect the source rules and the anonymous sweep both passed: a drafts collection whose read
# filters on something other than the status. Payload leaves the main row alone on an unpublished save,
# so the ordinary list serves work nobody approved - no ?draft=true required.
new_case fail-drafts-unconstrained-read
replace_text "$scratch/fail-drafts-unconstrained-read/src/access/index.ts" \
    "export const publishedOnly: Access = () => ({ _status: { equals: 'published' } })" \
    "export const publishedOnly: Access = () => ({ title: { not_equals: '' } })"
commit_case fail-drafts-unconstrained-read \
    'feat(fixture): filter the drafts read without the status' "$CONFORMING_BODY"
expect fail-drafts-unconstrained-read payload-defaults FAIL articles

# The same collection with a read that admits anyone. The static rule cannot see this one either: it
# matches the inline always-true spelling, and the shipped ESLint config forbids that spelling in a
# config file, so a conforming project names a helper instead.
new_case fail-drafts-open-read
replace_text "$scratch/fail-drafts-open-read/src/collections/Articles.ts" \
    "    read: publishedOnly," "    read: anyone,"
replace_text "$scratch/fail-drafts-open-read/src/collections/Articles.ts" \
    "import { nobody, publishedOnly } from '@/access'" "import { anyone, nobody } from '@/access'"
commit_case fail-drafts-open-read \
    'feat(fixture): open the drafts read to every caller' "$CONFORMING_BODY"
expect fail-drafts-open-read payload-defaults FAIL articles

# A required relationship gives one table a NOT NULL column against a foreign key Payload declares
# ON DELETE SET NULL. The two contradict, so deleting the row being pointed AT aborts on a constraint
# belonging to a table the caller never mentioned - unless that collection takes its dependants down
# first. The template declares the hook; this removes it.
new_case fail-relationship-cleanup
drop_text "$scratch/fail-relationship-cleanup/src/collections/Users.ts" "    beforeDelete: [removeAuthoredPosts],
"
commit_case fail-relationship-cleanup 'feat(fixture): stop taking dependants down with an account' \
    "$CONFORMING_BODY"
expect fail-relationship-cleanup payload-rules FAIL require-relationship-cleanup

# `format` applies Biome, then ESLint's fixers. A fixer emits what its rule considers correct rather
# than what the formatter would have printed, so for as long as nothing ran after ESLint the command
# could leave a tree the `biome` gate rejects - on a change format itself had made. ONE run has to
# settle it; running format twice always did.
new_case format-converges
cat > "$scratch/format-converges/src/lib/trim.ts" <<'FIXTURE'
/**
 * Drop the last value. Written the way a person writes it, which `unicorn/prefer-negative-index`
 * rewrites and only Biome then formats.
 * @param values - the values to trim.
 * @returns every value but the last.
 */
export const dropLast = (values: readonly number[]): readonly number[] =>
  values.slice(0, values.length - 1)
FIXTURE
cat > "$scratch/format-converges/src/lib/promise.ts" <<'FIXTURE'
/**
 * Resolve a value without returning the ignored result of a Promise executor.
 * @param value - the number to resolve.
 * @returns the resolved number.
 */
export const resolved = (value: number): Promise<number> =>
  new Promise<number>((resolve): void => {
    resolve(value)
  })
FIXTURE
commit_case format-converges 'feat(fixture): add a value a fixer rewrites' "$CONFORMING_BODY"
(cd "$scratch/format-converges" && ./node_modules/.bin/ploaness format >/dev/null 2>&1)
expect format-converges biome PASS
expect format-converges oxlint PASS

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
node "$lib/delete-dependency.ts" "$scratch/pass-ecosystem-absent/package.json" pg
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
node "$lib/delete-dependency.ts" "$scratch/fail-missing-pin/package.json" '@types/node'
commit_case fail-missing-pin 'feat(fixture): drop a package ploaness pins' "$CONFORMING_BODY"
expect fail-missing-pin wiring FAIL 'missing'

# `@ploaness/runtime` is required rather than merely pinned, because the guide's Layer 6 rule tells an
# application to call `safeHref` and no gate can verify that it did. A rule that names an import the
# project cannot resolve is the contradiction this package exists to end, so the declaration is not
# left to the session that first needs it.
new_case fail-missing-runtime
node "$lib/delete-dependency.ts" "$scratch/fail-missing-runtime/package.json" '@ploaness/runtime'
commit_case fail-missing-runtime 'feat(fixture): drop the ploaness runtime package' "$CONFORMING_BODY"
expect fail-missing-runtime wiring FAIL '@ploaness/runtime'

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

# The accessibility route ceiling, read the way the managed sweep reads it: through the `ploaness/a11y`
# subpath, from a project's own package.json. This suite runs no browser, so what it proves is the chain
# rather than the crawl - the clamp in `readSettings`, the constant `@ploaness/config/a11y` derives, and
# the export map that carries it to the name the spec imports. A ceiling a project could RAISE would be
# no ceiling: reaching it fails the sweep, so the pressure on a team is always upward, and the answer to
# "too many pages to check" must be the harness measuring rather than the project declaring.
new_case pass-route-budget-lowered
edit_json "$scratch/pass-route-budget-lowered/package.json" ploaness.accessibilityRouteBudget 10
commit_case pass-route-budget-lowered 'feat(fixture): hold the sweep to a shorter crawl' \
    "$CONFORMING_BODY"
expect_command pass-route-budget-lowered PASS 'accessibilityRouteBudget=10' \
    node "$lib/print-a11y-budget.ts"

new_case pass-route-budget-raised
edit_json "$scratch/pass-route-budget-raised/package.json" ploaness.accessibilityRouteBudget 100000
commit_case pass-route-budget-raised 'feat(fixture): declare a longer crawl than the harness allows' \
    "$CONFORMING_BODY"
# Compared against what the UNTOUCHED fixture reports rather than against a copy of the number. A shell
# literal here would be a second statement of a default `settings.ts` already makes, and it would go
# quietly wrong the day the harness raises the ceiling after measuring - which is the one change this
# assertion most needs to survive.
shipped_budget="$(cd "$scratch/pass" && node "$lib/print-a11y-budget.ts")"
expect_command pass-route-budget-raised PASS "$shipped_budget" \
    node "$lib/print-a11y-budget.ts"

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
mkdir -p "$scratch/pass-guard-allows-loopback/tests/int"
cat > "$scratch/pass-guard-allows-loopback/tests/int/network-guard.int.spec.ts" <<'LOOPBACK'
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
mkdir -p "$scratch/fail-guard-blocks-remote/tests/int"
cat > "$scratch/fail-guard-blocks-remote/tests/int/network-guard.int.spec.ts" <<'REMOTE'
import { expect, it } from 'vitest'

it('reaches a host beyond this machine', async () => {
  const response: Response = await fetch('https://ploaness.invalid/')
  expect(response.ok).toBe(true)
})
REMOTE
expect_suite fail-guard-blocks-remote FAIL 'no network beyond the machine'


# ── Workspace cases ─────────────────────────────────────────────────────────────────────────────────
#
# `it/project` proves the single-package path and is untouched by all of this: every assertion above ran
# against the shape that shipped before members existed. These prove the other path, and two of them
# fail on the code that preceded the scopes - which is why they are written as fixtures rather than left
# to unit tests.
new_workspace() {
    name="$1"
    new_case "$name"
    node "$here/lib/make-workspace.ts" "$scratch/$name"
    # `init` runs AFTER the reshaping, so the pass case doubles as the regression test that the
    # scaffolder writes each member the configuration its own kind is judged against.
    (cd "$scratch/$name" && ./node_modules/.bin/ploaness init >/dev/null)
    # Member discovery reads the tracked tree, so a workspace case needs a history before any rule about
    # which packages exist can answer.
    commit_case "$name" 'feat(fixture): a governed workspace' \
        'A repository holding an application and a library, both declaring the harness.'
}

new_workspace pass-workspace
expect pass-workspace preflight PASS
expect pass-workspace install-scripts PASS
expect pass-workspace release-age PASS
expect_in pass-workspace apps/web release-age PASS
expect pass-workspace conventions PASS
# Both halves of one joint. `apps/web` declares a framework-glue exemption covering its route layer, so
# its own run passes; the root declares none, and the shipped configurations read their settings from the
# working directory - so a root that walked into the member would judge that route by the ROOT's
# settings and report three findings the member's own gate does not. ESLint is told `.`, which is
# everything below the directory it runs in, and a project's config file is required to be a bare
# re-export, so the boundary is the only place that divergence can be stopped. Asserted against a real
# tree rather than as a unit test because what is being checked is which files the tool read.
expect_in pass-workspace apps/web eslint PASS
expect pass-workspace eslint PASS

# The three gates that need a server. A library declares neither Payload nor Next, so it has no build,
# no client bundle and no browser - and `assets` already withholds the managed specs from it on exactly
# that test. Each of these failed before the guard: `next` resolves from any member of a workspace where
# one member is an application, because pnpm keeps a compatibility hoist node's resolution walks into,
# so the question "is the tool reachable" answered yes everywhere. `e2e` was the worse half, failing a
# library for the absence of a `playwright.config.ts` the catalogue is right not to give it.
expect_in pass-workspace packages/ui build PASS 'no runtime of its own'
expect_in pass-workspace packages/ui bundle PASS 'no runtime of its own'
expect_in pass-workspace packages/ui e2e PASS 'no runtime of its own'

# pnpm honours the install allowlist only at the workspace root, so a member cannot carry one - and
# before the scopes this reported a PASS from inside a member, having read no file at all.
new_workspace fail-member-install-allowlist
node "$here/lib/drop-install-allowlist.ts" "$scratch/fail-member-install-allowlist/pnpm-workspace.yaml"
expect_in fail-member-install-allowlist apps/web install-scripts FAIL 'onlyBuiltDependencies'

# An override at the root replaces a version a MEMBER declared. Read from the member's own directory
# there was no workspace file to find, so the gate vouched for a pin that never took effect.
new_workspace fail-member-override
node "$here/lib/add-override.ts" \
    "$scratch/fail-member-override/pnpm-workspace.yaml" vitest 3.0.0
expect_in fail-member-override apps/web wiring FAIL 'redefines a version ploaness pins'

# A library is not an application. Pointing it at the framework configuration would have it judged
# against files it does not have.
new_workspace fail-library-framework-config
printf "import ploaness from 'ploaness/eslint'\n\nexport default ploaness\n" \
    > "$scratch/fail-library-framework-config/packages/ui/eslint.config.mjs"
expect fail-library-framework-config wiring FAIL 'ploaness/eslint-library'

# Dropping the harness declaration removes a package from the governed set, which without this rule
# would be a silent way to take a whole application out of verification.
new_workspace fail-ungoverned-project
node "$here/lib/delete-dependency.ts" "$scratch/fail-ungoverned-project/packages/ui/package.json" ploaness
expect fail-ungoverned-project wiring FAIL 'ploaness does not govern'


# Policy boundaries must hold through the installed package, including source that has not been staged.
new_case pass-explicit-options
commit_case pass-explicit-options 'test(fixture): establish policy boundary case' "$CONFORMING_BODY"
mkdir -p "$scratch/pass-explicit-options/src/endpoints"
cat > "$scratch/pass-explicit-options/src/endpoints/posts.ts" <<'EOF'
import type { PayloadRequest } from 'payload'
export const posts = async (req: PayloadRequest, options: object) =>
  req.payload.find({ ...options, collection: 'users', depth: 0, req, overrideAccess: false })
EOF
expect pass-explicit-options payload-rules PASS

new_case fail-opaque-options
commit_case fail-opaque-options 'test(fixture): establish policy boundary case' "$CONFORMING_BODY"
cat > "$scratch/fail-opaque-options/src/lib/posts.ts" <<'EOF'
import type { Payload } from 'payload'
export const posts = async (payload: Payload, options: Parameters<Payload['find']>[0]) =>
  payload.find(options)
EOF
expect fail-opaque-options payload-rules FAIL 'require-explicit-payload-options'

new_case fail-next-endpoint-access
commit_case fail-next-endpoint-access 'test(fixture): establish policy boundary case' "$CONFORMING_BODY"
mkdir -p "$scratch/fail-next-endpoint-access/src/app/api/posts"
cat > "$scratch/fail-next-endpoint-access/src/app/api/posts/route.ts" <<'EOF'
import type { Payload } from 'payload'
export const posts = async (payload: Payload) => payload.find({ collection: 'users', depth: 0 })
EOF
expect fail-next-endpoint-access payload-rules FAIL 'require-endpoint-access'

new_case fail-overwritten-options
commit_case fail-overwritten-options 'test(fixture): establish policy boundary case' "$CONFORMING_BODY"
cat > "$scratch/fail-overwritten-options/src/lib/posts.ts" <<'EOF'
import type { PayloadRequest } from 'payload'
export const posts = async (req: PayloadRequest, options: object) =>
  req.payload.find({ collection: 'users', depth: 0, req, overrideAccess: false, ...options })
EOF
expect fail-overwritten-options payload-rules FAIL 'no-unthreaded-req'

new_case fail-missing-snapshot
commit_case fail-missing-snapshot 'test(fixture): establish policy boundary case' "$CONFORMING_BODY"
expect fail-missing-snapshot tree-verify FAIL 'no tree snapshot'

new_workspace scoped-member-exclusion
node "$lib/edit-json.ts" "$scratch/scoped-member-exclusion/apps/web/package.json" \
    ploaness.javascriptAllowlist '[{"pattern":"generated-code\\.js$","reason":"generated fixture"}]'
printf 'export const generated = 1\n' > "$scratch/scoped-member-exclusion/apps/web/generated-code.js"
expect scoped-member-exclusion conventions PASS
printf 'export const authored = 1\n' > "$scratch/scoped-member-exclusion/packages/ui/generated-code.js"
expect scoped-member-exclusion conventions FAIL 'packages/ui/generated-code.js'


# A root member has no ancestor settings to inherit. Its declaration must be rendered once.
new_case pass-single-root-declaration
commit_case pass-single-root-declaration 'test(fixture): establish root setting ownership' "$CONFORMING_BODY"
node "$lib/edit-json.ts" "$scratch/pass-single-root-declaration/package.json" \
    ploaness.generatedArtefacts '[{"pattern":"src/generated/**","reason":"generated schema"}]'
mkdir -p "$scratch/pass-single-root-declaration/src/generated"
printf 'export interface Schema { readonly id: string }\n' \
    > "$scratch/pass-single-root-declaration/src/generated/schema.ts"
rm "$scratch/pass-single-root-declaration/biome.json"
expect_command pass-single-root-declaration PASS 'biome.json: written' \
    "$scratch/pass-single-root-declaration/node_modules/.bin/ploaness" init
root_declarations="$(grep -Fc '!src/generated' "$scratch/pass-single-root-declaration/biome.json")"
if [ "$root_declarations" -ne 1 ]; then
    echo "FAILED root settings: one declaration produced $root_declarations generated exclusions" >&2
    failures=$((failures + 1))
fi
expect pass-single-root-declaration wiring PASS
generated_before="$(git hash-object "$scratch/pass-single-root-declaration/src/generated/schema.ts")"
expect_command pass-single-root-declaration PASS 'Formatting applied' \
    "$scratch/pass-single-root-declaration/node_modules/.bin/ploaness" format
if [ "$generated_before" != "$(git hash-object "$scratch/pass-single-root-declaration/src/generated/schema.ts")" ]; then
    echo 'FAILED generated role: formatting rewrote generator-owned source' >&2
    failures=$((failures + 1))
fi
expect pass-single-root-declaration wiring PASS


echo
if [ "$failures" -eq 0 ]; then
    echo 'ploaness integration suite passed.'
else
    echo "ploaness integration suite failed: $failures assertion(s)." >&2
fi
exit "$failures"
