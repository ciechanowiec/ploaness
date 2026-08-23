// History-shape policy. The history is linear, so a merge commit is prohibited
// wherever it sits, including between two side branches: a branch takes the work of another by rebase or
// cherry-pick. The check counts the parents git recorded rather than reading the subject, so a commit
// that merely mentions merging is an ordinary commit, and rewording a merge does not hide it.
//
// The rule reaches back to the first commit and has no exception. Avoid a merge rather than plan to
// repair one: once it is published, only a fresh history satisfies the rule.

/** One commit reduced to the facts the history-shape rule needs. */
export interface CommitShape {
  readonly sha: string
  readonly subject: string
  readonly parentCount: number
}

/** A commit that breaks the linear-history rule. */
export interface HistoryViolation {
  readonly sha: string
  readonly reason: string
}

/**
 * Return every merge commit reachable from the tip.
 * @param commits the history, each with the number of parents git recorded.
 * @returns one violation per merge commit; empty means the history is linear.
 */
export const findMergeCommits = (commits: readonly CommitShape[]): readonly HistoryViolation[] =>
  commits
    .filter((commit: CommitShape): boolean => commit.parentCount > 1)
    .map(
      (commit: CommitShape): HistoryViolation => ({
        sha: commit.sha,
        reason: `merge commit with ${commit.parentCount} parents ("${commit.subject}"); rebase or cherry-pick instead`,
      }),
    )
