import { describe, expect, it } from 'vitest'
import {
  canRunBuiltBrowser,
  coversLevel,
  type GateDescriptor,
  type GateScope,
  isVerificationLevel,
  type MemberDescriptor,
  type PlanStep,
  planSteps,
  recordBuildSuccess,
  type VerificationLevel,
} from '../src/run-plan.js'

describe('production build evidence', () => {
  const empty: ReadonlySet<string> = new Set()
  const build: PlanStep = { gateId: 'build', member: 'apps/site' }
  const browser: PlanStep = { gateId: 'e2e', member: 'apps/site' }

  it('requires a successful build of the same member in this run', () => {
    expect(canRunBuiltBrowser(browser, true, empty)).toBe(false)
    expect(canRunBuiltBrowser(browser, true, recordBuildSuccess(empty, build, false))).toBe(false)
    const built: ReadonlySet<string> = recordBuildSuccess(empty, build, true)
    expect(canRunBuiltBrowser(browser, true, built)).toBe(true)
    expect(canRunBuiltBrowser({ ...browser, member: 'apps/other' }, true, built)).toBe(false)
    expect(canRunBuiltBrowser({ ...browser, member: undefined }, true, built)).toBe(false)
  })

  it('does not treat unrelated passes as builds or require a runtime for a library', () => {
    expect(recordBuildSuccess(empty, browser, true)).toEqual(empty)
    expect(recordBuildSuccess(empty, { gateId: 'build', member: undefined }, true)).toEqual(empty)
    expect(canRunBuiltBrowser(browser, false, empty)).toBe(true)
    expect(canRunBuiltBrowser(build, true, empty)).toBe(true)
  })
})

// The registry as it stands, in run order, with the scope each gate is being given. Written out rather
// than imported from the CLI because governance may not depend on it - and because a copy that has to
// agree with the real registry is exactly what `gate-scopes.spec.ts` asserts on the CLI side. What is
// pinned HERE is the ordering rule; what is pinned THERE is that the registry still says this.
const REGISTRY: readonly (readonly [string, GateScope, VerificationLevel])[] = [
  ['preflight', 'repository', 'quick'],
  ['wiring', 'repository', 'quick'],
  ['assets', 'repository', 'quick'],
  ['tree-snapshot', 'repository', 'quick'],
  ['types', 'package', 'quick'],
  ['biome', 'package', 'quick'],
  ['biome-schema', 'repository', 'quick'],
  ['eslint', 'package', 'quick'],
  ['conventions', 'repository', 'quick'],
  ['editorconfig', 'repository', 'quick'],
  ['suppressions', 'package', 'quick'],
  ['css', 'package', 'quick'],
  ['tailwind-tokens', 'package', 'quick'],
  ['arch', 'package', 'quick'],
  ['type-coverage', 'package', 'quick'],
  ['payload-generated', 'payload', 'quick'],
  ['generated-denial', 'repository', 'quick'],
  ['payload-rules', 'payload', 'quick'],
  ['config-refs', 'package', 'quick'],
  ['secrets', 'repository', 'quick'],
  ['licenses', 'repository', 'quick'],
  ['vulnerabilities', 'repository', 'quick'],
  ['install-scripts', 'repository', 'quick'],
  ['release-age', 'repository', 'quick'],
  ['deps', 'repository', 'quick'],
  ['image-assets', 'repository', 'quick'],
  ['docs', 'repository', 'quick'],
  ['skills', 'repository', 'quick'],
  ['docker', 'repository', 'quick'],
  ['actions', 'repository', 'quick'],
  ['knip', 'package', 'quick'],
  ['tests', 'package', 'quick'],
  ['require-full-history', 'repository', 'delta'],
  ['commit-history', 'repository', 'delta'],
  ['linear-history', 'repository', 'delta'],
  ['build', 'package', 'delta'],
  ['bundle', 'package', 'delta'],
  ['e2e', 'package', 'delta'],
  ['tree-verify', 'repository', 'quick'],
]

const GATES: readonly GateDescriptor[] = REGISTRY.map(
  ([id, scope, level]: readonly [string, GateScope, VerificationLevel]): GateDescriptor => ({
    id,
    scope,
    level,
  }),
)

// The sequence ploaness ran before it knew about members. Every id, in the order `ploaness gates`
// printed them, filtered to quick verification. If this list needs editing to make a test pass, the
// refactor has changed what a single-package project experiences and the change is the defect.
const DEFAULT_SEQUENCE: readonly string[] = [
  'preflight',
  'wiring',
  'assets',
  'tree-snapshot',
  'types',
  'biome',
  'biome-schema',
  'eslint',
  'conventions',
  'editorconfig',
  'suppressions',
  'css',
  'tailwind-tokens',
  'arch',
  'type-coverage',
  'payload-generated',
  'generated-denial',
  'payload-rules',
  'config-refs',
  'secrets',
  'licenses',
  'vulnerabilities',
  'install-scripts',
  'release-age',
  'deps',
  'image-assets',
  'docs',
  'skills',
  'docker',
  'actions',
  'knip',
  'tests',
  'tree-verify',
]

const DELTA_ADDITIONS: ReadonlySet<string> = new Set([
  'require-full-history',
  'commit-history',
  'linear-history',
  'build',
  'bundle',
  'e2e',
])

const SOLE_PAYLOAD_MEMBER: readonly MemberDescriptor[] = [{ path: '.', isPayload: true }]

const idsOf = (steps: readonly PlanStep[]): readonly string[] => steps.map((step: PlanStep): string => step.gateId)

const LEVELS: readonly VerificationLevel[] = ['quick', 'delta', 'full']

describe('verification levels', () => {
  it('names exactly the three levels', () => {
    expect(
      ['quick', 'delta', 'full', 'extended', 'Full', ''].filter((word: string) => isVerificationLevel(word)),
    ).toEqual(LEVELS)
  })

  it('makes each level contain the one before it and nothing after it', () => {
    expect(coversLevel('quick', 'quick')).toBe(true)
    expect(coversLevel('quick', 'delta')).toBe(false)
    expect(coversLevel('delta', 'quick')).toBe(true)
    expect(coversLevel('full', 'delta')).toBe(true)
    expect(coversLevel('delta', 'full')).toBe(false)
  })
})

describe('planSteps', () => {
  it('reproduces the single-package run order exactly', () => {
    expect(idsOf(planSteps(GATES, SOLE_PAYLOAD_MEMBER, 'quick'))).toEqual(DEFAULT_SEQUENCE)
  })

  it('adds the delta gates without reordering the quick ones', () => {
    const delta: readonly string[] = idsOf(planSteps(GATES, SOLE_PAYLOAD_MEMBER, 'delta'))
    expect(delta.filter((id: string): boolean => !DELTA_ADDITIONS.has(id))).toEqual(DEFAULT_SEQUENCE)
  })

  it('runs the same gates at full as at delta', () => {
    expect(planSteps(GATES, SOLE_PAYLOAD_MEMBER, 'full')).toEqual(planSteps(GATES, SOLE_PAYLOAD_MEMBER, 'delta'))
  })

  it('ends every level with the working-tree fingerprint', () => {
    for (const level of LEVELS) {
      expect(idsOf(planSteps(GATES, SOLE_PAYLOAD_MEMBER, level)).at(-1)).toBe('tree-verify')
    }
  })

  it('leads every level with the two preconditions', () => {
    for (const level of LEVELS) {
      expect(idsOf(planSteps(GATES, SOLE_PAYLOAD_MEMBER, level)).slice(0, 2)).toEqual(['preflight', 'wiring'])
    }
  })
})

describe('planSteps across members', () => {
  it('asks a repository-scope gate once however many members there are', () => {
    const steps: readonly PlanStep[] = planSteps(
      GATES,
      [
        { path: '.', isPayload: false },
        { path: 'apps/web', isPayload: true },
        { path: 'apps/admin', isPayload: true },
      ],
      'quick',
    )
    expect(steps.filter((step: PlanStep): boolean => step.gateId === 'conventions')).toEqual([
      { gateId: 'conventions', member: undefined },
    ])
  })

  it('asks a package-scope gate about every member', () => {
    const steps: readonly PlanStep[] = planSteps(
      GATES,
      [
        { path: '.', isPayload: false },
        { path: 'apps/web', isPayload: true },
      ],
      'quick',
    )
    expect(
      steps
        .filter((step: PlanStep): boolean => step.gateId === 'types')
        .map((step: PlanStep): string | undefined => step.member),
    ).toEqual(['.', 'apps/web'])
  })
})

describe('planSteps scope selection', () => {
  it('asks a payload-scope gate only about the members declaring payload', () => {
    const steps: readonly PlanStep[] = planSteps(
      GATES,
      [
        { path: '.', isPayload: false },
        { path: 'apps/web', isPayload: true },
      ],
      'quick',
    )
    expect(
      steps
        .filter((step: PlanStep): boolean => step.gateId === 'payload-rules')
        .map((step: PlanStep): string | undefined => step.member),
    ).toEqual(['apps/web'])
  })

  it('runs no package-scope gate when a repository has no governed member', () => {
    const steps: readonly PlanStep[] = planSteps(GATES, [], 'quick')
    expect(idsOf(steps)).not.toContain('types')
    expect(idsOf(steps)).toContain('preflight')
  })

  it('keeps every member of one gate together before moving to the next gate', () => {
    const steps: readonly PlanStep[] = planSteps(
      GATES,
      [
        { path: 'apps/web', isPayload: true },
        { path: 'apps/admin', isPayload: true },
      ],
      'quick',
    )
    const window: readonly string[] = idsOf(steps).slice(
      idsOf(steps).indexOf('types'),
      idsOf(steps).indexOf('types') + 3,
    )
    expect(window).toEqual(['types', 'types', 'biome'])
  })
})
