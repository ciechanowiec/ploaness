// Dependency gates. A license is a fixed fact of a package version, so it changes state only when you add
// or upgrade something: a true signal about your change. Freshness is bounded rather than banned, because
// "a newer version exists" is not a property of your change, but "the version I declared is two majors
// behind" is, and that is a real liability.
import { realpathSync } from 'node:fs'
import path from 'node:path'
import {
  type Advisory,
  asRecord,
  asText,
  collectCoordinates,
  type DeclaredCoordinate,
  type DependencyStatus,
  type FreshnessFinding,
  type FreshnessReport,
  findFreshnessViolations,
  findLicenseViolations,
  HARNESS_EXCEPTIONS,
  HARNESS_PACKAGE,
  hoursPublished,
  inheritedManifestPaths,
  isArray,
  isHeldByReleaseAge,
  isRecord,
  judgeVulnerabilities,
  type LicensedPackage,
  type ManifestResolver,
  type ManifestSource,
  mapWithConcurrency,
  NETWORKED_TOOL_TIMEOUT_MS,
  REGISTRY_CONCURRENCY,
  RELEASE_AGE_FLOOR_HOURS,
  REQUEST_TIMEOUT_MS,
  type ReleaseAge,
  type VulnerabilityReport,
} from '@ploaness/governance'
import { type Context, manifestPathFrom, readJson, workingTreeFiles } from '../context.js'
import {
  failed,
  type GateResult,
  passed,
  type RunResult,
  run,
  TIMED_OUT_CODE,
  withOutput,
} from '../exec.js'
import { type ImageReport, imageFreshness } from './images.js'

interface PnpmLicenseEntry {
  readonly name: string
  readonly license: string
}

/** Every dependency license must sit inside the allowlist. */
// Report enough of a tool's raw output to diagnose it, without pasting a whole log into a finding.
const MAX_REPORTED_CHARS: number = 2000
const MAX_REPORTED_LINES: number = 5
const MAX_LISTED_NAMES: number = 10
// The registry answers with this status for a package it has never published.
const NOT_FOUND: number = 404

export const licenses = (context: Context): GateResult => {
  const result: RunResult = run('pnpm', ['licenses', 'list', '--json'], { cwd: context.root })
  if (result.code !== 0) {
    return failed('the license inventory could not be produced', [result.output])
  }
  // `stdout`, not `output`. pnpm writes ` WARN ` lines to stderr as a matter of course, and `output`
  // concatenates the two streams with no separator - so a warning about an unsupported engine made the
  // inventory unparseable and this gate blamed the parse rather than the warning.
  const grouped: Record<string, readonly PnpmLicenseEntry[]> | undefined = parseLicenseInventory(
    result.stdout,
  )
  if (grouped === undefined) {
    return failed('the license inventory was not valid JSON', [
      result.output.slice(0, MAX_REPORTED_CHARS),
    ])
  }
  const packages: readonly LicensedPackage[] = Object.values(grouped)
    .flat()
    .map(
      (entry: PnpmLicenseEntry): LicensedPackage => ({
        name: entry.name,
        license: entry.license,
      }),
    )
  const violations: readonly LicensedPackage[] = findLicenseViolations(packages)
  return withOutput(
    violations.length > 0
      ? failed(
          `${String(violations.length)} dependency license(s) outside policy`,
          violations.map((entry: LicensedPackage): string => `${entry.name}: ${entry.license}`),
        )
      : passed(`all ${String(packages.length)} dependency licenses are within policy`),
    result.stdout,
  )
}

const MANIFEST_NAME: string = 'package.json'

// Every manifest the repository tracks, not only the root one. A workspace declares its toolchain across
// several of them, and reading the root alone left every analyzer ploaness itself runs on unmeasured.
const repositoryManifests = (context: Context): readonly ManifestSource[] =>
  workingTreeFiles(context.root)
    .filter((file: string): boolean => file === MANIFEST_NAME || file.endsWith(`/${MANIFEST_NAME}`))
    .map(
      (file: string): ManifestSource => ({
        path: file,
        packageJson: readJson(path.join(context.root, file)),
        isInherited: false,
      }),
    )

// A path as the filesystem finally names it, so the same manifest reached two ways compares equal.
// Under pnpm every installed package is a symlink into the store, and in a workspace it is a symlink
// back into the tree - which is how an inherited manifest can turn out to be one of the repository's own.
const realPathOrSelf = (file: string): string => {
  try {
    return realpathSync(file)
  } catch {
    return file
  }
}

// The one place the walk touches the filesystem. Everything it decides - which dependencies to follow,
// how a diamond and a cycle are handled - is in @ploaness/governance, where a spec states it without
// building an install.
const HARNESS_RESOLVER: ManifestResolver = { locate: manifestPathFrom, read: readJson }

// A manifest names itself, which is what a finding should say. The path under node_modules is a store
// address that differs between two installs of the same version, so it identifies nothing a reader can
// act on.
const declaredName = (packageJson: unknown, fallback: string): string =>
  asText(asRecord(packageJson)['name']) || fallback

// The manifests a project INHERITS: `ploaness` as the project itself resolves it, and every ploaness
// package that one pulls in. The standard counts these as declared coordinates, and they are the
// manifests that decide which analyzer versions the project's gates actually run - none of which the
// project's own tree holds, so a reader of the working tree alone could never see them. That is why a consumer's
// update report was silent about a harness pin going stale while ploaness's own report was not.
const inheritedManifests = (
  context: Context,
  own: readonly ManifestSource[],
): readonly ManifestSource[] => {
  const alreadyRead: ReadonlySet<string> = new Set<string>(
    own.map((manifest: ManifestSource): string =>
      realPathOrSelf(path.join(context.root, manifest.path)),
    ),
  )
  const entry: string | undefined = manifestPathFrom(
    HARNESS_PACKAGE,
    path.join(context.root, MANIFEST_NAME),
  )
  return inheritedManifestPaths(entry, HARNESS_RESOLVER)
    .filter((file: string): boolean => !alreadyRead.has(realPathOrSelf(file)))
    .map((file: string): ManifestSource => {
      const packageJson: unknown = readJson(file)
      return {
        path: `${declaredName(packageJson, file)}/${MANIFEST_NAME}`,
        packageJson,
        isInherited: true,
      }
    })
}

const manifestSources = (context: Context): readonly ManifestSource[] => {
  const own: readonly ManifestSource[] = repositoryManifests(context)
  return [...own, ...inheritedManifests(context, own)]
}

// The registry exposes two documents per package: the packument root and, per version, a version
// document. `/{name}/latest` is the version document for the `latest` dist-tag and costs a few kilobytes,
// while the packument root costs tens of megabytes for a package as long-lived as `next`. Freshness needs
// one string, so the version document is the right request. It must NOT carry the abbreviated-packument
// accept type: that media type is defined only for the packument root, and the registry answers 406 for
// it here - inconsistently, because the CDN serves whichever representation it already holds.
const REGISTRY_ATTEMPTS: number = 3

const versionDocumentUrl = (name: string): string =>
  `https://registry.npmjs.org/${encodeURIComponent(name).replace('%40', '@')}/latest`

/**
 * What the registry was able to tell us about a package. The three cases are not interchangeable:
 * `absent` is an answer (this name is not on the public registry, so freshness is not a measurable
 * property of it), whereas `unreachable` is the absence of an answer and must never be read as a pass.
 */
type Lookup =
  | { readonly kind: 'version'; readonly version: string }
  | { readonly kind: 'absent' }
  | { readonly kind: 'unreachable' }

const parseLicenseInventory = (
  output: string,
): Record<string, readonly PnpmLicenseEntry[]> | undefined => {
  try {
    return JSON.parse(output) as Record<string, readonly PnpmLicenseEntry[]>
  } catch {
    return undefined
  }
}

// A deadline on every attempt, not on the lookup as a whole. A registry that accepts the connection and
// then says nothing is the failure this catches, and it is the one an unbounded `fetch` waits out
// forever: `REGISTRY_ATTEMPTS` retries an inconclusive attempt, but an attempt that never concludes is
// never retried either. Three bounded attempts fail in a knowable time; one unbounded attempt does not
// fail at all.
/** One registry attempt: an answer, or undefined when the attempt was inconclusive and may be retried. */
const fetchOrUndefined = async (name: string): Promise<Response | undefined> => {
  try {
    return await fetch(versionDocumentUrl(name), {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch {
    return undefined
  }
}

const attemptLookup = async (name: string): Promise<Lookup | undefined> => {
  const response: Response | undefined = await fetchOrUndefined(name)
  if (response === undefined) {
    return undefined
  }
  if (response.ok) {
    const body: unknown = await response.json()
    const version: unknown = asRecord(body)['version']
    return typeof version === 'string' ? { kind: 'version', version } : { kind: 'absent' }
  }
  // A 404 is a real answer, and retrying cannot change it.
  return response.status === NOT_FOUND ? { kind: 'absent' } : undefined
}

const latestVersion = async (
  name: string,
  attemptsLeft: number = REGISTRY_ATTEMPTS,
): Promise<Lookup> => {
  if (attemptsLeft <= 0) {
    return { kind: 'unreachable' }
  }
  const lookup: Lookup | undefined = await attemptLookup(name)
  return lookup ?? (await latestVersion(name, attemptsLeft - 1))
}

/** The three ways a registry lookup can land, kept apart so the report can speak about each. */
interface Sorted {
  readonly statuses: readonly DependencyStatus[]
  readonly unreachable: readonly string[]
  readonly unpublished: readonly string[]
}

const sortLookups = (
  coordinates: readonly DeclaredCoordinate[],
  lookups: ReadonlyMap<string, Lookup>,
): Sorted => {
  const namesWhere = (kind: Lookup['kind']): readonly string[] =>
    [...lookups]
      .filter(([, lookup]: readonly [string, Lookup]): boolean => lookup.kind === kind)
      .map(([name]: readonly [string, Lookup]): string => name)
  const statuses: readonly DependencyStatus[] = coordinates.flatMap(
    (coordinate: DeclaredCoordinate): readonly DependencyStatus[] => {
      const lookup: Lookup | undefined = lookups.get(coordinate.name)
      if (lookup?.kind !== 'version') {
        return []
      }
      return [{ ...coordinate, latest: lookup.version }]
    },
  )
  return {
    statuses,
    unreachable: namesWhere('unreachable'),
    unpublished: namesWhere('absent'),
  }
}

// The version document carries no publication date, and the packument root that does costs tens of
// megabytes for a package as long-lived as `next`. The search document is a kilobyte and names the
// latest version beside its date, which is the only affordable answer to "how old is this release".
// It is asked ONLY for a coordinate the report already names - a handful, not every dependency - and
// every miss is silent: search matches by relevance rather than exactly, so a document naming another
// package or another version answers nothing, and an unknown date reports the update the ordinary way.
const searchDocumentUrl = (name: string): string =>
  `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(name)}&size=1`

const publishedAt = async (name: string, version: string): Promise<number | undefined> => {
  try {
    const response: Response = await fetch(searchDocumentUrl(name), {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!response.ok) {
      return undefined
    }
    const objects: unknown = asRecord(await response.json())['objects']
    const first: unknown = isArray(objects) ? objects[0] : undefined
    const found: Record<string, unknown> = asRecord(asRecord(first)['package'])
    if (found['name'] !== name || found['version'] !== version) {
      return undefined
    }
    const date: unknown = found['date']
    const parsed: number = typeof date === 'string' ? Date.parse(date) : Number.NaN
    return Number.isNaN(parsed) ? undefined : parsed
  } catch {
    return undefined
  }
}

// The manifest leads the line because it is what the reader has to open. The standard asks the update
// report to name it for every coordinate, and a workspace pinning one analyzer in two places is exactly
// the case where the bare package name says nothing about where to make the change.
const describeFinding = (finding: FreshnessFinding): string =>
  `${finding.owner} ${finding.name}: declared ${finding.current}, latest ${finding.latest}`

// A line names its repair, and for an inherited coordinate that is not the repair every other line
// names. The project cannot edit a version ploaness declares, so "change the declaration" would be
// advice it has no file to act on; upgrading the harness is the move, and reporting it is the move when
// no release carries the newer pin yet. The same answer `HARNESS_EXCEPTIONS` gives for an advisory
// carried by ploaness's own chain.
const HARNESS_REPAIR: string =
  ' - declared by ploaness rather than by the project, so upgrade ploaness, or report it if no ' +
  'release carries the newer pin'

// A shorter marker than HARNESS_REPAIR, because it appears on every inherited update rather than on
// the rare overdue one, and it answers a different question: `stale` has to say what to DO, while an
// ordinary update only has to say whose declaration it is. A consuming project reported these rows as
// noise, and it was reading correctly - they named a manifest under `@ploaness/` and nothing said that
// naming meant "not yours to change".
const HARNESS_OWNED: string = ' - ploaness declares this, not the project'

// Read from `isInherited` rather than from the verdict. Only an inherited coordinate can reach these
// lines with a `fail`, because a project's own failure stops the build instead - so the two were
// equivalent, and stating the one that is actually meant is what keeps them equivalent.
const ownerNote = (finding: FreshnessFinding, note: string): string =>
  finding.isInherited ? note : ''

// `stale`, not `update`, for a coordinate past the bound that does not stop this build. Printed as an
// ordinary update it would bury the one line saying the harness itself is overdue among a dozen saying
// a patch release exists.
const describeReported = (finding: FreshnessFinding): string =>
  finding.verdict === 'fail'
    ? `stale ${describeFinding(finding)}; past the freshness bound` +
      ownerNote(finding, HARNESS_REPAIR)
    : `update ${describeFinding(finding)}${ownerNote(finding, HARNESS_OWNED)}`

// `held`, not `update`, for a release pnpm will refuse for being too young. Naming it as an ordinary
// update sends the reader to an install that fails, and the way past that failure is an exclusion from
// the very guard the wait exists to keep. It says the age so the reader can see how short the wait is.
const describeHeld = (finding: FreshnessFinding, hours: number | undefined): string => {
  const age: string = hours === undefined ? 'recently' : `${String(hours)}h ago`
  return (
    `held ${finding.owner} ${finding.name}: latest ${finding.latest}, published ${age}; below the ` +
    `${String(RELEASE_AGE_FLOOR_HOURS)}h release-age floor pnpm enforces, so it installs once it ages`
  )
}

// A date is asked for only where it can change the line: a coordinate already past the bound is stale
// whatever its age, and one this project cannot edit is reported to a different address entirely.
const isHeldCandidate = (finding: FreshnessFinding): boolean =>
  finding.verdict === 'update' && !finding.isInherited

// The project's own rows first, then the harness's. Interleaved, a reader scanning for what they can
// act on had to check the owner of every line; grouped, the actionable half is the top of the list.
// Stable within each half, so the order a run reports twice is the same order.
const projectRowsFirst = (reported: readonly FreshnessFinding[]): readonly FreshnessFinding[] => [
  ...reported.filter((finding: FreshnessFinding): boolean => !finding.isInherited),
  ...reported.filter((finding: FreshnessFinding): boolean => finding.isInherited),
]

const describeUpdates = async (
  reported: readonly FreshnessFinding[],
  now: number,
): Promise<readonly string[]> =>
  await mapWithConcurrency(
    projectRowsFirst(reported),
    REGISTRY_CONCURRENCY,
    async (finding: FreshnessFinding): Promise<string> => {
      if (!isHeldCandidate(finding)) {
        return describeReported(finding)
      }
      const age: ReleaseAge = {
        publishedAt: await publishedAt(finding.name, finding.latest),
        now,
      }
      return isHeldByReleaseAge(age)
        ? describeHeld(finding, hoursPublished(age))
        : describeReported(finding)
    },
  )

// One lookup per distinct name, fanned back out across the coordinates that share it. A workspace
// declaring the same analyzer in three manifests must not ask the registry three times.
//
// Windowed rather than all at once. `Promise.all` over the distinct names opened a socket per dependency
// - several hundred on a real workspace - which is what a public registry rate-limits and what a
// corporate proxy drops. Both arrive here as `unreachable`, so the gate blamed the network for a load
// the harness itself had generated.
const lookUpEach = async (names: readonly string[]): Promise<ReadonlyMap<string, Lookup>> =>
  new Map(
    await mapWithConcurrency(
      names,
      REGISTRY_CONCURRENCY,
      async (name: string): Promise<readonly [string, Lookup]> => {
        try {
          return [name, await latestVersion(name)]
        } catch {
          return [name, { kind: 'unreachable' }]
        }
      },
    ),
  )

/**
 * Fail when a declared dependency is two or more majors behind its latest release; report any lesser
 * lag as an available update. This gate is fail-closed: it cannot prove freshness
 * without the registry, so it fails rather than passing silently. A dependency the registry does not
 * publish at all - a private or workspace-linked package - is reported rather than judged, because a
 * public "latest" it has no claim to would be a fabricated comparison.
 */
// The images the harness pins are versioned inputs like the coordinates are, and they are read first so
// a registry that cannot answer fails before the longer npm fan-out runs. An image never fails for being
// behind; it fails only where the guideline says a freshness check does, which is when nothing can
// establish what is current.
const imagesUnprovable = (images: ImageReport): GateResult | undefined =>
  images.failure === undefined
    ? undefined
    : failed('image freshness cannot be proven', [
        images.failure,
        'this gate is fail-closed by design; retry with network access',
      ])

// The summary may not claim every coordinate is within the bound while the report below it lists one
// that is not. A harness pin past the bound does not stop this build, and a pass that said nothing about
// it would leave the only line that matters to be found by reading. The images are counted here too:
// they are versioned inputs the same rule covers, so a summary naming only coordinates would understate
// what the gate read.
const freshnessSummary = (
  statuses: readonly DependencyStatus[],
  manifests: readonly ManifestSource[],
  report: FreshnessReport,
  images: ImageReport,
): string => {
  const inherited: number = manifests.filter(
    (manifest: ManifestSource): boolean => manifest.isInherited,
  ).length
  const overdue: number = report.reported.filter(
    (finding: FreshnessFinding): boolean => finding.verdict === 'fail',
  ).length
  const counted: string =
    `${String(statuses.length)} declared coordinate(s) across ${String(manifests.length)} ` +
    `manifest(s), ${String(inherited)} inherited, and ${String(images.scanned)} pinned image(s)`
  return overdue > 0
    ? `${counted}; ${String(overdue)} inherited coordinate(s) past the bound, reported not failed`
    : `${counted}, are within the freshness bound`
}

export const dependencyFreshness = async (context: Context): Promise<GateResult> => {
  const images: ImageReport = await imageFreshness()
  const unprovable: GateResult | undefined = imagesUnprovable(images)
  if (unprovable !== undefined) {
    return unprovable
  }
  const manifests: readonly ManifestSource[] = manifestSources(context)
  const coordinates: readonly DeclaredCoordinate[] = collectCoordinates(manifests)
  const names: readonly string[] = [
    ...new Set(coordinates.map((coordinate: DeclaredCoordinate): string => coordinate.name)),
  ]
  const { statuses, unreachable, unpublished }: Sorted = sortLookups(
    coordinates,
    await lookUpEach(names),
  )
  if (unreachable.length > 0) {
    return failed('the npm registry was unreachable, so freshness cannot be proven', [
      `no "latest" resolved for: ${unreachable.slice(0, MAX_LISTED_NAMES).join(', ')}`,
      // Stated so a reader can tell a registry that refused from one that never answered. Both land
      // here, and only the second is worth investigating as a proxy or firewall rather than as an
      // outage - which is unreadable from a message that says only "unreachable".
      `each of ${String(REGISTRY_ATTEMPTS)} attempt(s) was given ${String(REQUEST_TIMEOUT_MS)}ms, so ` +
        'a name listed above was either refused or never answered within that bound',
      'this gate is fail-closed by design; retry with network access',
    ])
  }
  const notes: readonly string[] = unpublished.map(
    (name: string): string =>
      `note ${name} is not on the public registry, so freshness is not measurable`,
  )
  const report: FreshnessReport = findFreshnessViolations(statuses)
  if (report.failures.length > 0) {
    return failed(
      `${String(report.failures.length)} dependency/dependencies are two or more majors behind`,
      [
        ...report.failures.map((finding: FreshnessFinding): string => describeFinding(finding)),
        ...(await describeUpdates(report.reported, Date.now())),
        ...images.lines,
        ...notes,
      ],
    )
  }
  return passed(freshnessSummary(statuses, manifests, report, images), [
    ...(await describeUpdates(report.reported, Date.now())),
    ...images.lines,
    ...notes,
  ])
}

// The npm-v6 audit shape `pnpm audit --json` emits: advisories keyed by id, each carrying the module,
// the severity, the advisory URL, and the alternative identifiers it is also known by.
// Read as an untyped record rather than a named interface: these keys are npm's own vocabulary, not
// names this codebase chose, and declaring them as properties would ask the naming rule to bless a
// foreign convention.
type AuditAdvisory = Record<string, unknown>

const asStrings = (raw: unknown): readonly string[] =>
  isArray(raw) ? raw.filter((entry: unknown): entry is string => typeof entry === 'string') : []

const textAt = (raw: AuditAdvisory, key: string, fallback: string): string => {
  const found: string = asText(raw[key])
  return found.length > 0 ? found : fallback
}

const asAdvisory = (key: string, raw: AuditAdvisory): Advisory => ({
  id: textAt(raw, 'github_advisory_id', key),
  packageName: textAt(raw, 'module_name', 'unknown'),
  // An advisory whose severity the record does not carry is read as the most severe, not the least.
  // Defaulting to `info` put it below the threshold, so a malformed record was silently a pass inside a
  // gate that is fail-closed everywhere else.
  severity: textAt(raw, 'severity', 'unknown'),
  title: textAt(raw, 'title', 'no title reported'),
  aliases: asStrings(raw['cves']),
})

// `pnpm audit` exits non-zero whenever it finds anything, so the exit code carries no information the
// JSON does not. The verdict comes from the payload; only an unparseable payload means the database was
// unreachable, and that is a failure like any other - a check that cannot run is a fail.
const parseAudit = (output: string): readonly Advisory[] | undefined => {
  try {
    const parsed: unknown = JSON.parse(output)
    if (!(isRecord(parsed) && isRecord(parsed['metadata']))) {
      return undefined
    }
    return Object.entries(asRecord(parsed['advisories'])).map(
      ([key, raw]: readonly [string, unknown]): Advisory => asAdvisory(key, asRecord(raw)),
    )
  } catch {
    return undefined
  }
}

/**
 * Read every package in the resolved set against the public advisory database.
 * @param context the resolved project environment.
 * @returns a failure for any finding at or above the declared severity, or for a stale exception.
 */
export const vulnerabilities = (context: Context): GateResult => {
  // No `--prod` filter: the standard is explicit that build and test packages count, because a build
  // tool runs with build privileges and its vulnerability is reachable by anyone who can change the repo.
  // Deadlined because it asks the advisory database over the network. Without one, a registry that
  // accepts the connection and stalls holds the whole verification open with nothing printed.
  const result: RunResult = run('pnpm', ['audit', '--json'], {
    cwd: context.root,
    timeoutMs: NETWORKED_TOOL_TIMEOUT_MS,
  })
  // `stdout` for the reason the licence gate reads it: a pnpm warning on stderr used to be concatenated
  // into the payload and reported as the advisory database being unreachable.
  const advisories: readonly Advisory[] | undefined = parseAudit(result.stdout)
  if (advisories === undefined) {
    return failed('the advisory database was unreachable, so vulnerabilities cannot be proven', [
      ...(result.code === TIMED_OUT_CODE
        ? [`the audit did not answer within ${String(NETWORKED_TOOL_TIMEOUT_MS)}ms and was stopped`]
        : []),
      result.output.split('\n').slice(0, MAX_REPORTED_LINES).join('\n'),
      'this gate is fail-closed by design; retry with network access',
    ])
  }
  const report: VulnerabilityReport = judgeVulnerabilities(
    advisories,
    context.settings.vulnerabilityAllowlist,
    context.settings.vulnerabilitySeverity,
    HARNESS_EXCEPTIONS,
  )
  const findings: readonly string[] = [
    ...report.unsuppressed.map(
      (advisory: Advisory): string =>
        `${advisory.severity} ${advisory.id} in ${advisory.packageName}: ${advisory.title}`,
    ),
    ...report.deadEntries,
  ]
  // The evidence is the audit pnpm printed, kept whatever the verdict. A gate that reaches its verdict
  // by PARSING a tool rather than by its exit status is exactly the one a reader wants to audit, and
  // dropping the transcript here would leave `--verbose` answering "no output" on the gate that most
  // needs an answer.
  return withOutput(
    findings.length > 0
      ? failed(
          `${String(findings.length)} vulnerability finding(s) at or above ${report.threshold}`,
          findings,
        )
      : passed(
          `no vulnerability at or above ${report.threshold} across ${String(advisories.length)} advisory record(s)`,
        ),
    result.stdout,
  )
}
