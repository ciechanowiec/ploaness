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
const TEST_LIBRARY_NAMES: readonly string[] = ['vitest', '@vitest/coverage-v8']

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

const expectedTestLibraries = (): Readonly<Record<string, string>> => {
  const declared: Record<string, unknown> = Object.assign(
    {},
    ...VERSION_SOURCES.map((source: string): Record<string, unknown> => declaredBy(source)),
  ) as Record<string, unknown>
  return Object.fromEntries(
    TEST_LIBRARY_NAMES.map((name: string): readonly [string, unknown] => [
      name,
      declared[name],
    ]).filter(([, version]: readonly [string, unknown]): boolean => typeof version === 'string'),
  ) as Record<string, string>
}

/** Verify the project has installed ploaness exactly as ploaness dictates. */
export const wiring = (context: Context): GateResult => {
  const violations: readonly WiringViolation[] = findWiringViolations({
    packageJson: context.packageJson,
    eslintConfig: readText(path.join(context.root, 'eslint.config.mjs')),
    biomeConfig: readText(path.join(context.root, 'biome.json')),
    tsconfig: readText(path.join(context.root, 'tsconfig.json')),
    workflows: readWorkflows(context.root),
    expectedTestLibraries: expectedTestLibraries(),
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
