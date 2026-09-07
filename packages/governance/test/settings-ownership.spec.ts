import { describe, expect, it } from 'vitest'
import { matchesRole, type RolePattern } from '../src/file-roles.js'
import type { DeclaredExclusion, Settings } from '../src/settings.js'
import { readMemberSettings, rebaseExclusion } from '../src/settings-layering.js'

describe('workspace settings ownership', () => {
  it('retains generated paths declared by both root and member', () => {
    const settings: Settings = readMemberSettings(
      { generatedArtefacts: [{ pattern: 'src/shared.ts', reason: 'generated schema' }] },
      { generatedArtefacts: [{ pattern: 'src/local.ts', reason: 'generated schema' }] },
    )
    expect(settings.generatedArtefacts).toEqual(
      expect.arrayContaining(['src/shared.ts', 'src/local.ts']),
    )
    expect(settings.declaredExclusions.map((entry) => entry.pattern)).toEqual(['src/local.ts'])
  })

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 'small', null])(
    'retains valid root ceilings when a member declares %s',
    (value: unknown) => {
      const settings: Settings = readMemberSettings(
        { bundleBudgetBytes: 500, accessibilityRouteBudget: 25 },
        { bundleBudgetBytes: value, accessibilityRouteBudget: value },
      )
      expect(settings.bundleBudgetBytes).toBe(500)
      expect(settings.accessibilityRouteBudget).toBe(25)
    },
  )

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 'none', null])(
    'preserves a zero suppression ceiling against %s',
    (value: unknown) => {
      expect(
        readMemberSettings({ maxSuppressions: 0 }, { maxSuppressions: value }).maxSuppressions,
      ).toBe(0)
    },
  )

  it.each(['generated/', '^src/generated/', '(^src/generated/|^vendor/)'])(
    'confines a member regex to that member without rewriting it: %s',
    (pattern: string) => {
      const entry: DeclaredExclusion = rebaseExclusion('apps/web', {
        setting: 'typographyExclusions',
        pattern,
        reason: 'generated schema',
        kind: 'regex',
      })
      const patterns: readonly RolePattern[] = [
        { memberPath: entry.memberPath ?? '.', pattern: entry.pattern },
      ]
      expect(matchesRole('apps/web/src/generated/schema.ts', patterns)).toBe(true)
      expect(matchesRole('apps/api/src/generated/schema.ts', patterns)).toBe(false)
      expect(matchesRole('src/generated/schema.ts', patterns)).toBe(false)
      expect(matchesRole('apps/web/src/authored/schema.ts', patterns)).toBe(false)
    },
  )
})
