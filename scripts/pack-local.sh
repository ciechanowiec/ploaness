#!/usr/bin/env sh
# Pack every ploaness package into dist-tarballs/, so `it/` installs the harness the way a consumer
# does. The fixture points a pnpm override at each tarball rather than naming them, and that is
# permanent rather than a stand-in for publication: what is verified is the artefacts THIS run
# produced, and a registry range resolves to whatever is already published - the previous release,
# never the change under test. The override costs exactly one link of the chain, the specifier: a
# `file:` URL instead of a range. What it resolves to - the packed bytes, the `exports` map, the
# bin shim, the transitive install - is what a consumer receives.
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
