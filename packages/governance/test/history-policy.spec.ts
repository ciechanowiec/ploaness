import { describe, expect, it } from 'vitest'
import { type CommitShape, findMergeCommits } from '../src/history-policy.js'

const commit = (overrides: Partial<CommitShape> = {}): CommitShape => ({
  sha: 'abcdef1234',
  subject: 'feat(x): add a real capability',
  parentCount: 1,
  ...overrides,
})

describe('findMergeCommits', () => {
  it('accepts a linear history', () => {
    expect(findMergeCommits([commit(), commit({ sha: 'b' })])).toEqual([])
  })

  it('accepts the root commit, which has no parent', () => {
    expect(findMergeCommits([commit({ parentCount: 0 })])).toEqual([])
  })

  it('flags a merge commit by its parent count, not its subject', () => {
    const found = findMergeCommits([commit({ parentCount: 2, subject: 'chore: routine work' })])
    expect(found).toHaveLength(1)
    expect(found[0]?.reason).toContain('2 parents')
  })

  it('does not flag an ordinary commit that merely mentions merging', () => {
    expect(findMergeCommits([commit({ subject: 'docs: explain the merge policy' })])).toEqual([])
  })
})
