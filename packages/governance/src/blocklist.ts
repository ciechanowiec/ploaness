// The refusal rule: whether an image reference, an installed package, or a Dockerfile install line
// names something in `blocklist-entries.ts`, and the one place freshness has to defer to it.
//
// A reference is matched on its repository after normalisation, because the same image is written
// `mongo`, `docker.io/mongo`, `library/mongo`, and `docker.io/library/mongo`, and a list keyed on the
// spelling would refuse one of them and pull the other. The tag decides only where an entry carries a
// floor: a tag below the floor is the permissive release line and is left to the licence gate, and a
// tag that cannot be placed against the floor - `latest`, none, `7` against a floor of `7.4`, an
// `-alpine` suffix on a floating major - is refused, because a tag that may resolve past the floor
// tomorrow is not a proof that it sits below it today.

import {
  BLOCKED_IMAGES,
  BLOCKED_PACKAGES,
  BLOCKED_SYSTEM_PACKAGES,
  type BlockedImage,
  type BlockedPackage,
  type BlockedSystemPackage,
} from './blocklist-entries.js'
import { systemPackagesInDockerfile } from './container-images.js'
import { type DependencyStatus, type ParsedVersion, parseVersion } from './dependency-freshness.js'
import { asRecord, asText, isArray, isRecord, parseJsonc } from './json-shapes.js'
import { isLicenseAllowed } from './license-allowlist.js'

/** One refusal, ready to be printed beside the file that carries the subject. */
export interface Refusal {
  /** The reference, the `name@version`, or the system package as written. */
  readonly subject: string
  readonly reason: string
  readonly replacement: string
}

/** An image reference split into the parts the rule reads. */
export interface ImageReference {
  readonly raw: string
  /** The repository in the normalised form `blocklist-entries.ts` uses. */
  readonly repository: string
  readonly tag: string | undefined
  readonly digest: string | undefined
}

const DOCKER_HUB_HOSTS: ReadonlySet<string> = new Set(['docker.io', 'index.docker.io'])
const OFFICIAL_NAMESPACE: string = 'library'
const LOCAL_HOST: string = 'localhost'
const MUTABLE_TAG: string = 'latest'
const WILDCARD: string = '*'
const NUMERIC_COMPONENTS: RegExp = /^v?(?<components>\d+(?:\.\d+)*)/
// A reference is a name-and-tag and at most one digest after the `@`.
const REFERENCE_PARTS: number = 2

// A first path segment is a registry host when it carries a dot or a port, or is `localhost`; a Docker
// Hub namespace never does. The rule the docker CLI itself applies.
const isRegistryHost = (segment: string): boolean =>
  segment.includes('.') || segment.includes(':') || segment === LOCAL_HOST

interface RepositoryPath {
  /** The registry host, or undefined for Docker Hub however it was spelled. */
  readonly host: string | undefined
  readonly path: readonly string[]
}

const splitHost = (segments: readonly string[]): RepositoryPath => {
  const [first]: readonly (string | undefined)[] = segments
  if (first === undefined || segments.length === 1 || !isRegistryHost(first)) {
    return { host: undefined, path: segments }
  }
  return { host: DOCKER_HUB_HOSTS.has(first) ? undefined : first, path: segments.slice(1) }
}

const normaliseRepository = (name: string): string => {
  const { host, path }: RepositoryPath = splitHost(name.toLowerCase().split('/'))
  if (host !== undefined) {
    return [host, ...path].join('/')
  }
  return (path.length > 1 && path[0] === OFFICIAL_NAMESPACE ? path.slice(1) : path).join('/')
}

/**
 * Split an image reference as a Dockerfile, a workflow, or a compose model writes it.
 * @param raw the reference, such as `docker.io/library/redis:7.4.1@sha256:...`.
 * @returns the normalised repository, and the tag and digest when present.
 */
export const parseImageReference = (raw: string): ImageReference => {
  const [nameAndTag = '', digest]: readonly (string | undefined)[] = raw.split('@', REFERENCE_PARTS)
  const lastSlash: number = nameAndTag.lastIndexOf('/')
  const colon: number = nameAndTag.lastIndexOf(':')
  const hasTag: boolean = colon > lastSlash
  return {
    raw,
    repository: normaliseRepository(hasTag ? nameAndTag.slice(0, colon) : nameAndTag),
    tag: hasTag ? nameAndTag.slice(colon + 1) : undefined,
    digest,
  }
}

/**
 * Whether a reference may resolve to a different image tomorrow: no digest, and no tag or `latest`.
 * @param raw the reference as written.
 * @returns true when nothing in the reference pins what is pulled.
 */
export const isMutableImageReference = (raw: string): boolean => {
  const reference: ImageReference = parseImageReference(raw)
  return (
    reference.digest === undefined && (reference.tag === undefined || reference.tag === MUTABLE_TAG)
  )
}

const matchesPattern = (pattern: string, name: string): boolean =>
  pattern.endsWith(WILDCARD)
    ? name.startsWith(pattern.slice(0, -WILDCARD.length))
    : name === pattern

const compareCore = (one: ParsedVersion, other: ParsedVersion): number =>
  one.major - other.major || one.minor - other.minor || one.patch - other.patch

const componentCount = (version: string): number =>
  (NUMERIC_COMPONENTS.exec(version)?.groups?.['components'] ?? '').split('.').filter(Boolean).length

// Undecidable is refused: a version that cannot be placed against the floor is not below it.
const reachesFloor = (version: string | undefined, floor: string): boolean => {
  const parsed: ParsedVersion | undefined =
    version === undefined ? undefined : parseVersion(version)
  const floorParsed: ParsedVersion | undefined = parseVersion(floor)
  if (version === undefined || parsed === undefined || floorParsed === undefined) {
    return true
  }
  return componentCount(version) < componentCount(floor) || compareCore(parsed, floorParsed) >= 0
}

const isAllowedTag = (entry: BlockedImage, tag: string | undefined): boolean =>
  entry.allowedTag !== undefined && tag !== undefined && entry.allowedTag.test(tag)

const refusalOf = (
  subject: string,
  entry: BlockedImage | BlockedPackage | BlockedSystemPackage,
): Refusal => ({
  subject,
  reason: entry.reason,
  replacement: entry.replacement,
})

/**
 * Whether an image reference names a refused repository at a refused tag.
 * @param raw the reference as written.
 * @returns the refusal, or undefined when the image is not one ploaness refuses.
 */
export const refuseImage = (raw: string): Refusal | undefined => {
  const reference: ImageReference = parseImageReference(raw)
  const entry: BlockedImage | undefined = BLOCKED_IMAGES.find((candidate: BlockedImage): boolean =>
    matchesPattern(candidate.repository, reference.repository),
  )
  if (entry === undefined || isAllowedTag(entry, reference.tag)) {
    return undefined
  }
  return entry.from !== undefined && !reachesFloor(reference.tag, entry.from)
    ? undefined
    : refusalOf(raw, entry)
}

/**
 * Whether an installed package at a version is one ploaness refuses.
 * @param name the package name.
 * @param version the resolved version.
 * @returns the refusal, or undefined when the package is not one ploaness refuses at that version.
 */
export const refusePackage = (name: string, version: string): Refusal | undefined => {
  const entry: BlockedPackage | undefined = BLOCKED_PACKAGES.find(
    (candidate: BlockedPackage): boolean => matchesPattern(candidate.name, name),
  )
  if (entry === undefined) {
    return undefined
  }
  return entry.from !== undefined && !reachesFloor(version, entry.from)
    ? undefined
    : refusalOf(`${name}@${version}`, entry)
}

/**
 * The refused system packages a Dockerfile installs.
 * @param text the Dockerfile body.
 * @returns one refusal per refused package, in file order.
 */
export const refuseSystemPackages = (text: string): readonly Refusal[] =>
  systemPackagesInDockerfile(text).flatMap((name: string): readonly Refusal[] => {
    const entry: BlockedSystemPackage | undefined = BLOCKED_SYSTEM_PACKAGES.find(
      (candidate: BlockedSystemPackage): boolean => candidate.name === name,
    )
    return entry === undefined ? [] : [refusalOf(name, entry)]
  })

/** One package of the resolved set, at every version the install carries. */
export interface InstalledPackage {
  readonly name: string
  readonly versions: readonly string[]
}

/**
 * The resolved set as `pnpm licenses list --json` reports it: grouped by licence, each entry carrying
 * the name and the versions installed.
 * @param json the command's stdout.
 * @returns every installed package, or undefined when the text is not that inventory.
 */
export const packagesInLicenseInventory = (
  json: string,
): readonly InstalledPackage[] | undefined => {
  const inventory: unknown = parseJsonc(json).value
  if (!isRecord(inventory) || isArray(inventory)) {
    return undefined
  }
  return Object.values(inventory).flatMap((group: unknown): readonly InstalledPackage[] =>
    (isArray(group) ? group : []).map((entry: unknown): InstalledPackage => {
      const versions: unknown = asRecord(entry)['versions']
      return {
        name: asText(asRecord(entry)['name']),
        versions: (isArray(versions) ? versions : []).map((raw: unknown): string => asText(raw)),
      }
    }),
  )
}

/**
 * The refusals across an installed set.
 * @param packages the resolved set.
 * @returns one refusal per refused name and version, in inventory order.
 */
export const refuseInstalledPackages = (
  packages: readonly InstalledPackage[],
): readonly Refusal[] =>
  packages.flatMap((entry: InstalledPackage): readonly Refusal[] =>
    entry.versions.flatMap((version: string): readonly Refusal[] => {
      const refusal: Refusal | undefined = refusePackage(entry.name, version)
      return refusal === undefined ? [] : [refusal]
    }),
  )

/** A declared coordinate whose newest release the freshness bound may not demand. */
export interface RefusedLatest {
  readonly status: DependencyStatus
  /** Why the newest release is out of reach, in the words the report prints. */
  readonly note: string
}

/** The statuses freshness measures, and the ones whose newest release it may not point at. */
export interface FreshnessScope {
  readonly measurable: readonly DependencyStatus[]
  readonly refused: readonly RefusedLatest[]
}

// The one place the freshness bound defers to this rule. A package whose newest major is refused here,
// or is licensed outside the allowlist, would otherwise fall two majors behind and be failed for not
// upgrading into the very release the licence gate would then refuse.
const refusedLatestNote = (status: DependencyStatus): string | undefined => {
  const refusal: Refusal | undefined = refusePackage(status.name, status.latest)
  const newest: string = `${status.name}: the newest release ${status.latest}`
  if (refusal !== undefined) {
    return `${newest} is refused (${refusal.reason}), so freshness stops short of it`
  }
  const licence: string | undefined = status.latestLicense
  return licence === undefined || isLicenseAllowed(licence)
    ? undefined
    : `${newest} is licensed ${licence}, outside the allowlist, so freshness stops short of it`
}

/**
 * Split the declared coordinates into those freshness may measure and those whose newest release is
 * refused, which freshness must not demand.
 * @param statuses every declared coordinate with what the registry answered for it.
 * @returns the measurable statuses, and the refused ones with the note the report prints.
 */
export const scopeFreshness = (statuses: readonly DependencyStatus[]): FreshnessScope =>
  statuses.reduce(
    (scope: FreshnessScope, status: DependencyStatus): FreshnessScope => {
      const note: string | undefined = refusedLatestNote(status)
      return note === undefined
        ? { ...scope, measurable: [...scope.measurable, status] }
        : { ...scope, refused: [...scope.refused, { status, note }] }
    },
    { measurable: [], refused: [] },
  )

/**
 * The refusals of a repository's own JSON summary, kept exported so the CLI prints the same words.
 * @param refusal one refusal.
 * @param location the file or inventory that carries the subject.
 * @returns one finding line.
 */
export const describeRefusal = (refusal: Refusal, location: string): string =>
  `${location}: ${refusal.subject} - ${refusal.reason}; use ${refusal.replacement}`
