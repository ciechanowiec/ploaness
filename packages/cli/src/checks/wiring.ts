// The anti-bypass gate. Reads the consumer's own files and fails when ploaness has been disarmed. The
// rules are pure and live in @ploaness/governance; this file supplies the I/O and the expectations.
import path from 'node:path'
import {
  asOptionalText,
  asRecord,
  asStringRecord,
  findWiringViolations,
  isArray,
  isRecord,
  readKey,
  requiredBiomeFiles,
  type WiringViolation,
} from '@ploaness/governance'
import {
  type Repository as Repo,
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
  readonly required: boolean
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
                required: record['required'] === true,
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
const VERSION_SOURCES: readonly string[] = ['@ploaness/config', '@ploaness/cli']

const declaredBy = (packageName: string): Record<string, unknown> => {
  const manifest: unknown = readJson(shippedFile(packageName, 'package.json'))
  return asRecord(readKey(manifest, 'dependencies'))
}

// The packages a project's specs import, so every project must declare them. The rest of the pinned set
// is matched when declared and never forced on a project that has no use for it. The two Playwright
// packages are here because ploaness now ships a spec that imports them: the managed accessibility
// sweep is not optional, so neither is resolving what it imports.
const REQUIRED_TEST_LIBRARIES: ReadonlySet<string> = new Set<string>([
  'vitest',
  '@vitest/coverage-v8',
  'typescript',
  '@playwright/test',
  '@axe-core/playwright',
  // ploaness starts the end-to-end run through it, so a project without it has a gate that cannot run.
  'tsx',
])

// A pin in a required group is what makes a project declare the package. A pin in any other group is
// matched when the project declares it and forced on nobody, which is how ploaness can own the version
// of a Postgres driver without deciding that every governed project uses Postgres.
const requiredPackages = (): ReadonlySet<string> =>
  new Set<string>([
    ...REQUIRED_TEST_LIBRARIES,
    ...pinGroups()
      .filter((group: PinGroup): boolean => group.required)
      .flatMap((group: PinGroup): readonly string[] => Object.keys(group.versions)),
  ])

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

/** Verify the project has installed ploaness exactly as ploaness dictates. */
export const wiring = (context: Repo): GateResult => {
  const violations: readonly WiringViolation[] = findWiringViolations({
    packageJson: context.packageJson,
    eslintConfig: readText(path.join(context.root, 'eslint.config.mjs')),
    vitestConfig: readText(path.join(context.root, 'vitest.config.mts')),
    playwrightConfig: readText(path.join(context.root, 'playwright.config.ts')),
    workspaceFile: context.workspaceFile,
    declaredExclusions: context.settings.declaredExclusions,
    biomeConfig: readText(path.join(context.root, 'biome.json')),
    tsconfig: readText(path.join(context.root, 'tsconfig.json')),
    expectedTestLibraries: expectedTestLibraries(),
    requiredTestLibraries: requiredPackages(),
    payloadVersion: ownedVersions()['payload'],
    requiredPackageManager: asOptionalText(readPins()['packageManager']),
    requiredEngines: asStringRecord(readPins()['engines']),
    requiredBiomeFiles: requiredBiomeFiles(context.settings.sourceRoots),
  })
  return violations.length > 0
    ? failed(
        `${String(violations.length)} wiring defect(s); the harness is not installed as ploaness requires`,
        violations.map(
          (violation: WiringViolation): string => `${violation.location}: ${violation.reason}`,
        ),
      )
    : passed('ploaness is wired into the project as required')
}
