import { type MemberDescriptor, type PlanStep, planSteps } from '@ploaness/governance'
import { describe, expect, it } from 'vitest'
import { ALL_GATES } from '../src/gates.js'

const MEMBERS: readonly MemberDescriptor[] = [
  { path: 'apps/web', isPayload: true },
  { path: 'packages/shared', isPayload: false },
]

describe('mandatory full-run inventory', () => {
  it('generates one repository inventory after all member checks and before the final tree check', () => {
    const plan: readonly PlanStep[] = planSteps(ALL_GATES, MEMBERS, true)
    expect(plan.filter((step: PlanStep): boolean => step.gateId === 'sbom')).toEqual([
      { gateId: 'sbom', member: undefined },
    ])
    expect(plan.slice(-2).map((step: PlanStep): string => step.gateId)).toEqual(['sbom', 'tree-verify'])
  })

  it('keeps inventory generation outside the declared development subset', () => {
    const plan: readonly PlanStep[] = planSteps(ALL_GATES, MEMBERS, false)
    expect(plan.some((step: PlanStep): boolean => step.gateId === 'sbom')).toBe(false)
  })
})
