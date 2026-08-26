// The container images the gates run their analyzers in.
//
// Pinned by digest rather than by tag. A tag - `latest` most obviously, but a version tag too - is a
// mutable reference: the registry can repoint it at new bytes, and the same repository would then reach
// a different verdict on a different day. A digest names the bytes, so it is the only form that makes
// "an upstream release cannot change a verdict while the repository does not change" literally true.
//
// The tag is written too, and it is not decoration. A digest alone says nothing about which release it
// is, so the version used to live in a comment beside it - unreadable to anything but a person, which
// is why nothing reported when a newer image existed. `<repo>:<tag>@sha256:<digest>` states both: docker
// resolves the digest and ignores the tag, and the freshness check reads the tag to ask the registry
// what is newer. A bare tag is still rejected; the spec requires both halves.
//
// To move a pin, read the new digest with `docker buildx imagetools inspect <repo>:<tag>`.
//
// Two of the four tags below are not the versions their comments used to claim. The hadolint pin was
// commented `2.14.0` and is the bytes of `v2.15.1`; the actionlint pin was commented `1.7.7` and is
// `1.7.12`. Nothing could have caught that while the version was prose, which is the whole argument for
// writing it where a check can read it.

/** An analyzer ploaness runs in a container rather than installing from the registry. */
export type ContainerTool = 'gitleaks' | 'hadolint' | 'actionlint' | 'shellcheck'

/** The exact image each containerised analyzer runs, by digest. */
export const CONTAINER_IMAGES: Readonly<Record<ContainerTool, string>> = {
  gitleaks:
    'zricethezav/gitleaks:v8.30.1@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f',
  hadolint:
    'hadolint/hadolint:v2.15.1@sha256:32dac94127fd60b7b7e3fbfc65e1383b9b5e25c9bfd7b8536de7a539fe68a12d',
  actionlint:
    'rhysd/actionlint:1.7.12@sha256:b1934ee5f1c509618f2508e6eb47ee0d3520686341fec936f3b79331f9315667',
  // The standard makes a check a repository implements itself into its source code, and the ploaness
  // verification command is a shell script that no analyzer read.
  shellcheck:
    'koalaman/shellcheck:v0.11.0@sha256:61862eba1fcf09a484ebcc6feea46f1782532571a34ed51fedf90dd25f925a8d',
}

/** Matches a reference that names image bytes AND the release they are, and only such a reference. */
export const DIGEST_PINNED: RegExp =
  /^[a-z0-9][a-z0-9._/-]*:[A-Za-z0-9][\w.-]*@sha256:[0-9a-f]{64}$/

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
        `${tool} runs "${reference}", which does not name both the release and its bytes; ` +
        'pin it as <repo>:<tag>@sha256:<digest>',
    )

// The major version an `engines.node` range admits at its lowest. The CLI carried its own
// `MINIMUM_NODE_MAJOR = 26` and decided the verdict with it, which put a rule in the I/O layer and made
// a fourth copy of a number `pins.json` already states - and the copy that decided was the loose one.
const LEADING_MAJOR: RegExp = /(\d+)/

/**
 * The lowest Node major an engines range admits.
 * @param enginesNode the declared range, such as `>=26`.
 * @returns the major version, or undefined when the range names none.
 */
export const minimumNodeMajor = (enginesNode: string | undefined): number | undefined => {
  const found: RegExpExecArray | null = LEADING_MAJOR.exec(enginesNode ?? '')
  return found === null ? undefined : Number(found[1])
}

// Corepack permits an integrity suffix - `pnpm@11.9.0+sha512.<hash>` - and that specifier names the
// same version as the bare one. Reading up to the `+` keeps a project that pasted Corepack's own
// output from failing a rule about a number it got right.
const PNPM_SPECIFIER: RegExp = /^pnpm@([^+\s]+)(?:\+\S+)?$/

/**
 * The exact pnpm version a `packageManager` specifier names.
 *
 * The version has one source - the `packageManager` pin - and everything else that states it is
 * derived from here. `engines.pnpm` was pinned separately at `>=11` while `packageManager` said
 * `pnpm@11.9.0`, which is the range ban applied to every dependency except the tool that resolves
 * them: it told a reader that any pnpm 11 would build the same tree.
 * @param packageManager the declared specifier, such as `pnpm@11.9.0`.
 * @returns the version, or undefined when the specifier names another manager or no version.
 */
export const pinnedPnpmVersion = (packageManager: string | undefined): string | undefined => {
  const found: RegExpExecArray | null = PNPM_SPECIFIER.exec(packageManager ?? '')
  return found?.[1]
}

// pnpm identifies itself to every script it runs: `pnpm/11.9.0 npm/? node/v26.2.0 darwin arm64`. The
// prefix is anchored at a word boundary because `@pnpm/exe/11.9.0` would otherwise match as `pnpm`.
const PNPM_USER_AGENT: RegExp = /(?:^|\s)pnpm\/(\S+)/

/**
 * Report the pnpm actually running this command when it is not the pinned one.
 *
 * `packageManager` is a declaration, and Corepack obeys it only where Corepack is enabled. Without
 * this the pin was a comment: a project could declare `pnpm@11.9.0`, pass the wiring gate, and resolve
 * its whole tree with another pnpm - which is the one difference that changes what every other pin
 * means, because the lockfile it produces is the input to every gate that follows.
 * @param userAgent the `npm_config_user_agent` of the running process.
 * @param required the pinned version, from {@link pinnedPnpmVersion}.
 * @returns one finding when the running pnpm disagrees; empty when it agrees or cannot be observed.
 */
export const findPnpmRuntimeViolations = (
  userAgent: string | undefined,
  required: string | undefined,
): readonly string[] => {
  const found: RegExpExecArray | null = PNPM_USER_AGENT.exec(userAgent ?? '')
  const running: string | undefined = found?.[1]
  // An absent or non-pnpm user agent means this command was not started by pnpm at all - `npx`, a
  // direct `node` invocation, a CI step calling the binary. There is no version to disagree with, and
  // inventing a failure there would report a project for how its operator launched one command.
  if (required === undefined || running === undefined || running === required) {
    return []
  }
  return [
    `pnpm ${running} is running this command but ploaness pins pnpm@${required}; ` +
      'enable Corepack, because the package manager resolves the tree every other pin describes',
  ]
}
