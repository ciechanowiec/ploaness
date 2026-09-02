import { describe, expect, it } from 'vitest'
import type { PayloadViolation } from '../src/payload-source.js'
import { findFailOpenSecretGuards } from '../src/source-security.js'

const rulesOf = (source: string): readonly string[] =>
  findFailOpenSecretGuards(source).map((violation: PayloadViolation): string => violation.rule)

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
