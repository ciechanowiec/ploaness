// Dependency-freshness policy: the pure, unit-tested logic that reads the coordinates a repository
// declares and classifies how far each has drifted from its latest published release. The `deps` gate in
// packages/cli/src/checks/dependencies.ts reads the manifests and asks the registry.
//
// Policy: a declared dependency (transitive deps never count) whose current major version is
// MAJOR_FAIL_THRESHOLD or more behind the latest published major FAILS the build; any lesser lag (a
// single major behind, or a minor/patch behind) is a non-failing WARNING. The Biome config `$schema`
// URL version is fed through the same classifier as a pseudo-dependency. There is no exemption list:
// every declared dependency is held to the same bar, so a deliberately old pin that falls two majors
// behind must be bumped or the pin dropped.

import { declaredDependencies } from './json-shapes.js'

/** The build impact of a dependency's drift from its latest published release. */
export type FreshnessVerdict = 'ok' | 'warn' | 'fail'

/** Major-version gap (`latest.major - current.major`) at or above which the gate FAILS the build. */
export const MAJOR_FAIL_THRESHOLD: number = 2

/** A dependency version parsed into its numeric core plus any prerelease tag. */
export interface ParsedVersion {
  readonly major: number
  readonly minor: number
  readonly patch: number
  readonly prerelease: string
}

// A leading range operator (`^ ~ >= <= = v`) or whitespace is tolerated, then the numeric core is
// read into positional groups (major, minor, patch, prerelease); an optional `-prerelease` tag is
// captured and build metadata after `+` is ignored. The core mirrors the `$schema` version regex in
// check-biome-schema.ts.
const VERSION_PATTERN: RegExp = /^[\sv^~>=<]*(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([^+\s]+))?/

/**
 * Parse a version or range string into its numeric core plus any prerelease tag, tolerating a leading
 * range operator (`^`, `~`, `>=`) or `v` and trailing build metadata. Returns `undefined` when there
 * is no leading numeric major - for example `workspace:*`, `link:../pkg`, `*`, or a missing latest - so
 * the caller treats such a dependency as unclassifiable and skips it.
 * @param raw the version or range string to parse.
 * @returns the parsed core and prerelease, or `undefined` when no numeric major is present.
 */
export const parseVersion = (raw: string): ParsedVersion | undefined => {
  const match: RegExpExecArray | null = VERSION_PATTERN.exec(raw)
  if (match === null) {
    return undefined
  }
  return {
    major: Number(match[1] ?? '0'),
    minor: Number(match[2] ?? '0'),
    patch: Number(match[3] ?? '0'),
    prerelease: match[4] ?? '',
  }
}

// Order two parsed versions: numeric core first, then a prerelease sorts BELOW the same core release
// (the semver rule), so `1.0.0-rc.1` is behind `1.0.0`.
const compareCore = (left: ParsedVersion, right: ParsedVersion): number => {
  if (left.major !== right.major) {
    return left.major - right.major
  }
  if (left.minor !== right.minor) {
    return left.minor - right.minor
  }
  if (left.patch !== right.patch) {
    return left.patch - right.patch
  }
  if (left.prerelease === right.prerelease) {
    return 0
  }
  if (left.prerelease === '') {
    return 1
  }
  if (right.prerelease === '') {
    return -1
  }
  return left.prerelease < right.prerelease ? -1 : 1
}

/**
 * Classify how far a current version has drifted from the latest published version. Unclassifiable
 * inputs (a version that does not parse, such as `workspace:*` or an absent latest) are `ok` and
 * silently skipped. Otherwise the verdict is `fail` when the latest major is MAJOR_FAIL_THRESHOLD or
 * more ahead, `warn` when the current is strictly behind by any lesser amount (a single major, or a
 * minor/patch), and `ok` when the current is level with or ahead of the latest. Because the major gap
 * uses the literal `major` field, a `0.x` package is compared on that leading `0` (so `0.35.2` to
 * `0.35.3` warns, and only a jump to `2.x` fails).
 * @param current the version currently declared/installed.
 * @param latest the latest version published to the registry.
 * @returns the freshness verdict for the pair.
 */
export const classifyFreshness = (current: string, latest: string): FreshnessVerdict => {
  const currentVersion: ParsedVersion | undefined = parseVersion(current)
  const latestVersion: ParsedVersion | undefined = parseVersion(latest)
  if (currentVersion === undefined || latestVersion === undefined) {
    return 'ok'
  }
  if (latestVersion.major - currentVersion.major >= MAJOR_FAIL_THRESHOLD) {
    return 'fail'
  }
  return compareCore(currentVersion, latestVersion) < 0 ? 'warn' : 'ok'
}

/** One dependency, plugin, or parent as some manifest of the repository declares it. */
export interface DeclaredCoordinate {
  /** The package name, or a `$schema` pseudo-dependency label. */
  readonly name: string
  /** The repo-relative manifest that declares it, so a finding names the file to change. */
  readonly owner: string
  /** The version currently declared/installed. */
  readonly current: string
}

/** A declared coordinate paired with what the registry answered for it. */
export interface DependencyStatus extends DeclaredCoordinate {
  /** The latest version published to the registry. */
  readonly latest: string
}

/** One parsed manifest of the repository, with the repo-relative path a finding will name. */
export interface ManifestSource {
  readonly path: string
  readonly packageJson: unknown
}

/**
 * Read every declared coordinate out of every manifest of the repository.
 *
 * A workspace declares its toolchain across several manifests, and reading only the root one left the
 * analyzers ploaness itself runs on unmeasured. A name declared in two manifests stays two coordinates
 * rather than collapsing into one: the two may pin different versions, and collapsing would hide
 * whichever of them is stale. No sort is applied because none is needed - the caller hands over the
 * manifests in the order git lists them, and a parsed object preserves the order its file declared, so
 * the same tree yields the same report.
 * @param manifests the parsed manifests, each with the path that declares it.
 * @returns one coordinate per declaration.
 */
export const collectCoordinates = (
  manifests: readonly ManifestSource[],
): readonly DeclaredCoordinate[] =>
  manifests.flatMap((manifest: ManifestSource): readonly DeclaredCoordinate[] =>
    Object.entries(declaredDependencies(manifest.packageJson)).map(
      ([name, current]: readonly [string, string]): DeclaredCoordinate => ({
        name,
        owner: manifest.path,
        current,
      }),
    ),
  )

/** A dependency status that classified as a non-`ok` verdict, carried through for reporting. */
export interface FreshnessFinding extends DependencyStatus {
  readonly verdict: 'warn' | 'fail'
}

/** The failing and warning findings for a set of dependency statuses; `ok` statuses are omitted. */
export interface FreshnessReport {
  readonly failures: readonly FreshnessFinding[]
  readonly warnings: readonly FreshnessFinding[]
}

/**
 * Partition dependency statuses into build-failing and warning findings, dropping the `ok` ones. A
 * `fail` verdict (two or more majors behind) lands in `failures`; any lesser lag lands in `warnings`.
 * @param statuses the declared dependencies (and `$schema` pseudo-dependencies) to classify.
 * @returns the grouped findings; both arrays are empty when every status is fresh.
 */
interface JudgedStatus {
  readonly status: DependencyStatus
  readonly verdict: FreshnessVerdict
}

export const findFreshnessViolations = (statuses: readonly DependencyStatus[]): FreshnessReport => {
  // The verdict is computed once per status; the two reported groups are then filters over it rather
  // than two lists filled in the same pass.
  const judged: readonly JudgedStatus[] = statuses.map(
    (status: DependencyStatus): JudgedStatus => ({
      status,
      verdict: classifyFreshness(status.current, status.latest),
    }),
  )
  const withVerdict = (verdict: 'fail' | 'warn'): readonly FreshnessFinding[] =>
    judged
      .filter((entry: JudgedStatus): boolean => entry.verdict === verdict)
      .map((entry: JudgedStatus): FreshnessFinding => ({ ...entry.status, verdict }))
  return { failures: withVerdict('fail'), warnings: withVerdict('warn') }
}
