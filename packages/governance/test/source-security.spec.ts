import { describe, expect, it } from 'vitest'
import type { PayloadViolation } from '../src/payload-source.js'
import { findAbsentSecretAcceptances, findFailOpenSecretGuards } from '../src/source-security.js'

const rulesOf = (source: string): readonly string[] =>
  findFailOpenSecretGuards(source).map((violation: PayloadViolation): string => violation.rule)

const acceptancesOf = (source: string): readonly string[] =>
  findAbsentSecretAcceptances(source).map((violation: PayloadViolation): string => violation.rule)

describe('no-fail-open-secret-guard', () => {
  it.each(['secret', 'cronSecret', 'authToken', 'apiKey', 'environment.CRON_SECRET'])(
    'reports a rejection guarded by %s truthiness',
    (credential: string) => {
      const source: string = [
        `if (${credential} && supplied !== ${credential}) {`,
        'return Response.json({}, { status: 401 })',
        '}',
      ].join(' ')
      expect(rulesOf(source)).toEqual(['no-fail-open-secret-guard'])
    },
  )

  it('reports a single-statement rejection as well as a block', () => {
    expect(rulesOf('if (secret && supplied !== secret) return unauthorized()')).toEqual([
      'no-fail-open-secret-guard',
    ])
  })

  it('stops a single statement at its newline', () => {
    const source: string = [
      'if (secret && supplied !== secret) return unauthorized()',
      'continueWork()',
    ].join('\n')
    expect(rulesOf(source)).toEqual(['no-fail-open-secret-guard'])
  })

  it('reports a throwing rejection', () => {
    expect(
      rulesOf("if (authToken && supplied !== authToken) throw new Error('forbidden')"),
    ).toEqual(['no-fail-open-secret-guard'])
  })

  it('reports the line on which the guard begins', () => {
    const findings: readonly PayloadViolation[] = findFailOpenSecretGuards(
      [
        'const value = 1',
        'if (secret && supplied !== secret) {',
        '  return unauthorized()',
        '}',
      ].join('\n'),
    )
    expect(findings[0]?.line).toBe(2)
  })
})

describe('fail-closed and unrelated conditions', () => {
  it('accepts a missing-secret rejection followed by a comparison', () => {
    const source: string = [
      'if (!secret) { return configurationError() }',
      'if (supplied !== secret) { return unauthorized() }',
    ].join('\n')
    expect(rulesOf(source)).toEqual([])
  })

  it('accepts an explicit absence comparison', () => {
    expect(rulesOf('if (secret === undefined && enabled) { return configurationError() }')).toEqual(
      [],
    )
  })

  it('does not mistake a token count for a credential', () => {
    expect(rulesOf('if (tokenCount && invalid) { return failure() }')).toEqual([])
  })

  it('does not report a conditional that performs work instead of rejecting', () => {
    expect(rulesOf('if (secret && enabled) { scheduleWork() }')).toEqual([])
  })

  it('does not report an unfinished condition another syntax gate rejects', () => {
    expect(rulesOf('if (secret && invalid')).toEqual([])
  })

  it('does not report a condition with no statement', () => {
    expect(rulesOf('if (secret && invalid)')).toEqual([])
  })

  it('does not report an unfinished block whose boundary is unknowable', () => {
    expect(rulesOf('if (secret && invalid) { return')).toEqual([])
  })

  it('does not report ordinary boolean conditions', () => {
    expect(rulesOf('if (enabled && invalid) { return failure() }')).toEqual([])
  })

  it('ignores the pattern inside a comment', () => {
    expect(rulesOf('// if (secret && invalid) return unauthorized()')).toEqual([])
  })

  it('ignores the pattern inside a string literal', () => {
    expect(rulesOf("const example = 'if (secret && invalid) return unauthorized()'")).toEqual([])
  })
})

describe('no-absent-secret-acceptance', () => {
  // The shape a real project shipped: absence tested two ways, and the answer to both is admission.
  it('reports an absence tested by comparison and by length that admits the caller', () => {
    const source: string = [
      'if (expectedSecret === undefined || expectedSecret.length === 0) {',
      'return true',
      '}',
    ].join('\n')
    expect(acceptancesOf(source)).toEqual(['no-absent-secret-acceptance'])
  })

  it.each(['secret', 'cronSecret', 'authToken', 'apiKey', 'environment.CRON_SECRET'])(
    'reports an acceptance guarded by the absence of %s',
    (credential: string) => {
      expect(acceptancesOf(`if (!${credential}) { return true }`)).toEqual([
        'no-absent-secret-acceptance',
      ])
    },
  )

  it('reports a loose comparison against null', () => {
    expect(acceptancesOf('if (secret == null) { return true }')).toEqual([
      'no-absent-secret-acceptance',
    ])
  })

  it('reports an optionally chained credential', () => {
    expect(acceptancesOf('if (!config?.apiKey) { return true }')).toEqual([
      'no-absent-secret-acceptance',
    ])
  })

  it('reports a single-statement acceptance as well as a block', () => {
    expect(acceptancesOf('if (!secret) return true')).toEqual(['no-absent-secret-acceptance'])
  })

  it('reports the line on which the guard begins', () => {
    const findings: readonly PayloadViolation[] = findAbsentSecretAcceptances(
      ['const value = 1', 'if (!secret) {', '  return true', '}'].join('\n'),
    )
    expect(findings[0]?.line).toBe(2)
  })

  it('names the credential in the finding, so the repair is unambiguous', () => {
    const findings: readonly PayloadViolation[] = findAbsentSecretAcceptances(
      'if (!cronSecret) { return true }',
    )
    expect(findings[0]?.reason).toContain('cronSecret')
  })
})

describe('what no-absent-secret-acceptance leaves alone', () => {
  // The fail-closed repair, which must stay clean: the rule reads the returned VALUE, so a rejection
  // written the same way is not a finding. If this moves with the reporting cases, the rule is wrong.
  it('accepts an absence that refuses the caller', () => {
    expect(acceptancesOf('if (!secret) { return configurationError() }')).toEqual([])
  })

  it('accepts an absence that throws', () => {
    expect(acceptancesOf("if (!secret) { throw new Error('unconfigured') }")).toEqual([])
  })

  it('accepts the whole repaired guard, absence refused and then compared', () => {
    const source: string = [
      'if (expectedSecret === undefined || expectedSecret.length === 0) {',
      'return configurationError()',
      '}',
      'return providedSecret === expectedSecret',
    ].join('\n')
    expect(acceptancesOf(source)).toEqual([])
  })

  // A conjunction narrows the branch to a case the project chose, and it is the shape the sibling
  // rule's own tests pin as fail-closed. Refusing it structurally is what keeps the two disjoint.
  it('accepts a conjunction, which is not the pure-absence shape', () => {
    expect(acceptancesOf('if (secret === undefined && enabled) { return true }')).toEqual([])
  })

  it('does not report a disjunct that tests something other than absence', () => {
    expect(acceptancesOf('if (!secret || isDevelopment) { return true }')).toEqual([])
  })

  it('does not mistake a token count for a credential', () => {
    expect(acceptancesOf('if (!tokenCount) { return true }')).toEqual([])
  })

  it('does not report an absence that names no credential', () => {
    expect(acceptancesOf('if (!enabled) { return true }')).toEqual([])
  })

  it('does not report an acceptance of something that is not an absence test', () => {
    expect(acceptancesOf('if (secret) { return true }')).toEqual([])
  })

  it('does not report an unfinished condition another syntax gate rejects', () => {
    expect(acceptancesOf('if (!secret')).toEqual([])
  })

  it('does not report a condition with no statement', () => {
    expect(acceptancesOf('if (!secret)')).toEqual([])
  })

  it('ignores the pattern inside a comment', () => {
    expect(acceptancesOf('// if (!secret) { return true }')).toEqual([])
  })

  it('ignores the pattern inside a string literal', () => {
    expect(acceptancesOf("const example = 'if (!secret) { return true }'")).toEqual([])
  })
})
