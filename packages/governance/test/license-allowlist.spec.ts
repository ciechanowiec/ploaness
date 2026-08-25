import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  findLicenseViolations,
  isLicenseAllowed,
  type LicensedPackage,
} from '../src/license-allowlist.js'

describe('license allowlist', () => {
  it('permits permissive licenses', () => {
    expect(isLicenseAllowed('MIT')).toBe(true)
    expect(isLicenseAllowed('Apache-2.0')).toBe(true)
    expect(isLicenseAllowed('ISC')).toBe(true)
  })

  it('permits an OR expression when any operand is permissive', () => {
    expect(isLicenseAllowed('(MPL-2.0 OR Apache-2.0)')).toBe(true)
    expect(isLicenseAllowed('MIT OR Apache-2.0')).toBe(true)
  })

  it('permits the documented weak-copyleft exceptions', () => {
    expect(isLicenseAllowed('MPL-2.0')).toBe(true)
    expect(isLicenseAllowed('LGPL-3.0-only')).toBe(true)
    expect(isLicenseAllowed('LGPL-3.0-or-later')).toBe(true)
  })

  it('rejects strong copyleft and unknown licenses', () => {
    expect(isLicenseAllowed('GPL-3.0-only')).toBe(false)
    expect(isLicenseAllowed('AGPL-3.0')).toBe(false)
    expect(isLicenseAllowed('UNKNOWN')).toBe(false)
  })

  it('requires every operand of an AND expression to be allowed', () => {
    expect(isLicenseAllowed('MIT AND GPL-3.0-only')).toBe(false)
    expect(isLicenseAllowed('MIT AND Apache-2.0')).toBe(true)
  })

  // An operand that is itself a group is the case the parenthesis bookkeeping exists for, and it was
  // the one case never asserted: the expressions below both open and close a parenthesis at the ends
  // without being enclosed by them, which the old net-balance test could not tell from a real wrap.
  it('evaluates a parenthesised operand as a group rather than unwrapping the whole expression', () => {
    expect(isLicenseAllowed('(MIT) OR (ISC)')).toBe(true)
    expect(isLicenseAllowed('(MIT AND ISC) OR (Apache-2.0)')).toBe(true)
    expect(isLicenseAllowed('(MIT OR Apache-2.0) AND (ISC OR MIT)')).toBe(true)
  })

  // The same defect in the direction that matters: read as a top-level OR, the expression below found
  // `MIT` among pieces that were never operands and passed a conjunct nothing permits.
  it('refuses a conjunct that is a group of disallowed licenses', () => {
    expect(isLicenseAllowed('(MIT OR GPL-3.0-only) AND (GPL-3.0-only OR AGPL-3.0-only)')).toBe(
      false,
    )
    expect(isLicenseAllowed('(GPL-3.0-only) AND (MIT)')).toBe(false)
  })

  it('returns only the disallowed packages', () => {
    const violations: readonly LicensedPackage[] = findLicenseViolations([
      { name: 'good', license: 'MIT' },
      { name: 'bad', license: 'GPL-3.0-only' },
    ])
    expect(violations).toEqual([{ name: 'bad', license: 'GPL-3.0-only' }])
  })
})

// Property-based tests assert the SPDX-expression invariants over every generated combination of
// operands, rather than the handful enumerated above. The fixed global seed (vitest.setup.ts) keeps
// them deterministic. (Each `it` also carries a concrete example assertion, since the unit scope's
// assertions-in-tests rule - unlike the integration scope - does not recognise `fc.assert`.)
describe('license allowlist properties (fast-check)', () => {
  const allowedId: fc.Arbitrary<'MIT' | 'Apache-2.0' | 'ISC' | 'MPL-2.0' | 'LGPL-3.0-only'> =
    fc.constantFrom('MIT', 'Apache-2.0', 'ISC', 'MPL-2.0', 'LGPL-3.0-only')
  const deniedId: fc.Arbitrary<'GPL-3.0-only' | 'AGPL-3.0' | 'UNKNOWN' | 'BUSL-1.1'> =
    fc.constantFrom('GPL-3.0-only', 'AGPL-3.0', 'UNKNOWN', 'BUSL-1.1')
  const anyId: fc.Arbitrary<string> = fc.oneof(allowedId, deniedId)
  const Allowed: ReadonlySet<string> = new Set([
    'MIT',
    'Apache-2.0',
    'ISC',
    'MPL-2.0',
    'LGPL-3.0-only',
  ])

  it('allows an OR expression iff at least one operand is allowed', () => {
    expect(isLicenseAllowed('GPL-3.0-only OR MIT')).toBe(true)
    fc.assert(
      fc.property(fc.array(anyId, { minLength: 1 }), (ids: string[]): boolean => {
        const isAnyAllowed: boolean = ids.some((id: string): boolean => Allowed.has(id))
        return isLicenseAllowed(ids.join(' OR ')) === isAnyAllowed
      }),
    )
  })

  it('allows an AND expression iff every operand is allowed', () => {
    expect(isLicenseAllowed('MIT AND GPL-3.0-only')).toBe(false)
    fc.assert(
      fc.property(fc.array(anyId, { minLength: 1 }), (ids: string[]): boolean => {
        const isEveryAllowed: boolean = ids.every((id: string): boolean => Allowed.has(id))
        return isLicenseAllowed(ids.join(' AND ')) === isEveryAllowed
      }),
    )
  })

  it('is unaffected by surrounding parentheses', () => {
    expect(isLicenseAllowed('(MIT)')).toBe(isLicenseAllowed('MIT'))
    fc.assert(
      fc.property(
        anyId,
        (id: string): boolean => isLicenseAllowed(`(${id})`) === isLicenseAllowed(id),
      ),
    )
  })
})
