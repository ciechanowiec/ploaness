import { describe, expect, it } from 'vitest'
import {
  applyDenyRules,
  deniedPathsFor,
  findDenialViolations,
  GENERATED_ARTEFACTS,
  requiredDenyRules,
} from '../src/generated-denial.js'

const firstArtefact: string = GENERATED_ARTEFACTS[0] ?? ''
const complete: Record<string, unknown> = {
  permissions: { deny: [...requiredDenyRules(GENERATED_ARTEFACTS)] },
}

describe('requiredDenyRules', () => {
  it('denies both writing forms for every generated artefact', () => {
    expect(requiredDenyRules(GENERATED_ARTEFACTS)).toHaveLength(GENERATED_ARTEFACTS.length * 2)
  })

  // The joint: adding an artefact to the shared list must extend the denial without anyone editing a
  // second list. The regeneration gate reads the same constant.
  it('derives its rules from the shared artefact list', () => {
    for (const artefact of GENERATED_ARTEFACTS) {
      expect(requiredDenyRules(GENERATED_ARTEFACTS)).toContain(`Edit(${artefact})`)
    }
  })
})

describe('findDenialViolations', () => {
  it('accepts settings that carry every required denial', () => {
    expect(findDenialViolations(complete, undefined, GENERATED_ARTEFACTS)).toEqual([])
  })

  it('reports every denial when the settings are absent', () => {
    expect(findDenialViolations(undefined, undefined, GENERATED_ARTEFACTS)).toHaveLength(
      requiredDenyRules(GENERATED_ARTEFACTS).length,
    )
  })

  it('reports only the denial that is missing', () => {
    const partial: Record<string, unknown> = {
      permissions: { deny: requiredDenyRules(GENERATED_ARTEFACTS).slice(1) },
    }
    expect(findDenialViolations(partial, undefined, GENERATED_ARTEFACTS)).toHaveLength(1)
  })

  it('reports a local override that re-permits a denied artefact', () => {
    const local: Record<string, unknown> = {
      permissions: { allow: [`Write(${firstArtefact})`] },
    }
    const found: readonly string[] = findDenialViolations(complete, local, GENERATED_ARTEFACTS)
    expect(found[0]).toContain('re-permit')
  })

  it('leaves a local override that permits something else alone', () => {
    const local: Record<string, unknown> = { permissions: { allow: ['Write(src/lib/reads.ts)'] } }
    expect(findDenialViolations(complete, local, GENERATED_ARTEFACTS)).toEqual([])
  })

  it('reports rather than crashes when the settings are malformed', () => {
    expect(findDenialViolations('not an object', undefined, GENERATED_ARTEFACTS)).toHaveLength(
      requiredDenyRules(GENERATED_ARTEFACTS).length,
    )
  })
})

describe('applyDenyRules', () => {
  it('writes every required denial into empty settings', () => {
    expect(
      findDenialViolations(
        applyDenyRules(undefined, GENERATED_ARTEFACTS),
        undefined,
        GENERATED_ARTEFACTS,
      ),
    ).toEqual([])
  })

  // The file is the project's, not ploaness's: it legitimately carries hooks, env, and model keys.
  it('preserves every other key the project owns', () => {
    const existing: Record<string, unknown> = {
      model: 'opus',
      hooks: { Stop: [] },
      permissions: { allow: ['Bash(ls)'] },
    }
    const merged: Record<string, unknown> = applyDenyRules(existing, GENERATED_ARTEFACTS)
    expect(merged['model']).toBe('opus')
    expect(merged['hooks']).toEqual({ Stop: [] })
    expect((merged['permissions'] as Record<string, unknown>)['allow']).toEqual(['Bash(ls)'])
  })

  it('does not duplicate a denial the settings already carry', () => {
    const merged: Record<string, unknown> = applyDenyRules(complete, GENERATED_ARTEFACTS)
    const deny: readonly string[] = (merged['permissions'] as Record<string, unknown>)[
      'deny'
    ] as readonly string[]
    expect(deny).toHaveLength(requiredDenyRules(GENERATED_ARTEFACTS).length)
  })

  it('keeps a denial the project added for itself', () => {
    const existing: Record<string, unknown> = { permissions: { deny: ['Write(secrets.env)'] } }
    const merged: Record<string, unknown> = applyDenyRules(existing, GENERATED_ARTEFACTS)
    const deny: readonly string[] = (merged['permissions'] as Record<string, unknown>)[
      'deny'
    ] as readonly string[]
    expect(deny).toContain('Write(secrets.env)')
  })
})

describe('deniedPathsFor', () => {
  const Artefacts: readonly string[] = ['src/payload-types.ts', 'src/schema.ts']

  it('leaves a single member at the root naming the artefacts unchanged', () => {
    // The property that keeps a single-package project's runtime settings byte-identical.
    expect(deniedPathsFor(['.'], Artefacts)).toEqual(Artefacts)
  })

  it('prefixes each artefact with the member that generates it', () => {
    expect(deniedPathsFor(['apps/web'], Artefacts)).toEqual([
      'apps/web/src/payload-types.ts',
      'apps/web/src/schema.ts',
    ])
  })

  it('covers every member that has generated files', () => {
    expect(deniedPathsFor(['apps/web', 'apps/admin'], ['src/x.ts'])).toEqual([
      'apps/web/src/x.ts',
      'apps/admin/src/x.ts',
    ])
  })

  it('denies nothing when no member generates anything', () => {
    expect(deniedPathsFor([], Artefacts)).toEqual([])
  })
})
