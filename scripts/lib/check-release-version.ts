// One version, and every place this repository writes it down.
//
// The packages are published together and pin each other at an EXACT version, because
// `workspace:*` does not resolve when a package is installed from a tarball outside its workspace -
// which is how `it/` verifies the harness before it is published. That exactness is what makes a
// release safe and what makes a bump dangerous: nothing derives those numbers from a single value,
// so the version is written down once per manifest, once per cross-reference, twice in the fixture
// and once in the guide. A release that publishes with two of them disagreeing produces packages that
// install and then fail to resolve.
//
// So the joint is checked rather than the value. `packages/ploaness` is the version a consumer installs,
// so it is the site every other one is measured against.
//
// This file also checks WHICH packages, not only which version, and it does so because the comment
// that used to sit here gave up on exactly that: it declined to state a count "because a sixth package
// changed it and no check reads this comment". The sixth package had by then been missed twice. The
// release workflow published five of six, so a release would have shipped every package that pins
// `@ploaness/runtime` and never runtime itself; and knip's workspace list omitted it, so that package
// was never analysed at all. Both lists are hand-written, both were correct when written, and nothing
// compared either against the tree. A roster is checked here for the same reason a version is.
import { type Dirent, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { asRecord, declaredDependencies } from '@ploaness/governance'

const workspaceRoot: string = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

/** The meta package, whose version IS the release version: it is the name a consumer installs. */
const META_PACKAGE: string = 'ploaness'
const HARNESS_SCOPE: string = '@ploaness/'

interface Manifest {
  readonly file: string
  readonly name: string
  readonly version: string
  readonly dependencies: Readonly<Record<string, string>>
}

const readText = (file: string): string => readFileSync(path.join(workspaceRoot, file), 'utf8')

const readJson = (file: string): Record<string, unknown> => asRecord(JSON.parse(readText(file)))

// Discovered from the tree rather than enumerated, for the reason `pack-local.sh` globs: a hard-coded
// list of five is a sixth package away from checking a version nobody bumped and reporting agreement.
const readManifests = (): readonly Manifest[] =>
  readdirSync(path.join(workspaceRoot, 'packages'), { withFileTypes: true })
    .filter((entry: Dirent): boolean => entry.isDirectory())
    .map((entry: Dirent): Manifest => {
      const file: string = path.posix.join('packages', entry.name, 'package.json')
      const json: Record<string, unknown> = readJson(file)
      return {
        file,
        name: String(json['name']),
        version: String(json['version']),
        dependencies: declaredDependencies(json),
      }
    })

const isHarnessPackage = (name: string): boolean =>
  name === META_PACKAGE || name.startsWith(HARNESS_SCOPE)

// A sibling declared at anything but the release version. `workspace:*` is among what this rejects and
// that is not an oversight: a published tarball carrying that protocol resolves for nobody.
const crossReferenceFindings = (manifest: Manifest, release: string): readonly string[] =>
  Object.entries(manifest.dependencies)
    .filter(([name]: readonly [string, string]): boolean => isHarnessPackage(name))
    .filter(([, declared]: readonly [string, string]): boolean => declared !== release)
    .map(
      ([name, declared]: readonly [string, string]): string =>
        `${manifest.file} declares ${name} at "${declared}", not "${release}"`,
    )

const manifestFindings = (manifests: readonly Manifest[], release: string): readonly string[] =>
  manifests.flatMap((manifest: Manifest): readonly string[] => [
    ...(manifest.version === release
      ? []
      : [`${manifest.file} is version "${manifest.version}", not "${release}"`]),
    ...crossReferenceFindings(manifest, release),
  ])

// The fixture installs the packed tarballs BY FILENAME, so its overrides carry the version too. A bump
// that misses them fails `pnpm run it` at install time, reporting a missing file rather than a stale
// number - which is the failure hardest to read from its own message.
// Anchored on the separator before the version rather than on the package name: a `[a-z-]+-` prefix
// beside a second quantifier is ambiguous about where the name ends, which backtracks.
const TARBALL: RegExp = /-(\d[^/\s"']*)\.tgz/g

const fixtureFindings = (release: string): readonly string[] => {
  const manifestFile: string = 'it/project/package.json'
  const declared: string | undefined = declaredDependencies(readJson(manifestFile))[META_PACKAGE]
  const workspaceFile: string = 'it/project/pnpm-workspace.yaml'
  const overrides: string = readText(workspaceFile)
  return [
    ...(declared === release
      ? []
      : [`${manifestFile} declares ${META_PACKAGE} at "${String(declared)}", not "${release}"`]),
    ...[...overrides.matchAll(TARBALL)]
      .filter((match: RegExpExecArray): boolean => match[1] !== release)
      .map(
        (match: RegExpExecArray): string =>
          `${workspaceFile} names a tarball for version "${String(match[1])}", not "${release}"`,
      ),
  ]
}

// The user guide renders its install snippet from this attribute, so a stale value tells every reader to
// install a version that is not the one being released.
const GUIDE_ATTRIBUTE: RegExp = /^:ploaness-version:\s*(\S+)$/m

const guideFindings = (release: string): readonly string[] => {
  const file: string = 'README.adoc'
  const declared: string | undefined = GUIDE_ATTRIBUTE.exec(readText(file))?.[1]
  return declared === release
    ? []
    : [`${file} sets :ploaness-version: to "${String(declared)}", not "${release}"`]
}

// What `npm pack` names a package's tarball, which is the form the publish list is written in: the
// scope becomes a prefix. Derived rather than listed, so a seventh package needs no edit here.
const tarballName = (packageName: string): string =>
  packageName.startsWith(HARNESS_SCOPE)
    ? `ploaness-${packageName.slice(HARNESS_SCOPE.length)}`
    : packageName

// One roster, and what it is missing. Reported in both directions: a package the list has forgotten is
// the defect this was written for, and a name no package answers to is a list left behind by a rename,
// which would fail the release at the tarball that does not exist.
const rosterFindings = (
  file: string,
  listed: readonly string[],
  expected: readonly string[],
  subject: string,
): readonly string[] => [
  ...expected
    .filter((name: string): boolean => !listed.includes(name))
    .map((name: string): string => `${file} does not ${subject} ${name}`),
  ...listed
    .filter((name: string): boolean => !expected.includes(name))
    .map((name: string): string => `${file} names ${name}, which is no package of this workspace`),
]

// The publish order, as the workflow writes it. Matched on the assignment rather than parsed as YAML,
// because the value is a shell string inside a `run:` block and a YAML reader would hand back the whole
// script. A workflow that no longer carries the assignment is a finding rather than a silent pass.
// Indented with spaces and tabs rather than `\s`, which matches a newline: under the multiline flag
// that lets the leading run cross lines and backtrack, which is the same hazard `TARBALL` above is
// anchored to avoid.
const PUBLISH_ORDER: RegExp = /^[ \t]*PUBLISH_ORDER: '([^']*)'/m

const workflowFindings = (manifests: readonly Manifest[]): readonly string[] => {
  const file: string = '.github/workflows/release.yaml'
  const order: string | undefined = PUBLISH_ORDER.exec(readText(file))?.[1]
  if (order === undefined) {
    return [`${file} carries no publish order to check`]
  }
  return rosterFindings(
    file,
    order.split(/\s+/).filter((name: string): boolean => name.length > 0),
    manifests.map((manifest: Manifest): string => tarballName(manifest.name)),
    'publish',
  )
}

// knip is run against this repository with that configuration, so a package absent from its workspaces
// is a package no dead-code analysis has ever read.
const knipFindings = (manifests: readonly Manifest[]): readonly string[] => {
  const file: string = 'packages/config/knip-repo.json'
  const workspaces: Record<string, unknown> = asRecord(readJson(file)['workspaces'])
  return rosterFindings(
    file,
    Object.keys(workspaces).filter((name: string): boolean => name.startsWith('packages/')),
    manifests.map((manifest: Manifest): string => path.posix.dirname(manifest.file)),
    'analyse',
  )
}

const manifests: readonly Manifest[] = readManifests()
const meta: Manifest | undefined = manifests.find(
  (manifest: Manifest): boolean => manifest.name === META_PACKAGE,
)
if (meta === undefined) {
  throw new Error(`no package named "${META_PACKAGE}" under packages/`)
}

const release: string = meta.version
const versionFindings: readonly string[] = [
  ...manifestFindings(manifests, release),
  ...fixtureFindings(release),
  ...guideFindings(release),
]

if (versionFindings.length > 0) {
  throw new Error(
    `the release version is written inconsistently:\n  ${versionFindings.join('\n  ')}\n` +
      `every site above must read "${release}", which is what packages/ploaness declares`,
  )
}

// Reported after the versions rather than beside them, because the two answer different questions and a
// reader repairing one is not repairing the other.
const rosterViolations: readonly string[] = [
  ...workflowFindings(manifests),
  ...knipFindings(manifests),
]

if (rosterViolations.length > 0) {
  throw new Error(
    `a package roster disagrees with the packages that exist:\n  ${rosterViolations.join('\n  ')}\n` +
      'every package under packages/ is published and analysed, or it is neither',
  )
}

console.info(
  `release: ${String(manifests.length)} packages agree on "${release}", and each is named by the ` +
    'publish order and the knip workspaces',
)
