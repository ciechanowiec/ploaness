#!/bin/sh
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

for package in governance config assets cli ploaness; do
  (cd "$root/packages/$package" && pnpm pack --pack-destination "$out" >/dev/null)
done

echo "packed into $out:"
ls -1 "$out"
