#!/usr/bin/env sh
# Formats-checks the TypeScript asset bodies under the paths they will occupy in a consumer.
#
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
#
# It is a script rather than a function inside `verify.sh` because a function invoked through `"$@"` is
# a function no analyzer can see called, and a check this repository implements itself is its source
# code: it is held to the same rules as the rest, which means it is read by something.
set -eu

root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"

# Removed however the script leaves. Without this, `set -e` aborting on the staging below left a
# directory behind on every failure - and a check that litters on failure is one people stop running.
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT INT TERM

node "$root/scripts/lib/strip-root-flag.ts" \
    "$root/packages/ploaness/biome.json" "$stage/biome.json"

# Named one by one rather than as the whole directory: the config sits there too, and Biome would
# otherwise judge a file this repository generates and does not format. They are collected as positional
# parameters rather than into one string, so a path is a path rather than a word the shell splits.
#
# The comment above described what the code did not do: the list came from an unquoted `$(find ...)`,
# which word-splits on IFS before anything reaches `set --`, and the pipeline it fed hid a `find`
# failure behind `sort`'s exit status. Read line by line from a file instead, so a path is one line and
# a `find` that fails stops the script under `set -e`.
bodies="$stage/.bodies"
find packages/assets/files -name '*.ts.asset' -print > "$bodies"
sort -o "$bodies" "$bodies"

set --
while IFS= read -r body; do
    relative="${body#packages/assets/files/}"
    relative="${relative%.asset}"
    mkdir -p "$stage/$(dirname "$relative")"
    cp "$body" "$stage/$relative"
    set -- "$@" "$relative"
done < "$bodies"

# Biome checks the whole directory when it is given no path, and the directory holds the generated
# config this repository does not format. A staging that found nothing is a defect in this script, not
# a clean run.
if [ "$#" -eq 0 ]; then
    printf 'no TypeScript asset body was staged; the check would have judged the wrong files\n' >&2
    exit 1
fi

status=0
(cd "$stage" && "$root/node_modules/.bin/biome" check "$@") || status=1
exit "$status"
