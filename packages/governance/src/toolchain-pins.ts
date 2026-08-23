// The container images the gates run their analyzers in.
//
// Pinned by digest rather than by tag. A tag - `latest` most obviously, but a version tag too - is a
// mutable reference: the registry can repoint it at new bytes, and the same repository would then reach
// a different verdict on a different day. A digest names the bytes, so it is the only form that makes
// "an upstream release cannot change a verdict while the repository does not change" literally true.
//
// To move a pin, read the new digest with `docker buildx imagetools inspect <repo>:<tag>` and record
// the human-readable version beside it. Never write a bare tag here: the spec rejects one.

/** An analyzer ploaness runs in a container rather than installing from the registry. */
export type ContainerTool = 'gitleaks' | 'hadolint' | 'actionlint'

/** The exact image each containerised analyzer runs, by digest. */
export const CONTAINER_IMAGES: Readonly<Record<ContainerTool, string>> = {
  // gitleaks 8.30.1
  gitleaks:
    'zricethezav/gitleaks@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f',
  // hadolint 2.14.0
  hadolint:
    'hadolint/hadolint@sha256:32dac94127fd60b7b7e3fbfc65e1383b9b5e25c9bfd7b8536de7a539fe68a12d',
  // actionlint 1.7.7
  actionlint:
    'rhysd/actionlint@sha256:b1934ee5f1c509618f2508e6eb47ee0d3520686341fec936f3b79331f9315667',
}

/** Matches a reference that names image bytes, and only such a reference. */
export const DIGEST_PINNED: RegExp = /^[a-z0-9][a-z0-9._/-]*@sha256:[0-9a-f]{64}$/

/**
 * Report every containerised analyzer whose image is not pinned to an exact digest.
 * @param images the image reference declared for each tool.
 * @returns one message per unpinned tool; empty means every verdict is reproducible.
 */
export const findUnpinnedImages = (images: Readonly<Record<string, string>>): readonly string[] =>
  Object.entries(images)
    .filter(([, reference]: readonly [string, string]): boolean => !DIGEST_PINNED.test(reference))
    .map(
      ([tool, reference]: readonly [string, string]): string =>
        `${tool} runs "${reference}", which is a mutable reference; pin it as <repo>@sha256:<digest>`,
    )
