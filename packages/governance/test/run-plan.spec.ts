import { describe, expect, it } from 'vitest'
import {
  type GateDescriptor,
  type GateScope,
  type MemberDescriptor,
  type PlanStep,
  planSteps,
} from '../src/run-plan.js'

// The registry as it stands, in run order, with the scope each gate is being given. Written out rather
// than imported from the CLI because governance may not depend on it - and because a copy that has to
// agree with the real registry is exactly what `gate-scopes.spec.ts` asserts on the CLI side. What is
// pinned HERE is the ordering rule; what is pinned THERE is that the registry still says this.
const REGISTRY: readonly (readonly [string, GateScope, boolean])[] = [
  ['preflight', 'repository', false],
  ['wiring', 'repository', false],
  ['assets', 'repository', false],
  ['tree-snapshot', 'repository', false],
  ['types', 'package', false],
  ['biome', 'package', false],
  ['biome-schema', 'repository', false],
  ['eslint', 'package', false],
  ['conventions', 'repository', false],
  ['editorconfig', 'repository', false],
  ['suppressions', 'package', false],
  ['css', 'package', false],
  ['tailwind-tokens', 'package', false],
  ['arch', 'package', false],
  ['type-coverage', 'package', false],
  ['payload-generated', 'payload', false],
  ['generated-denial', 'repository', false],
  ['payload-rules', 'payload', false],
  ['config-refs', 'package', false],
  ['secrets', 'repository', false],
  ['licenses', 'repository', false],
  ['vulnerabilities', 'repository', false],
  ['install-scripts', 'repository', false],
  ['release-age', 'repository', false],
  ['deps', 'repository', false],
  ['image-assets', 'repository', false],
  ['docs', 'repository', false],
  ['skills', 'repository', false],
  ['docker', 'repository', false],
  ['actions', 'repository', false],
  ['knip', 'package', false],
  ['tests', 'package', false],
  ['require-full-history', 'repository', true],
  ['commit-history', 'repository', true],
  ['linear-history', 'repository', true],
  ['build', 'package', true],
  ['bundle', 'package', true],
  ['e2e', 'package', true],
  ['tree-verify', 'repository', false],
]

const GATES: readonly GateDescriptor[] = REGISTRY.map(
  ([id, scope, isExtended]: readonly [string, GateScope, boolean]): GateDescriptor => ({
    id,
    scope,
    isExtended,
  }),
)

// The sequence ploaness ran before it knew about members. Every id, in the order `ploaness gates`
// printed them, filtered to Default verification. If this list needs editing to make a test pass, the
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

const EXTENDED_ADDITIONS: ReadonlySet<string> = new Set([
  'require-full-history',
  'commit-history',
  'linear-history',
  'build',
  'bundle',
  'e2e',
])

const SOLE_PAYLOAD_MEMBER: readonly MemberDescriptor[] = [{ path: '.', isPayload: true }]

const idsOf = (steps: readonly PlanStep[]): readonly string[] =>
  steps.map((step: PlanStep): string => step.gateId)

describe('planSteps', () => {
  it('reproduces the single-package run order exactly', () => {
    expect(idsOf(planSteps(GATES, SOLE_PAYLOAD_MEMBER, false))).toEqual(DEFAULT_SEQUENCE)
  })

  it('adds the extended gates without reordering the default ones', () => {
    const extended: readonly string[] = idsOf(planSteps(GATES, SOLE_PAYLOAD_MEMBER, true))
    expect(extended.filter((id: string): boolean => !EXTENDED_ADDITIONS.has(id))).toEqual(
      DEFAULT_SEQUENCE,
    )
  })

  it('ends both modes with the working-tree fingerprint', () => {
    for (const isExtended of [false, true]) {
      expect(idsOf(planSteps(GATES, SOLE_PAYLOAD_MEMBER, isExtended)).at(-1)).toBe('tree-verify')
    }
  })

  it('leads both modes with the two preconditions', () => {
    for (const isExtended of [false, true]) {
      expect(idsOf(planSteps(GATES, SOLE_PAYLOAD_MEMBER, isExtended)).slice(0, 2)).toEqual([
        'preflight',
        'wiring',
      ])
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
      false,
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
      false,
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
      false,
    )
    expect(
      steps
        .filter((step: PlanStep): boolean => step.gateId === 'payload-rules')
        .map((step: PlanStep): string | undefined => step.member),
    ).toEqual(['apps/web'])
  })

  it('runs no package-scope gate when a repository has no governed member', () => {
    const steps: readonly PlanStep[] = planSteps(GATES, [], false)
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
      false,
    )
    const window: readonly string[] = idsOf(steps).slice(
      idsOf(steps).indexOf('types'),
      idsOf(steps).indexOf('types') + 3,
    )
    expect(window).toEqual(['types', 'types', 'biome'])
  })
})
