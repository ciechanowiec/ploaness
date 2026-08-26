// Whether a container image the harness pins is still the newest of its own tag scheme.
//
// The freshness rule covers a versioned input, which is a declared coordinate OR a container image the
// harness owns. The two are measured differently and that difference is deliberate: a coordinate is
// held to the freshness bound, because a major-version gap is a claim about a release line, while an
// image tag is not required to carry one. An image update is therefore reported and never fails.
//
// Every decision here is pure. The registry read that supplies `availableTags` and `currentDigest` is
// the CLI's, because it is I/O; what counts as a stable tag, which tags are comparable with the pinned
// one, and which of them is newest are rules, and a rule that reads its own network cannot be tested
// without one.
/** A digest-pinned image reference, split into the parts a registry API addresses it by. */
export interface ContainerReference {
  /** The analyzer the image runs, which is the property that declares it. */
  readonly tool: string
  /** The repository as written, such as `zricethezav/gitleaks`. */
  readonly name: string
  readonly namespace: string
  readonly repository: string
  /** The human-readable version tag, which is what a newer release is compared against. */
  readonly tag: string
  /** The immutable digest the pin actually resolves to. */
  readonly digest: string
}

/**
 * A stable numeric tag, and the syntax family it belongs to.
 *
 * The family matters as much as the number. A repository commonly publishes several schemes at once -
 * `2.14.0` beside `v2.14`, and a date-stamped line beside both - and comparing across them reports an
 * "update" that is a different artefact rather than a newer one.
 */
export interface ContainerTag {
  readonly raw: string
  /** The `v` a tag may lead with, kept because a repository that uses one uses it consistently. */
  readonly prefix: string
  readonly parts: readonly number[]
  /** True when the leading component reads as a year, which dates a line rather than versioning it. */
  readonly isCalendar: boolean
}

// A stable tag is numeric and has at least two components. One component cannot be told apart from a
// build number, and anything carrying a suffix - `-alpine`, `-rc1`, `-debug` - is either a variant or a
// prerelease, neither of which a pin should move to on its own.
const STABLE_TAG: RegExp = /^(?<prefix>v?)(?<version>\d+(?:\.\d+)+)$/

const PINNED_REFERENCE: RegExp =
  /^(?<name>[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*):(?<tag>[A-Za-z0-9][\w.-]*)@(?<digest>sha256:[0-9a-f]{64})$/

// Ordered by component rather than by the semver rule `dependency-freshness.ts` implements. A tag has
// no prerelease - the pattern above refuses any suffix - and its component COUNT is meaningful here,
// which a three-position core discards: it would read `2024.1` and `2024.1.0` as one version and drop a
// fourth component entirely. Different questions, so a different comparison rather than a shared one.
const compareParts = (one: readonly number[], other: readonly number[]): number => {
  const width: number = Math.max(one.length, other.length)
  const differences: readonly number[] = Array.from(
    { length: width },
    (_: unknown, index: number): number => (one[index] ?? 0) - (other[index] ?? 0),
  )
  return differences.find((difference: number): boolean => difference !== 0) ?? 0
}

// A repository name is exactly one namespace and one repository, so the split takes both and no more.
const NAME_PARTS: number = 2

const YEAR_LENGTH: number = 4
const FIRST_CALENDAR_YEAR: number = 2000
const LAST_CALENDAR_YEAR: number = 2099

/**
 * Read a digest-pinned reference into its addressable parts.
 * @param tool the analyzer that runs the image, used to name the declaring property in a report.
 * @param reference the `repository:tag@sha256:digest` reference.
 * @returns the parts, or undefined when the reference is not pinned in that form.
 */
export const parseContainerReference = (
  tool: string,
  reference: string,
): ContainerReference | undefined => {
  const found: RegExpExecArray | null = PINNED_REFERENCE.exec(reference)
  if (found?.groups === undefined) {
    return undefined
  }
  const name: string = found.groups['name'] ?? ''
  const [namespace, repo]: readonly string[] = name.split('/', NAME_PARTS)
  return namespace === undefined || repo === undefined
    ? undefined
    : {
        tool,
        name,
        namespace,
        repository: repo,
        tag: found.groups['tag'] ?? '',
        digest: found.groups['digest'] ?? '',
      }
}

const isCalendarLead = (lead: number | undefined): boolean =>
  lead !== undefined &&
  String(lead).length === YEAR_LENGTH &&
  lead >= FIRST_CALENDAR_YEAR &&
  lead <= LAST_CALENDAR_YEAR

/**
 * Read a tag as a stable version, or refuse it.
 * @param raw the tag as the registry publishes it.
 * @returns the parsed tag, or undefined for anything that is not a stable numeric version.
 */
export const parseContainerTag = (raw: string): ContainerTag | undefined => {
  const found: RegExpExecArray | null = STABLE_TAG.exec(raw)
  if (found?.groups === undefined) {
    return undefined
  }
  const parts: readonly number[] = (found.groups['version'] ?? '').split('.').map(Number)
  return {
    raw,
    prefix: found.groups['prefix'] ?? '',
    parts,
    isCalendar: isCalendarLead(parts[0]),
  }
}

/**
 * Whether two tags belong to the same published line, and are therefore comparable.
 * @param one the pinned tag.
 * @param other a candidate from the registry.
 * @returns true when the prefix, the component count, and the calendar shape all agree.
 */
export const matchesTagScheme = (one: ContainerTag, other: ContainerTag): boolean =>
  one.prefix === other.prefix &&
  one.parts.length === other.parts.length &&
  one.isCalendar === other.isCalendar

/**
 * Order two tags by version.
 * @param one the first tag.
 * @param other the second tag.
 * @returns a negative number when `one` is older, positive when newer, zero when equal.
 */
export const compareContainerTags = (one: ContainerTag, other: ContainerTag): number =>
  compareParts(one.parts, other.parts)

/**
 * The newest tag of the pinned tag's own scheme.
 * @param current the pinned tag.
 * @param available every tag the registry lists.
 * @returns the newest comparable tag, which is `current` itself when nothing newer is published.
 */
export const latestOfScheme = (
  current: ContainerTag,
  available: readonly string[],
): ContainerTag => {
  const comparable: readonly ContainerTag[] = available
    .map((raw: string): ContainerTag | undefined => parseContainerTag(raw))
    .filter((tag: ContainerTag | undefined): tag is ContainerTag => tag !== undefined)
    .filter((tag: ContainerTag): boolean => matchesTagScheme(current, tag))
  return comparable.reduce(
    (newest: ContainerTag, tag: ContainerTag): ContainerTag =>
      compareContainerTags(tag, newest) > 0 ? tag : newest,
    current,
  )
}

/** What a registry read established about one pinned image. */
export interface ContainerInspection {
  readonly reference: ContainerReference
  /** Every tag the repository publishes. */
  readonly available: readonly string[]
  /** The digest the pinned TAG resolves to today, which a mutable tag may have moved. */
  readonly currentDigest: string
}

/** What the rule decided about one pinned image, with the registry reads already done. */
export interface ContainerVerdict {
  readonly reference: ContainerReference
  /** The newer tag, or undefined when the pin is already the newest of its scheme. */
  readonly newer: ContainerTag | undefined
  /** True when the declared tag no longer resolves to the digest pinned beside it. */
  readonly hasDrifted: boolean
  /** What the declared tag resolves to now, which the drift line names beside the pin. */
  readonly currentDigest: string
}

/**
 * Judge one inspected image.
 * @param inspection the reference and what the registry answered about it.
 * @returns the newer tag if one exists, and whether the declared tag has been repointed.
 */
export const judgeContainer = (inspection: ContainerInspection): ContainerVerdict => {
  const current: ContainerTag | undefined = parseContainerTag(inspection.reference.tag)
  const newest: ContainerTag | undefined =
    current === undefined ? undefined : latestOfScheme(current, inspection.available)
  return {
    reference: inspection.reference,
    newer:
      newest === undefined || current === undefined || compareContainerTags(newest, current) <= 0
        ? undefined
        : newest,
    hasDrifted: inspection.currentDigest !== inspection.reference.digest,
    currentDigest: inspection.currentDigest,
  }
}

/**
 * The report line for an image with a newer tag available.
 * @param reference the pinned image.
 * @param newer the newer tag.
 * @param newerDigest the digest that tag resolves to, which is what replaces the pin.
 * @returns one line naming the declaring property and the replacement reference.
 */
export const describeContainerUpdate = (
  reference: ContainerReference,
  newer: ContainerTag,
  newerDigest: string,
): string =>
  `update ${reference.tool} ${reference.name}:${reference.tag} -> ${newer.raw}; ` +
  `pin ${reference.name}:${newer.raw}@${newerDigest}`

/**
 * The report line for a tag that no longer resolves to the digest pinned beside it.
 * @param reference the pinned image.
 * @param currentDigest the digest the tag resolves to now.
 * @returns one line naming the declaring property and both digests.
 */
export const describeContainerDrift = (
  reference: ContainerReference,
  currentDigest: string,
): string =>
  `note ${reference.tool} ${reference.name}:${reference.tag} is pinned to ${reference.digest} ` +
  `but that tag now resolves to ${currentDigest}; the pin still names the bytes it always did`
