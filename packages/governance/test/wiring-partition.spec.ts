import { describe, expect, it } from 'vitest'
import {
  findPackageWiringViolations,
  findRepositoryWiringViolations,
  findWiringViolations,
  requiredBiomeFiles,
  type WiringInputs,
} from '../src/wiring-policy.js'
import type { WiringViolation } from '../src/wiring-violation.js'

// The split of one rule set into a repository half and a package half is only safe if it is EXHAUSTIVE
// and DISJOINT: every finding the single-package contract produced must still be produced, by exactly
// one half. A rule silently landing in neither is a gate that stopped checking something; a rule landing
// in both reports one defect twice and, in a workspace, once per member for a repository-level fact.
//
// The large spec beside this one pins WHAT each rule reports. This pins only that the partition holds,
// against an input broken in as many ways at once as the two halves can each speak to.

const BIOME_FILES: Readonly<Record<string, unknown>> = requiredBiomeFiles([
  'src',
  'tests',
  'scripts',
])

// Broken on both sides at once: the harness undeclared, a neutered script, a floating version, a range,
// a mismatched Payload package, the wrong package manager and engines, an override redefining a pin, a
// silenced advisory, and all five configuration files wrong.
const BROKEN: WiringInputs = {
  packageJson: {
    dependencies: { payload: '3.88.0', '@payloadcms/next': '3.0.0', next: '^16.3.2' },
    devDependencies: { vitest: '3.0.0' },
    scripts: { verify: 'echo ok' },
    packageManager: 'pnpm@10.0.0',
    engines: { node: '>=20' },
    pnpm: { auditConfig: { ignoreGhsas: ['GHSA-xxxx'] } },
  },
  eslintConfig: "import x from 'ploaness/eslint'\nexport default x\nexport const extra = []\n",
  vitestConfig: undefined,
  playwrightConfig: undefined,
  workspaceFile: ['overrides:', '  vitest: 3.0.0'].join('\n'),
  declaredExclusions: [],
  biomeConfig: JSON.stringify({ extends: [], linter: {}, files: {} }),
  tsconfig: JSON.stringify({ extends: './local.json', compilerOptions: { strict: false } }),
  expectedTestLibraries: { vitest: '4.1.11', payload: '3.88.0' },
  requiredTestLibraries: new Set<string>(['vitest', 'typescript']),
  payloadVersion: '3.88.0',
  requiredPackageManager: 'pnpm@11.9.0',
  requiredEngines: { node: '>=26' },
  requiredBiomeFiles: BIOME_FILES,
}

const keyOf = (violation: WiringViolation): string => `${violation.location}|${violation.reason}`

const combined = (): readonly string[] =>
  findWiringViolations(BROKEN).map((violation: WiringViolation): string => keyOf(violation))

const repositoryHalf = (): readonly string[] =>
  findRepositoryWiringViolations({
    packageJson: BROKEN.packageJson,
    workspaceFile: BROKEN.workspaceFile,
    declaredExclusions: BROKEN.declaredExclusions,
    expectedTestLibraries: BROKEN.expectedTestLibraries,
    requiredPackageManager: BROKEN.requiredPackageManager,
    requiredEngines: BROKEN.requiredEngines,
    declaredAcrossMembers: { next: '^16.3.2', vitest: '3.0.0' },
    repositoryFindings: [],
  }).map((violation: WiringViolation): string => keyOf(violation))

const packageHalf = (): readonly string[] =>
  findPackageWiringViolations({
    packageJson: BROKEN.packageJson,
    kind: 'payload',
    isNestedMember: false,
    requiredBiomeFiles: BROKEN.requiredBiomeFiles,
    eslintConfig: BROKEN.eslintConfig,
    vitestConfig: BROKEN.vitestConfig,
    playwrightConfig: BROKEN.playwrightConfig,
    declaredExclusions: BROKEN.declaredExclusions,
    biomeConfig: BROKEN.biomeConfig,
    tsconfig: BROKEN.tsconfig,
    expectedTestLibraries: BROKEN.expectedTestLibraries,
    requiredTestLibraries: BROKEN.requiredTestLibraries,
    payloadVersion: BROKEN.payloadVersion,
  }).map((violation: WiringViolation): string => keyOf(violation))

describe('the repository and package halves partition the wiring contract', () => {
  it('finds something to report on this input at all', () => {
    expect(combined().length).toBeGreaterThan(10)
  })

  it('loses no finding the single-package contract produced', () => {
    const halves: ReadonlySet<string> = new Set<string>([...repositoryHalf(), ...packageHalf()])
    expect(combined().filter((finding: string): boolean => !halves.has(finding))).toEqual([])
  })

  it('invents no finding the single-package contract did not produce', () => {
    const whole: ReadonlySet<string> = new Set<string>(combined())
    const extra: readonly string[] = [...repositoryHalf(), ...packageHalf()].filter(
      (finding: string): boolean => !whole.has(finding),
    )
    expect(extra).toEqual([])
  })

  it('reports the harness declaration in both halves, which is deliberate', () => {
    // The one rule that genuinely belongs to both: the repository root must declare ploaness to own the
    // scripts, and a member must declare it to resolve its own configuration files. Named here so the
    // disjointness assertion below can exclude it knowingly rather than by accident.
    const shared: readonly string[] = repositoryHalf().filter((finding: string): boolean =>
      packageHalf().includes(finding),
    )
    expect(shared).toEqual(['package.json|ploaness must be a declared dependency of the project'])
  })

  it('assigns every other finding to exactly one half', () => {
    const shared: readonly string[] = repositoryHalf().filter(
      (finding: string): boolean =>
        packageHalf().includes(finding) && !finding.startsWith('package.json|ploaness must be'),
    )
    expect(shared).toEqual([])
  })

  it('keeps the workspace file out of the package half entirely', () => {
    // The defect this refactor exists for, as a property rather than a case: a package-scope rule has no
    // way to reach an overrides block, so it can no longer vouch for a pin the root replaced.
    expect(
      packageHalf().filter((finding: string): boolean => finding.includes('pnpm-workspace.yaml')),
    ).toEqual([])
    expect(
      repositoryHalf().some((finding: string): boolean => finding.includes('pnpm-workspace.yaml')),
    ).toBe(true)
  })
})
