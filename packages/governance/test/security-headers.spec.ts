import { describe, expect, it } from 'vitest'
import { securityHeaderProblems } from '../src/security-headers.js'

const baseline: Readonly<Record<string, string>> = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'content-security-policy': "script-src 'self'; frame-ancestors 'none'",
}

describe('shared HTML header baseline', () => {
  it('accepts the baseline and the default-src fallback', () => {
    expect(securityHeaderProblems(baseline)).toEqual([])
    expect(
      securityHeaderProblems({
        ...baseline,
        'content-security-policy': "default-src 'self'",
        'x-frame-options': 'DENY',
      }),
    ).toEqual([])
  })
  it('reports missing decisions and refuses inline script', () => {
    expect(securityHeaderProblems({})).toHaveLength(5)
    expect(
      securityHeaderProblems({
        ...baseline,
        'content-security-policy': "script-src 'unsafe-inline'; frame-ancestors 'none'",
      }),
    ).toEqual([expect.stringContaining('unsafe-inline')])
  })
  it('does not mistake a longer directive name for script-src', () => {
    expect(securityHeaderProblems({ ...baseline, 'content-security-policy': "script-src-elem 'self'" })).toContain(
      'constrain script through script-src or default-src',
    )
  })
  it('preserves the existing decision-only treatment of an empty source list', () => {
    expect(securityHeaderProblems({ ...baseline, 'content-security-policy': 'script-src; frame-ancestors' })).toEqual(
      [],
    )
  })
})
