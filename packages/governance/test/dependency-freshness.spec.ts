import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  classifyFreshness,
  type DependencyStatus,
  findFreshnessViolations,
  MAJOR_FAIL_THRESHOLD,
  parseVersion,
} from '../src/dependency-freshness.js'

const makeStatus = (name: string, current: string, latest: string): DependencyStatus => ({
  name,
  owner: '.',
  current,
  latest,
})

describe('parseVersion', () => {
  it('reads the numeric core', () => {
    expect(parseVersion('16.14.2')).toEqual({ major: 16, minor: 14, patch: 2, prerelease: '' })
  })

  it('tolerates a leading range operator or v prefix', () => {
    expect(parseVersion('^17.0.0')?.major).toBe(17)
    expect(parseVersion('~4.1.0')?.minor).toBe(1)
    expect(parseVersion('>=2.5.2')?.major).toBe(2)
    expect(parseVersion('v2.5.2')?.patch).toBe(2)
  })

  it('defaults an absent minor or patch to zero', () => {
    expect(parseVersion('17')).toEqual({ major: 17, minor: 0, patch: 0, prerelease: '' })
    expect(parseVersion('4.1')).toEqual({ major: 4, minor: 1, patch: 0, prerelease: '' })
  })

  it('captures a prerelease tag and ignores build metadata', () => {
    expect(parseVersion('1.0.0-rc.1')?.prerelease).toBe('rc.1')
    expect(parseVersion('1.2.3+build.5')?.prerelease).toBe('')
  })

  it('returns undefined when there is no numeric major', () => {
    expect(parseVersion('workspace:*')).toBeUndefined()
    expect(parseVersion('link:../pkg')).toBeUndefined()
    expect(parseVersion('*')).toBeUndefined()
    expect(parseVersion('')).toBeUndefined()
  })
})

describe('classifyFreshness', () => {
  it('fails when the latest major is at least the threshold ahead', () => {
    expect(classifyFreshness('17.0.0', '19.0.0')).toBe('fail')
    expect(classifyFreshness('16.2.9', '19.0.0')).toBe('fail')
  })

  it('warns one major behind (the boundary below the threshold)', () => {
    expect(classifyFreshness('18.0.0', '19.0.0')).toBe('warn')
  })

  it('warns for a minor or patch behind the same major', () => {
    expect(classifyFreshness('2.4.0', '2.5.2')).toBe('warn')
    expect(classifyFreshness('2.5.1', '2.5.2')).toBe('warn')
  })

  it('is ok when level with or ahead of latest', () => {
    expect(classifyFreshness('2.5.2', '2.5.2')).toBe('ok')
    expect(classifyFreshness('3.0.0', '2.5.2')).toBe('ok')
  })

  it('treats 0.x on the literal major, so a minor bump only warns', () => {
    expect(classifyFreshness('0.35.2', '0.35.3')).toBe('warn')
    expect(classifyFreshness('0.35.2', '0.35.2')).toBe('ok')
    expect(classifyFreshness('0.35.2', '1.0.0')).toBe('warn')
    expect(classifyFreshness('0.35.2', '2.0.0')).toBe('fail')
  })

  it('orders a prerelease below the same core release', () => {
    expect(classifyFreshness('1.0.0-rc.1', '1.0.0')).toBe('warn')
    expect(classifyFreshness('1.0.0', '1.0.0-rc.1')).toBe('ok')
    expect(classifyFreshness('1.0.0-rc.1', '1.0.0-rc.2')).toBe('warn')
    expect(classifyFreshness('1.0.0-rc.1', '1.0.0-rc.1')).toBe('ok')
  })

  it('skips (ok) an unclassifiable current or latest', () => {
    expect(classifyFreshness('workspace:*', '19.0.0')).toBe('ok')
    expect(classifyFreshness('19.0.0', 'workspace:*')).toBe('ok')
  })

  it('classifies a biome $schema pseudo-dependency the same way', () => {
    expect(classifyFreshness('2.5.2', '2.5.2')).toBe('ok')
    expect(classifyFreshness('2.5.2', '2.6.0')).toBe('warn')
    expect(classifyFreshness('2.5.2', '4.0.0')).toBe('fail')
  })
})

describe('findFreshnessViolations', () => {
  it('partitions failures and warnings and drops ok statuses', () => {
    const report = findFreshnessViolations([
      makeStatus('graphql', '16.14.2', '17.0.1'),
      makeStatus('old', '17.0.0', '19.0.0'),
      makeStatus('fresh', '2.5.2', '2.5.2'),
    ])
    expect(report.failures).toEqual([
      { name: 'old', owner: '.', current: '17.0.0', latest: '19.0.0', verdict: 'fail' },
    ])
    expect(report.warnings).toEqual([
      { name: 'graphql', owner: '.', current: '16.14.2', latest: '17.0.1', verdict: 'warn' },
    ])
  })

  it('returns empty groups for a fully fresh set', () => {
    const report = findFreshnessViolations([makeStatus('fresh', '1.0.0', '1.0.0')])
    expect(report).toEqual({ failures: [], warnings: [] })
  })
})

// Property-based tests assert the classification invariants over every generated version pair, beyond
// the enumerated examples. The fixed global seed (vitest.setup.ts) keeps them deterministic; each `it`
// carries a concrete assertion first, since the unit scope's rule does not recognise `fc.assert`.
describe('dependency-freshness properties (fast-check)', () => {
  const smallInt = fc.integer({ min: 0, max: 40 })

  it('fails exactly when the major gap reaches the threshold', () => {
    expect(classifyFreshness('1.0.0', '3.0.0')).toBe('fail')
    fc.assert(
      fc.property(smallInt, smallInt, (currentMajor: number, latestMajor: number): boolean => {
        const verdict = classifyFreshness(
          `${String(currentMajor)}.0.0`,
          `${String(latestMajor)}.0.0`,
        )
        const shouldFail: boolean = latestMajor - currentMajor >= MAJOR_FAIL_THRESHOLD
        return (verdict === 'fail') === shouldFail
      }),
    )
  })

  it('parses the same core regardless of a leading range operator', () => {
    expect(parseVersion('^1.2.3')).toEqual(parseVersion('1.2.3'))
    fc.assert(
      fc.property(
        smallInt,
        smallInt,
        smallInt,
        fc.constantFrom('', '^', '~', '>=', 'v'),
        (major: number, minor: number, patch: number, prefix: string): boolean => {
          const core = `${String(major)}.${String(minor)}.${String(patch)}`
          return (
            JSON.stringify(parseVersion(`${prefix}${core}`)) === JSON.stringify(parseVersion(core))
          )
        },
      ),
    )
  })
})
