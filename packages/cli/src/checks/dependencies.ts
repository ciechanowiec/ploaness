// Dependency gates. A license is a fixed fact of a package version, so it changes state only when you add
// or upgrade something: a true signal about your change. Freshness is bounded rather than banned, because
// "a newer version exists" is not a property of your change, but "the version I declared is two majors
// behind" is, and that is a real liability.
import {
  type DependencyStatus,
  type FreshnessFinding,
  type FreshnessReport,
  findFreshnessViolations,
  findLicenseViolations,
  type LicensedPackage,
} from '@ploaness/governance'
import type { Context } from '../context.js'
import { failed, type GateResult, passed, type RunResult, run } from '../exec.js'

interface PnpmLicenseEntry {
  readonly name: string
  readonly license: string
}

/** Every dependency license must sit inside the allowlist. */
export const licenses = (context: Context): GateResult => {
  const result: RunResult = run('pnpm', ['licenses', 'list', '--json'], { cwd: context.root })
  if (result.code !== 0) {
    return failed('the license inventory could not be produced', [result.output])
  }
  let grouped: Record<string, readonly PnpmLicenseEntry[]>
  try {
    grouped = JSON.parse(result.output) as Record<string, readonly PnpmLicenseEntry[]>
  } catch {
    return failed('the license inventory was not valid JSON', [result.output.slice(0, 2000)])
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
        `${violations.length} dependency license(s) outside policy`,
        violations.map((entry: LicensedPackage): string => `${entry.name}: ${entry.license}`),
      )
    : passed(`all ${packages.length} dependency licenses are within policy`)
}

const asRecord = (raw: unknown): Record<string, unknown> =>
  typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}

const declaredDependencies = (packageJson: unknown): Record<string, string> => {
  const root: Record<string, unknown> = asRecord(packageJson)
  const merged: Record<string, unknown> = {
    ...asRecord(root['dependencies']),
    ...asRecord(root['devDependencies']),
  }
  const result: Record<string, string> = {}
  for (const [name, version] of Object.entries(merged)) {
    if (typeof version === 'string') {
      result[name] = version
    }
  }
  return result
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

/** One registry attempt: an answer, or undefined when the attempt was inconclusive and may be retried. */
const attemptLookup = async (name: string): Promise<Lookup | undefined> => {
  let response: Response
  try {
    response = await fetch(versionDocumentUrl(name), { headers: { accept: 'application/json' } })
  } catch {
    return undefined
  }
  if (response.ok) {
    const body: unknown = await response.json()
    const version: unknown = asRecord(body)['version']
    return typeof version === 'string' ? { kind: 'version', version } : { kind: 'absent' }
  }
  // A 404 is a real answer, and retrying cannot change it.
  return response.status === 404 ? { kind: 'absent' } : undefined
}

const latestVersion = async (name: string): Promise<Lookup> => {
  for (let attempt: number = 1; attempt <= REGISTRY_ATTEMPTS; attempt += 1) {
    const lookup: Lookup | undefined = await attemptLookup(name)
    if (lookup !== undefined) {
      return lookup
    }
  }
  return { kind: 'unreachable' }
}

/** The three ways a registry lookup can land, kept apart so the report can speak about each. */
interface Sorted {
  readonly statuses: readonly DependencyStatus[]
  readonly unreachable: readonly string[]
  readonly unpublished: readonly string[]
}

const sortLookups = (
  declared: Record<string, string>,
  results: readonly (readonly [string, Lookup])[],
): Sorted => {
  const statuses: DependencyStatus[] = []
  const unreachable: string[] = []
  const unpublished: string[] = []
  for (const [name, lookup] of results) {
    if (lookup.kind === 'unreachable') {
      unreachable.push(name)
    } else if (lookup.kind === 'absent') {
      unpublished.push(name)
    } else {
      statuses.push({
        name,
        owner: 'package.json',
        current: declared[name] ?? '',
        latest: lookup.version,
      })
    }
  }
  return { statuses, unreachable, unpublished }
}

/**
 * Fail when a declared dependency is two or more majors behind its latest release; warn on any lesser
 * lag. This is the one gate that needs the network, and it is fail-closed: it cannot prove freshness
 * without the registry, so it fails rather than passing silently. A dependency the registry does not
 * publish at all - a private or workspace-linked package - is reported rather than judged, because a
 * public "latest" it has no claim to would be a fabricated comparison.
 */
export const dependencyFreshness = async (context: Context): Promise<GateResult> => {
  const declared: Record<string, string> = declaredDependencies(context.packageJson)
  const names: readonly string[] = Object.keys(declared)
  const results: readonly (readonly [string, Lookup])[] = await Promise.all(
    names.map(async (name: string): Promise<readonly [string, Lookup]> => {
      try {
        return [name, await latestVersion(name)]
      } catch {
        return [name, { kind: 'unreachable' }]
      }
    }),
  )
  const { statuses, unreachable, unpublished }: Sorted = sortLookups(declared, results)
  if (unreachable.length > 0) {
    return failed('the npm registry was unreachable, so freshness cannot be proven', [
      `no "latest" resolved for: ${unreachable.slice(0, 10).join(', ')}`,
      'this gate is fail-closed by design; retry with network access',
    ])
  }
  const notes: readonly string[] = unpublished.map(
    (name: string): string =>
      `note ${name} is not on the public registry, so freshness is not measurable`,
  )
  const report: FreshnessReport = findFreshnessViolations(statuses)
  const describe = (finding: FreshnessFinding): string =>
    `${finding.name}: declared ${finding.current}, latest ${finding.latest}`
  if (report.failures.length > 0) {
    return failed(
      `${report.failures.length} dependency/dependencies are two or more majors behind`,
      [
        ...report.failures.map(describe),
        ...report.warnings.map(
          (finding: FreshnessFinding): string => `warning ${describe(finding)}`,
        ),
        ...notes,
      ],
    )
  }
  return passed(`${statuses.length} declared dependencies are within the freshness bound`, [
    ...report.warnings.map((finding: FreshnessFinding): string => `warning ${describe(finding)}`),
    ...notes,
  ])
}
