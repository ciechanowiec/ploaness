// The anti-bypass gate. Reads the consumer's own files and fails when ploaness has been disarmed. The
// rules are pure and live in @ploaness/governance; this file supplies the I/O and the expectations.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import {
  findWiringViolations,
  requiredBiomeFiles,
  type WiringViolation,
  type WorkflowFile,
} from '@ploaness/governance'
import { type Context, readJson, readText, shippedDirectory } from '../context.js'
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

// The application framework, which ploaness owns outright rather than merely measuring. These versions
// come from `pins.json` instead of from a dependency, because ploaness imports none of them and
// declaring them would install a second Payload, Next and React into every consumer that has one.
const FRAMEWORK_NAMES: readonly string[] = ['payload', 'next', 'react', 'react-dom', 'sharp']

const frameworkPins = (): Readonly<Record<string, string>> => {
  const parsed: unknown = readJson(path.join(shippedDirectory('@ploaness/config'), 'pins.json'))
  const framework: unknown =
    typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)['framework']
      : undefined
  return typeof framework === 'object' && framework !== null
    ? (framework as Record<string, string>)
    : {}
}

const WORKFLOW_DIRECTORY: string = path.join('.github', 'workflows')

const readWorkflows = (root: string): readonly WorkflowFile[] => {
  const directory: string = path.join(root, WORKFLOW_DIRECTORY)
  if (!existsSync(directory)) {
    return []
  }
  return readdirSync(directory)
    .filter((name: string): boolean => name.endsWith('.yml') || name.endsWith('.yaml'))
    .map(
      (name: string): WorkflowFile => ({
        name,
        content: readFileSync(path.join(directory, name), 'utf8'),
      }),
    )
}

// Where a pinned version is read from. The harness installs these itself, so its own manifests are the
// single source of the expectation and a harness bump moves it in exactly one place. Both packages are
// consulted because the split between them is an internal packaging detail: vitest is declared by the
// config package that presets it, the coverage provider by the CLI package that runs it. Reading only
// one would leave the other name in TEST_LIBRARY_NAMES pinning nothing at all, silently.
const VERSION_SOURCES: readonly string[] = ['@ploaness/config', '@ploaness/cli']

const declaredBy = (packageName: string): Record<string, unknown> => {
  const manifest: unknown = readJson(path.join(shippedDirectory(packageName), 'package.json'))
  const dependencies: unknown =
    typeof manifest === 'object' && manifest !== null
      ? (manifest as Record<string, unknown>)['dependencies']
      : undefined
  return typeof dependencies === 'object' && dependencies !== null
    ? (dependencies as Record<string, unknown>)
    : {}
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
  // Every governed project is a Payload application built by Next and rendered by React. Requiring
  // these is not an addition to the contract; it is what `preflight` already assumes.
  ...FRAMEWORK_NAMES,
])

const expectedTestLibraries = (): Readonly<Record<string, string>> => {
  const declared: Record<string, unknown> = Object.assign(
    {},
    ...VERSION_SOURCES.map((source: string): Record<string, unknown> => declaredBy(source)),
  ) as Record<string, unknown>
  const fromDependencies: Record<string, string> = Object.fromEntries(
    TEST_LIBRARY_NAMES.map((name: string): readonly [string, unknown] => [
      name,
      declared[name],
    ]).filter(([, version]: readonly [string, unknown]): boolean => typeof version === 'string'),
  ) as Record<string, string>
  return { ...fromDependencies, ...frameworkPins() }
}

/** Verify the project has installed ploaness exactly as ploaness dictates. */
export const wiring = (context: Context): GateResult => {
  const violations: readonly WiringViolation[] = findWiringViolations({
    packageJson: context.packageJson,
    eslintConfig: readText(path.join(context.root, 'eslint.config.mjs')),
    vitestConfig: readText(path.join(context.root, 'vitest.config.mts')),
    playwrightConfig: readText(path.join(context.root, 'playwright.config.ts')),
    workspaceFile: readText(path.join(context.root, 'pnpm-workspace.yaml')) ?? '',
    declaredExclusions: context.settings.declaredExclusions,
    isExistingPath: (relativePath: string): boolean =>
      existsSync(path.join(context.root, relativePath)),
    biomeConfig: readText(path.join(context.root, 'biome.json')),
    tsconfig: readText(path.join(context.root, 'tsconfig.json')),
    workflows: readWorkflows(context.root),
    expectedTestLibraries: expectedTestLibraries(),
    requiredTestLibraries: REQUIRED_TEST_LIBRARIES,
    payloadVersion: frameworkPins()['payload'],
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
