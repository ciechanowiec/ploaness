// Dependency-freshness policy: the pure, unit-tested logic that reads the coordinates a repository
// declares and classifies how far each has drifted from its latest published release. The `deps` gate in
// packages/cli/src/checks/dependencies.ts reads the manifests and asks the registry.
//
// Policy: a declared dependency (transitive deps never count) whose current major version is
// MAJOR_FAIL_THRESHOLD or more behind the latest published major FAILS the build; any lesser lag (a
// single major behind, or a minor/patch behind) appears in the non-failing update report. The Biome config `$schema`
// URL version is fed through the same classifier as a pseudo-dependency. There is no exemption list:
// every declared dependency is MEASURED against the same bar, so a deliberately old pin that falls two
// majors behind must be bumped or the pin dropped.
//
// One thing the bar does not decide is who the build stops. A coordinate an INHERITED manifest declares
// is measured identically and reported at its real verdict, and it never fails the build: the version
// belongs to ploaness, the project has no file in which to change it, and a gate that stopped every
// consumer at once over a pin none of them can edit would be reporting ploaness's defect as theirs.
// That is a statement about whose repair it is rather than an exemption from the measurement, which is
// why the verdict survives into the report instead of being softened into an ordinary update.

import { isHarnessPackage } from './harness-package.js'
import { declaredDependencies } from './json-shapes.js'

/** The build impact of a dependency's drift from its latest published release. */
export type FreshnessVerdict = 'ok' | 'update' | 'fail'

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
// captured and build metadata after `+` is ignored. The core mirrors the `$schema` version regex the
// `biome-schema` gate uses in packages/cli/src/checks/toolchain.ts.
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
 * more ahead, `update` when the current is strictly behind by any lesser amount (a single major, or a
 * minor/patch), and `ok` when the current is level with or ahead of the latest. Because the major gap
 * uses the literal `major` field, a `0.x` package is compared on that leading `0` (so `0.35.2` to
 * `0.35.3` needs an update, and only a jump to `2.x` fails).
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
  return compareCore(currentVersion, latestVersion) < 0 ? 'update' : 'ok'
}

/** One dependency, plugin, or parent as some manifest of the repository declares it. */
export interface DeclaredCoordinate {
  /** The package name, or a `$schema` pseudo-dependency label. */
  readonly name: string
  /** The manifest that declares it, so a finding names what the reader has to open. */
  readonly owner: string
  /** The version currently declared/installed. */
  readonly current: string
  /**
   * True when the manifest is one the project INHERITS rather than one it wrote.
   *
   * The measurement is the same either way. What differs is who the finding belongs to: a project
   * cannot edit a version ploaness declares, so the repair is upgrading the harness, and the build is
   * not stopped over it. `HARNESS_EXCEPTIONS` in `vulnerability-policy.ts` draws the same distinction
   * for an advisory carried by ploaness's own chain, and for the same reason.
   */
  readonly isInherited: boolean
}

/** A declared coordinate paired with what the registry answered for it. */
export interface DependencyStatus extends DeclaredCoordinate {
  /** The latest version published to the registry. */
  readonly latest: string
}

/** One parsed manifest, with the path a finding will name. */
export interface ManifestSource {
  readonly path: string
  readonly packageJson: unknown
  /** True for a manifest the project inherits rather than one it tracks. */
  readonly isInherited: boolean
}

/**
 * How the inheritance walk reaches one manifest from another.
 *
 * Injected so this module performs no I/O: the CLI supplies a resolver over the real filesystem, and a
 * spec supplies one over a literal map. Which manifests a project inherits is a decision about what the
 * standard counts, and a decision belongs where it can be tested without building an install.
 */
export interface ManifestResolver {
  /** The manifest `packageName` resolves to FROM `fromManifest`, or undefined when unreachable. */
  readonly locate: (packageName: string, fromManifest: string) => string | undefined
  /** The parsed manifest at a path. */
  readonly read: (manifestPath: string) => unknown
}

/** A walk in progress: where it has been, and what it found, in discovery order. */
interface Inheritance {
  readonly visited: ReadonlySet<string>
  readonly manifests: readonly string[]
}

const stepInto = (
  walk: Inheritance,
  manifestPath: string | undefined,
  resolver: ManifestResolver,
): Inheritance => {
  if (manifestPath === undefined || walk.visited.has(manifestPath)) {
    return walk
  }
  const entered: Inheritance = {
    visited: new Set<string>([...walk.visited, manifestPath]),
    manifests: [...walk.manifests, manifestPath],
  }
  return Object.keys(declaredDependencies(resolver.read(manifestPath)))
    .filter((name: string): boolean => isHarnessPackage(name))
    .reduce(
      (carried: Inheritance, name: string): Inheritance =>
        stepInto(carried, resolver.locate(name, manifestPath), resolver),
      entered,
    )
}

/**
 * The manifests a project inherits, in discovery order, starting from the harness it declares.
 *
 * Walked rather than enumerated. A list of ploaness's packages would be a second copy of what their own
 * manifests already declare, and a package added later would then be inherited by every consumer and
 * read by nothing. The walk re-roots at each manifest, because a resolver's answer depends on where it
 * is asked from, and it carries `visited` across siblings for two reasons: the packages form a diamond,
 * so a shared one would otherwise be reported twice, and a cycle would otherwise not terminate.
 * @param entry the manifest the project resolves the harness to, or undefined when it declares none.
 * @param resolver how to reach and read a manifest.
 * @returns each inherited manifest path once, the entry first.
 */
export const inheritedManifestPaths = (
  entry: string | undefined,
  resolver: ManifestResolver,
): readonly string[] =>
  stepInto({ visited: new Set<string>(), manifests: [] }, entry, resolver).manifests

/**
 * Read every declared coordinate out of every manifest, the project's own and the ones it inherits.
 *
 * A workspace declares its toolchain across several manifests, and reading only the root one left the
 * analyzers ploaness itself runs on unmeasured. The standard counts an INHERITED manifest too, and the
 * manifests deciding which analyzer versions a governed project's gates run are ploaness's own - none
 * of which the project tracks, so a reader of tracked files alone can never see them.
 *
 * A name declared in two manifests stays two coordinates
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
        isInherited: manifest.isInherited,
      }),
    ),
  )

/** A dependency status that classified as a non-`ok` verdict, carried through for reporting. */
export interface FreshnessFinding extends DependencyStatus {
  readonly verdict: 'update' | 'fail'
}

/**
 * The findings for a set of dependency statuses; `ok` statuses are omitted.
 *
 * The split is by BUILD IMPACT, not by verdict: `failures` is what stops the run and `reported` is
 * everything else worth printing. Each finding still carries the verdict it was measured at, so an
 * inherited coordinate past the bound arrives in `reported` saying `fail` - which is the only way to
 * report it honestly without stopping a project that cannot repair it.
 */
export interface FreshnessReport {
  readonly failures: readonly FreshnessFinding[]
  readonly reported: readonly FreshnessFinding[]
}

interface JudgedStatus {
  readonly status: DependencyStatus
  readonly verdict: FreshnessVerdict
}

// The one place the two questions are told apart: how far behind a coordinate is, and whether being
// that far behind stops this build.
const willStopTheBuild = (entry: JudgedStatus): boolean =>
  entry.verdict === 'fail' && !entry.status.isInherited

/**
 * Partition dependency statuses by what each does to the build, dropping the `ok` ones.
 * @param statuses the declared dependencies (and `$schema` pseudo-dependencies) to classify.
 * @returns the findings that stop the run, and the rest of the report; both empty when all are fresh.
 */
export const findFreshnessViolations = (statuses: readonly DependencyStatus[]): FreshnessReport => {
  // The verdict is computed once per status; the two reported groups are then filters over it rather
  // than two lists filled in the same pass.
  const judged: readonly JudgedStatus[] = statuses.map(
    (status: DependencyStatus): JudgedStatus => ({
      status,
      verdict: classifyFreshness(status.current, status.latest),
    }),
  )
  const findingsOf = (entries: readonly JudgedStatus[]): readonly FreshnessFinding[] =>
    entries.flatMap((entry: JudgedStatus): readonly FreshnessFinding[] =>
      entry.verdict === 'ok' ? [] : [{ ...entry.status, verdict: entry.verdict }],
    )
  return {
    failures: findingsOf(judged.filter((entry: JudgedStatus): boolean => willStopTheBuild(entry))),
    reported: findingsOf(judged.filter((entry: JudgedStatus): boolean => !willStopTheBuild(entry))),
  }
}
