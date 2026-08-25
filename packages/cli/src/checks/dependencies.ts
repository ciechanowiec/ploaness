// Dependency gates. A license is a fixed fact of a package version, so it changes state only when you add
// or upgrade something: a true signal about your change. Freshness is bounded rather than banned, because
// "a newer version exists" is not a property of your change, but "the version I declared is two majors
// behind" is, and that is a real liability.
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
  isArray,
  isRecord,
  judgeVulnerabilities,
  type LicensedPackage,
  type ManifestSource,
  type VulnerabilityReport,
} from '@ploaness/governance'
import { type Context, readJson, trackedFiles } from '../context.js'
import { failed, type GateResult, passed, type RunResult, run } from '../exec.js'

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
  const grouped: Record<string, readonly PnpmLicenseEntry[]> | undefined = parseLicenseInventory(
    result.output,
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
  return violations.length > 0
    ? failed(
        `${String(violations.length)} dependency license(s) outside policy`,
        violations.map((entry: LicensedPackage): string => `${entry.name}: ${entry.license}`),
      )
    : passed(`all ${String(packages.length)} dependency licenses are within policy`)
}

const MANIFEST_NAME: string = 'package.json'

// Every manifest the repository tracks, not only the root one. A workspace declares its toolchain across
// several of them, and reading the root alone left every analyzer ploaness itself runs on unmeasured.
// Git tracks nothing under node_modules, so the tracked list is already the right set.
const manifestSources = (context: Context): readonly ManifestSource[] =>
  trackedFiles(context.root)
    .filter((file: string): boolean => file === MANIFEST_NAME || file.endsWith(`/${MANIFEST_NAME}`))
    .map(
      (file: string): ManifestSource => ({
        path: file,
        packageJson: readJson(path.join(context.root, file)),
      }),
    )

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

/** One registry attempt: an answer, or undefined when the attempt was inconclusive and may be retried. */
const fetchOrUndefined = async (name: string): Promise<Response | undefined> => {
  try {
    return await fetch(versionDocumentUrl(name), { headers: { accept: 'application/json' } })
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

// The manifest leads the line because it is what the reader has to open. The standard asks the update
// report to name it for every coordinate, and a workspace pinning one analyzer in two places is exactly
// the case where the bare package name says nothing about where to make the change.
const describeFinding = (finding: FreshnessFinding): string =>
  `${finding.owner} ${finding.name}: declared ${finding.current}, latest ${finding.latest}`

// One lookup per distinct name, fanned back out across the coordinates that share it. A workspace
// declaring the same analyzer in three manifests must not ask the registry three times.
const lookUpEach = async (names: readonly string[]): Promise<ReadonlyMap<string, Lookup>> =>
  new Map(
    await Promise.all(
      names.map(async (name: string): Promise<readonly [string, Lookup]> => {
        try {
          return [name, await latestVersion(name)]
        } catch {
          return [name, { kind: 'unreachable' }]
        }
      }),
    ),
  )

/**
 * Fail when a declared dependency is two or more majors behind its latest release; warn on any lesser
 * lag. This is the one gate that needs the network, and it is fail-closed: it cannot prove freshness
 * without the registry, so it fails rather than passing silently. A dependency the registry does not
 * publish at all - a private or workspace-linked package - is reported rather than judged, because a
 * public "latest" it has no claim to would be a fabricated comparison.
 */
export const dependencyFreshness = async (context: Context): Promise<GateResult> => {
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
        ...report.warnings.map(
          (finding: FreshnessFinding): string => `warning ${describeFinding(finding)}`,
        ),
        ...notes,
      ],
    )
  }
  return passed(
    `${String(statuses.length)} declared coordinate(s) across ${String(manifests.length)} ` +
      `manifest(s) are within the freshness bound`,
    [
      ...report.warnings.map(
        (finding: FreshnessFinding): string => `warning ${describeFinding(finding)}`,
      ),
      ...notes,
    ],
  )
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
  severity: textAt(raw, 'severity', 'info'),
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
  const result: RunResult = run('pnpm', ['audit', '--json'], { cwd: context.root })
  const advisories: readonly Advisory[] | undefined = parseAudit(result.output)
  if (advisories === undefined) {
    return failed('the advisory database was unreachable, so vulnerabilities cannot be proven', [
      result.output.split('\n').slice(0, MAX_REPORTED_LINES).join('\n'),
      'this gate is fail-closed by design; retry with network access',
    ])
  }
  const report: VulnerabilityReport = judgeVulnerabilities(
    advisories,
    context.settings.vulnerabilityAllowlist,
    context.settings.vulnerabilitySeverity,
  )
  const findings: readonly string[] = [
    ...report.unsuppressed.map(
      (advisory: Advisory): string =>
        `${advisory.severity} ${advisory.id} in ${advisory.packageName}: ${advisory.title}`,
    ),
    ...report.deadEntries,
  ]
  return findings.length > 0
    ? failed(
        `${String(findings.length)} vulnerability finding(s) at or above ${report.threshold}`,
        findings,
      )
    : passed(
        `no vulnerability at or above ${report.threshold} across ${String(advisories.length)} advisory record(s)`,
      )
}
