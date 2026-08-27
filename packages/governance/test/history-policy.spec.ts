import { describe, expect, it } from 'vitest'
import {
  type CommitShape,
  findMergeCommits,
  type HistoryViolation,
  isOwnedNamespace,
  namespacesReachedBy,
  OWNED_HISTORY_REVISIONS,
} from '../src/history-policy.js'

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
    const found: readonly HistoryViolation[] = findMergeCommits([
      commit({ parentCount: 2, subject: 'chore: routine work' }),
    ])
    expect(found).toHaveLength(1)
    expect(found[0]?.reason).toContain('2 parents')
  })

  it('does not flag an ordinary commit that merely mentions merging', () => {
    expect(findMergeCommits([commit({ subject: 'docs: explain the merge policy' })])).toEqual([])
  })
})

const namespacesOf = (revisions: readonly string[]): readonly string[] =>
  revisions.flatMap((revision: string): readonly string[] => namespacesReachedBy(revision))

const unownedNamespacesOf = (revisions: readonly string[]): readonly string[] =>
  namespacesOf(revisions).filter((namespace: string): boolean => !isOwnedNamespace(namespace))

describe('theRevisionsAHistoryGateWalks', () => {
  it('reachesNoRefTheRepositoryCannotRewrite', () => {
    expect(unownedNamespacesOf(OWNED_HISTORY_REVISIONS)).toStrictEqual([])
  })

  // Containing `refs/heads/` was the earlier assertion and a bare `HEAD` satisfies it, which is how the
  // message gate came to walk one branch while claiming the whole history. The complete owned set is
  // derived from the table rather than restated, so a namespace added there is covered on the next run.
  it('reachesEveryNamespaceTheRepositoryOwns', () => {
    const owned: readonly string[] = namespacesReachedBy('--all').filter(isOwnedNamespace)
    expect(owned.length).toBeGreaterThan(1)
    for (const namespace of owned) {
      expect(namespacesOf(OWNED_HISTORY_REVISIONS)).toContain(namespace)
    }
  })

  // An argument the table cannot describe reaches nothing, so a revision added to the list without being
  // described here would satisfy the ownership assertion while walking anything at all.
  it('reportsNoReachForAnArgumentItCannotDescribe', () => {
    expect(namespacesReachedBy('--glob=refs/remotes/*')).toStrictEqual([])
  })

  // Which is what closes that hole: every revision the gates walk has to be one the table describes.
  it('namesOnlyRevisionsWhoseReachIsDescribed', () => {
    const undescribed: readonly string[] = OWNED_HISTORY_REVISIONS.filter(
      (revision: string): boolean => namespacesReachedBy(revision).length === 0,
    )
    expect(undescribed).toStrictEqual([])
  })

  // Guards the premise: were every namespace owned, the assertion above would pass while saying nothing.
  // `--all` is the spelling this rule exists to reject, so it has to fail the same test.
  it('wouldRejectTheAllArgumentThatWalkedAServersRefs', () => {
    expect(unownedNamespacesOf(['--all'])).toContain('refs/remotes/')
  })
})
