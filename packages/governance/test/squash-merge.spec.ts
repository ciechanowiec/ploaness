import { describe, expect, it } from 'vitest'
import { validateMessage } from '../src/commit-message.js'
import {
  isSquashPlatform,
  SQUASH_PLATFORMS,
  type SquashCandidate,
  type SquashMergePolicy,
  type SquashVerdict,
  settleSquashSubject,
} from '../src/squash-merge.js'

const policy: SquashMergePolicy = { platform: 'azure-devops', branch: 'main' }
const title: string = 'feat(fixture): add the ploaness integration consumer'
const written: string = `Merged PR 73750: ${title}`

describe('settleSquashSubject', () => {
  it('sets the prefix aside on a one-parent commit on the declared branch', () => {
    const verdict: SquashVerdict = settleSquashSubject(
      { header: written, parentCount: 1, isOnBranch: true },
      policy,
    )
    expect(verdict).toEqual({ header: title, problems: [] })
  })

  it('leaves a header without the prefix as written, under a policy or none', () => {
    const candidate: SquashCandidate = { header: title, parentCount: 1, isOnBranch: true }
    expect(settleSquashSubject(candidate, policy)).toEqual({ header: title, problems: [] })
    expect(settleSquashSubject(candidate, undefined)).toEqual({ header: title, problems: [] })
  })

  it("keeps the prefix as the author's own when no platform is declared", () => {
    const verdict: SquashVerdict = settleSquashSubject(
      { header: written, parentCount: 1, isOnBranch: true },
      undefined,
    )
    expect(verdict.header).toBe(written)
    expect(validateMessage({ header: written, body: '' }, false).join('\n')).toContain(
      'invalid header',
    )
  })

  it('reports the prefix on a merge commit, whatever the subject says', () => {
    const verdict: SquashVerdict = settleSquashSubject(
      { header: written, parentCount: 2, isOnBranch: true },
      policy,
    )
    expect(verdict.problems).toHaveLength(1)
    expect(verdict.problems[0]).toContain('has 2 parent(s)')
  })

  it('reports the prefix off the declared branch, naming the branch', () => {
    const verdict: SquashVerdict = settleSquashSubject(
      { header: written, parentCount: 1, isOnBranch: false },
      { ...policy, branch: 'trunk' },
    )
    expect(verdict.problems).toHaveLength(1)
    expect(verdict.problems[0]).toContain('is not on trunk')
  })

  it('still returns the remainder when the prefix was illegitimate, so every defect is reported once', () => {
    const verdict: SquashVerdict = settleSquashSubject(
      { header: written, parentCount: 2, isOnBranch: false },
      policy,
    )
    expect(verdict.header).toBe(title)
    expect(verdict.problems).toHaveLength(2)
  })

  it('holds the remainder to the header ceiling, not the prefixed line', () => {
    const long: string = `ci(pipeline): ${'a'.repeat(58)}`
    expect(long).toHaveLength(72)
    const verdict: SquashVerdict = settleSquashSubject(
      { header: `Merged PR 1: ${long}`, parentCount: 1, isOnBranch: true },
      policy,
    )
    expect(validateMessage({ header: verdict.header, body: '' }, false)).toEqual([])
  })

  it.each([
    ['a prefix without a number', 'Merged PR : feat(x): do a real thing here'],
    ['a prefix without the colon', 'Merged PR 12 feat(x): do a real thing here'],
    ['the prefix not at the start', `x ${written}`],
  ])('does not recognise %s', (_kind, header) => {
    expect(settleSquashSubject({ header, parentCount: 1, isOnBranch: true }, policy).header).toBe(
      header,
    )
  })
})

describe('isSquashPlatform', () => {
  it('accepts every platform the catalogue names and nothing else', () => {
    for (const platform of SQUASH_PLATFORMS) {
      expect(isSquashPlatform(platform)).toBe(true)
    }
    expect(isSquashPlatform('github')).toBe(false)
    expect(isSquashPlatform(undefined)).toBe(false)
  })
})
