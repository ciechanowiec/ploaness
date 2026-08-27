// The anti-bypass gate. Reads the consumer's own files and fails when ploaness has been disarmed. The
// rules are pure and live in @ploaness/governance; this file supplies the I/O and the expectations.
import path from 'node:path'
import {
  asOptionalText,
  asRecord,
  asStringRecord,
  declaredDependencies,
  findPackageWiringViolations,
  findRepositoryWiringViolations,
  findServerUrlCollisions,
  findUngovernedProjects,
  hasRuntime,
  isArray,
  isRecord,
  type MemberKind,
  type MemberShape,
  memberKindOf,
  ROOT_MEMBER_PATH,
  readKey,
  requiredBiomeFiles,
  type WiringViolation,
} from '@ploaness/governance'
import {
  type Member,
  type Repository,
  readJson,
  readPins,
  readText,
  shippedDirectory,
} from '../context.js'
import { failed, type GateResult, passed } from '../exec.js'

// Libraries the consumer's own specs import. They cannot move into the harness: under the strict pnpm
// layout a consumer spec could not resolve `import { describe } from "vitest"` if vitest were only a
// dependency of ploaness. So the project declares them and ploaness pins the version.
// Only libraries a consumer's own specs IMPORT belong here. Under pnpm's strict layout a spec cannot
// resolve `vitest` unless the project declares it, so these cannot move into the harness and are pinned
// instead. A package the harness merely resolves for itself - the React plugin, for instance - must NOT
// appear: declaring it in the consumer would be an unused dependency, which the knip gate rightly fails.
// Every package whose version changes what a gate does. The standard pins the toolchain to an exact
// version so an upstream release cannot change a verdict while the project stays unchanged - and a
// caret range on any of these is exactly that. The expected version is read from ploaness's own
// manifests below, so there is no second literal to drift.
const TEST_LIBRARY_NAMES: readonly string[] = [
  'vitest',
  '@vitest/coverage-v8',
  'typescript',
  'jsdom',
  'fast-check',
  '@testing-library/react',
  '@testing-library/jest-dom',
  '@testing-library/user-event',
  '@playwright/test',
  '@axe-core/playwright',
  // The end-to-end gate injects `--import=tsx/esm`, so the project's tsx decides whether that gate can
  // start at all. ploaness depended on a package it neither required nor pinned until this was added.
  'tsx',
]

// Packages ploaness owns outright rather than merely measuring, and cannot declare as dependencies
// without installing a second copy into every consumer. `pins.json` is their single source. Nothing
// about a group is restated here - not its name, not which packages it holds, not whether it is
// required - because every one of those would be a second copy of what the file already contains,
// which is the drift the file exists to prevent. Adding a group needs no change in this file.
interface PinGroup {
  readonly requiredFor: readonly string[]
  readonly versions: Readonly<Record<string, string>>
}

const shippedFile = (packageName: string, fileName: string): string =>
  path.join(shippedDirectory(packageName), fileName)

const pinGroups = (): readonly PinGroup[] => {
  const groups: unknown = readPins()['groups']
  return isArray(groups)
    ? groups.flatMap((group: unknown): readonly PinGroup[] => {
        const record: Record<string, unknown> = asRecord(group)
        return isRecord(record['versions'])
          ? [
              {
                requiredFor: asStringArray(record['requiredFor']),
                versions: asStringRecord(record['versions']),
              },
            ]
          : []
      })
    : []
}

/** Every pinned version, whether the group that holds it is required or merely matched. */
const ownedVersions = (): Readonly<Record<string, string>> =>
  Object.assign({}, ...pinGroups().map((group: PinGroup): unknown => group.versions)) as Record<
    string,
    string
  >

// Where a pinned version is read from. The harness installs these itself, so its own manifests are the
// single source of the expectation and a harness bump moves it in exactly one place. Both packages are
// consulted because the split between them is an internal packaging detail: vitest is declared by the
// config package that presets it, the coverage provider by the CLI package that runs it. Reading only
// one would leave the other name in TEST_LIBRARY_NAMES pinning nothing at all, silently.
const asStringArray = (value: unknown): readonly string[] =>
  isArray(value) ? value.filter((entry: unknown): entry is string => typeof entry === 'string') : []

const VERSION_SOURCES: readonly string[] = ['@ploaness/config', '@ploaness/cli']

const declaredBy = (packageName: string): Record<string, unknown> => {
  const manifest: unknown = readJson(shippedFile(packageName, 'package.json'))
  return asRecord(readKey(manifest, 'dependencies'))
}

// The packages a project's specs import, so every project must declare them. The rest of the pinned set
// is matched when declared and never forced on a project that has no use for it. The two Playwright
// packages are here because ploaness now ships a spec that imports them: the managed accessibility
// sweep is not optional, so neither is resolving what it imports.

// A pin in a required group is what makes a project declare the package. A pin in any other group is
// matched when the project declares it and forced on nobody, which is how ploaness can own the version
// of a Postgres driver without deciding that every governed project uses Postgres.
// Only the packages this KIND of member must declare. A group names the kinds it applies to, so a
// shared library is not told to declare Payload - which would manufacture a dependency the dead-code
// gate then rightly reports as unused - and a frontend is not told to declare it either, which would
// make ploaness dictate an architecture rather than a version.
const requiredPackages = (kind: MemberKind): ReadonlySet<string> =>
  new Set<string>(
    pinGroups()
      .filter((group: PinGroup): boolean => group.requiredFor.includes(kind))
      .flatMap((group: PinGroup): readonly string[] => Object.keys(group.versions)),
  )

const expectedTestLibraries = (): Readonly<Record<string, string>> => {
  // Built from one flat list of entries rather than by folding an object into itself: a later source
  // still wins, because `fromEntries` keeps the last entry for a repeated key.
  const declared: Record<string, unknown> = Object.fromEntries(
    VERSION_SOURCES.flatMap((source: string): readonly (readonly [string, unknown])[] =>
      Object.entries(declaredBy(source)),
    ),
  )
  const fromDependencies: Record<string, string> = asStringRecord(
    Object.fromEntries(
      TEST_LIBRARY_NAMES.map((name: string): readonly [string, unknown] => [name, declared[name]]),
    ),
  )
  return { ...fromDependencies, ...ownedVersions() }
}

// A member's own required set. Only a member that serves an application needs the browser packages: a
// library has no page to sweep, and requiring them would manufacture dependencies the dead-code gate
// then rightly reports as unused.
const BROWSER_LIBRARIES: ReadonlySet<string> = new Set<string>([
  '@playwright/test',
  '@axe-core/playwright',
  'tsx',
])

// The specs of every governed package import these, so pnpm's strict layout means every package must
// declare them. The browser three are added only where there is an application to drive.
const SUITE_LIBRARIES: ReadonlySet<string> = new Set<string>([
  'vitest',
  '@vitest/coverage-v8',
  'typescript',
])

const requiredFor = (kind: MemberKind): ReadonlySet<string> =>
  new Set<string>([
    ...SUITE_LIBRARIES,
    ...(hasRuntime(kind) ? BROWSER_LIBRARIES : []),
    ...requiredPackages(kind),
  ])

const memberViolations = (member: Member): readonly WiringViolation[] => {
  const kind: MemberKind = memberKindOf(member.packageJson)
  return findPackageWiringViolations({
    packageJson: member.packageJson,
    kind,
    isNestedMember: member.path !== ROOT_MEMBER_PATH,
    nestedMembers: member.siblingPaths,
    requiredBiomeFiles: requiredBiomeFiles(
      member.settings.sourceRoots,
      kind,
      member.settings.generatedArtefacts,
    ),
    eslintConfig: readText(path.join(member.root, 'eslint.config.mjs')),
    vitestConfig: readText(path.join(member.root, 'vitest.config.mts')),
    playwrightConfig: readText(path.join(member.root, 'playwright.config.ts')),
    declaredExclusions: member.settings.declaredExclusions,
    biomeConfig: readText(path.join(member.root, 'biome.json')),
    tsconfig: readText(path.join(member.root, 'tsconfig.json')),
    expectedTestLibraries: expectedTestLibraries(),
    requiredTestLibraries: requiredFor(kind),
    payloadVersion: ownedVersions()['payload'],
  })
}

// A finding names the member it came from only when there is more than one, so a single-package project
// reads exactly the findings it always did.
const locate = (member: Member, isSolo: boolean, violation: WiringViolation): string =>
  isSolo
    ? `${violation.location}: ${violation.reason}`
    : `${member.path}/${violation.location}: ${violation.reason}`

const shapeOf = (member: Member): MemberShape => ({
  path: member.path,
  isPayload: member.isPayload,
  sourceRoots: member.settings.sourceRoots,
})

// The rules that need the member LIST rather than any one manifest. Both describe a way a workspace can
// be wrong that no single package can see: a project quietly left ungoverned, and two applications that
// would drive the same origin and sweep each other.
const acrossMembers = (repository: Repository): readonly WiringViolation[] => [
  ...findUngovernedProjects(
    repository.projects,
    repository.members.map((member: Member): MemberShape => shapeOf(member)),
  ).map((reason: string): WiringViolation => ({ location: 'pnpm-workspace.yaml', reason })),
  ...findServerUrlCollisions(
    repository.members
      .filter((member: Member): boolean => hasRuntime(memberKindOf(member.packageJson)))
      .map((member: Member) => ({ path: member.path, serverUrl: member.settings.serverUrl })),
  ).map((reason: string): WiringViolation => ({ location: 'package.json ploaness', reason })),
]

const declaredEverywhere = (repository: Repository): Record<string, string> =>
  Object.assign(
    {},
    ...repository.members.map(
      (member: Member): Record<string, string> => declaredDependencies(member.packageJson),
    ),
  ) as Record<string, string>

/** Verify the repository and each of its members have installed ploaness exactly as ploaness dictates. */
export const wiring = (repository: Repository): GateResult => {
  const isSolo: boolean = repository.members.length <= 1
  const findings: readonly string[] = [
    ...findRepositoryWiringViolations({
      packageJson: repository.packageJson,
      workspaceFile: repository.workspaceFile,
      declaredExclusions: repository.settings.declaredExclusions,
      expectedTestLibraries: expectedTestLibraries(),
      requiredPackageManager: asOptionalText(readPins()['packageManager']),
      requiredEngines: asStringRecord(readPins()['engines']),
      declaredAcrossMembers: declaredEverywhere(repository),
      repositoryFindings: acrossMembers(repository),
    }).map((violation: WiringViolation): string => `${violation.location}: ${violation.reason}`),
    ...repository.members.flatMap((member: Member): readonly string[] =>
      memberViolations(member).map((violation: WiringViolation): string =>
        locate(member, isSolo, violation),
      ),
    ),
  ]
  return findings.length > 0
    ? failed(
        `${String(findings.length)} wiring defect(s); the harness is not installed as ploaness requires`,
        findings,
      )
    : passed('ploaness is wired into the project as required')
}
