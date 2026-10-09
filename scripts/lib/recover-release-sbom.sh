#!/usr/bin/env sh
# Recover the original inventory and compare it with the bytes already published to npm.
set -eu

release_version="${RELEASE_VERSION:?}"
release_commit="${RELEASE_COMMIT:?}"
repository="${GITHUB_REPOSITORY:?}"
archive_directory='dist-tarballs'
report_directory='dist/sbom'
mkdir -p "$archive_directory" "$report_directory"

if ! gh release download "v$release_version" --pattern 'bom.cdx.json' --pattern 'release.json' \
    --dir "$report_directory" --clobber; then
    artifact_name="sbom-$release_version-$release_commit"
    artifact_id="$(gh api --paginate "repos/$repository/actions/artifacts?name=$artifact_name" \
        --jq '.artifacts[] | select(.expired == false) | .id' | head -n 1)"
    if [ -z "$artifact_id" ]; then
        echo 'The original release SBOM is unavailable. Restore its retained artifact before recovering this release.' >&2
        exit 1
    fi
    archive="${RUNNER_TEMP:?}/ploaness-release-sbom.zip"
    gh api "repos/$repository/actions/artifacts/$artifact_id/zip" > "$archive"
    unzip -o "$archive" -d "$report_directory"
fi

rm -f "$archive_directory"/*.tgz
for package in ${PUBLISH_ORDER:?}; do
    case "$package" in
        ploaness) name='ploaness' ;;
        ploaness-*) name="@ploaness/${package#ploaness-}" ;;
        *) echo "Unrecognized release package: $package" >&2; exit 1 ;;
    esac
    archive_url="$(npm view "$name@$release_version" dist.tarball)"
    curl --fail --location --silent --show-error --max-time 60 "$archive_url" \
        --output "$archive_directory/$package-$release_version.tgz"
done
node scripts/lib/check-release-sbom.ts "$release_commit" "$report_directory" "$archive_directory"
