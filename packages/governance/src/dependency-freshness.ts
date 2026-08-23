// Dependency-freshness policy: the pure, unit-tested logic that classifies how far a declared
// dependency has drifted from its latest published release. The CLI that shells out to `pnpm outdated`
// and exits lives in scripts/check-dependency-freshness.ts.
//
// Policy: a declared dependency (transitive deps never count) whose current major version is
// MAJOR_FAIL_THRESHOLD or more behind the latest published major FAILS the build; any lesser lag (a
// single major behind, or a minor/patch behind) is a non-failing WARNING. The Biome config `$schema`
// URL version is fed through the same classifier as a pseudo-dependency. There is no exemption list:
// every declared dependency is held to the same bar, so a deliberately old pin that falls two majors
// behind must be bumped or the pin dropped.

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

/** A declared dependency (or Biome `$schema` pseudo-dependency) to classify, with its owning package. */
export interface DependencyStatus {
  /** The package name, or a `$schema` pseudo-dependency label. */
  readonly name: string
  /** The owning package location (repo-relative), so a finding can be attributed. */
  readonly owner: string
  /** The version currently declared/installed. */
  readonly current: string
  /** The latest version published to the registry. */
  readonly latest: string
}

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
export const findFreshnessViolations = (statuses: readonly DependencyStatus[]): FreshnessReport => {
  const failures: FreshnessFinding[] = []
  const warnings: FreshnessFinding[] = []
  for (const status of statuses) {
    const verdict: FreshnessVerdict = classifyFreshness(status.current, status.latest)
    if (verdict === 'fail') {
      failures.push({ ...status, verdict })
    } else if (verdict === 'warn') {
      warnings.push({ ...status, verdict })
    }
  }
  return { failures, warnings }
}
