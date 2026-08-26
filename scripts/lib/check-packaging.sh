#!/usr/bin/env sh
# Reads the packed tarballs the way a consumer's package manager will.
#
# Every other check in this repository reads the working tree. An `exports` map is not read by any of
# them: it is data no compiler resolves and no linter parses, so a subpath that names a file the tarball
# does not carry, or one whose declarations no resolution mode can reach, is invisible from this side
# and lands as a broken install on the other. `@ploaness/assets` shipped a `./files/` subpath for
# exactly that long - a trailing-slash target, which node REMOVED rather than deprecated.
#
# publint reads the tarball's structure. attw resolves every entry point under each module-resolution
# mode and reports the ones that reach JavaScript but no types.
#
# `--profile esm-only` states a role rather than silencing findings one by one. Every package here
# declares `"type": "module"` and `engines.node >= 26`, so the two resolutions the profile drops -
# `node10`, which predates `exports` entirely, and `node16-cjs`, which asks what `require()` would find -
# describe consumers these packages do not have. Nothing else is ignored.
set -eu

root=$(cd "$(dirname "$0")/../.." && pwd)
tarballs="$root/dist-tarballs"
attw="$root/node_modules/.bin/attw"
publint="$root/node_modules/.bin/publint"

if [ ! -d "$tarballs" ]; then
    echo "no $tarballs; run pnpm run pack:local first" >&2
    exit 1
fi

# Globbed rather than listed. `pack-local.sh` enumerates the packages the same way, and for the reason
# recorded there: a hard-coded list once left a package built and never packed, which no check saw.
failures=0
checked=0
for tarball in "$tarballs"/*.tgz; do
    if [ ! -f "$tarball" ]; then
        echo "no tarballs in $tarballs; run pnpm run pack:local first" >&2
        exit 1
    fi
    name=$(basename "$tarball")
    checked=$((checked + 1))

    if ! "$publint" "$tarball"; then
        echo "!!! publint failed for $name"
        failures=$((failures + 1))
    fi

    if ! "$attw" "$tarball" --profile esm-only --format ascii --no-emoji --no-color; then
        echo "!!! attw failed for $name"
        failures=$((failures + 1))
    fi
done

if [ "$failures" -ne 0 ]; then
    echo "packaging: $failures check(s) failed across $checked tarball(s)"
    exit 1
fi

echo "packaging: $checked tarball(s) resolve as a consumer will"
