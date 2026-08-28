#!/usr/bin/env sh
# Pack every ploaness package into dist-tarballs/, so a consumer can install the harness before it is
# published. Five unpublished packages cannot be installed by name; the consumer points a pnpm override
# at each tarball instead. That block is removed once the packages are on npm, and it is the only thing
# that differs between this verification and a real install.
set -eu

root=$(cd "$(dirname "$0")/.." && pwd)
out="$root/dist-tarballs"

mkdir -p "$out"
rm -f "$out"/*.tgz

pnpm -r --filter './packages/**' run build

# Discovered from the workspace rather than named. The list was a second copy of what `packages/`
# already contains, and `pnpm -r` above builds whatever is there - so a sixth package would have been
# built here and then never packed, with nothing to say so.
# The LICENSE and the README are generated rather than committed five times. npm packs both beside a
# package.json whether or not `files` names them, and recognises a README by extension alone - so the
# AsciiDoc guide this repository maintains cannot be one, and a package without a match publishes a page
# reading "ERROR: No README data found!". Every word on the generated pages already exists in a
# package.json field npm reads anyway, which is what stops five documents from drifting from five
# packages. Generated and gitignored, exactly as the configs `packages/ploaness/build.ts` writes are.
node "$root/scripts/lib/write-publication-files.ts"

for manifest in "$root"/packages/*/package.json; do
  (cd "$(dirname "$manifest")" && pnpm pack --pack-destination "$out" >/dev/null)
done

echo "packed into $out:"
ls -1 "$out"
