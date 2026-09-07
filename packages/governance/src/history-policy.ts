// Judge Git parent counts rather than commit subjects, so rewording cannot conceal a merge.

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
        reason:
          `merge commit with ${String(commit.parentCount)} parents ` +
          `("${commit.subject}"); rebase or cherry-pick instead`,
      }),
    )

// Which refs a history gate may judge. `--all` was the obvious spelling and the wrong one: git defines it
// as every ref under `refs/` plus HEAD, so it also walks `refs/remotes/`, which mirrors branches on a
// server this repository cannot rewrite, and `refs/notes/`, whose commit messages git writes rather than
// an author. Failing there asks a project to force-push a teammate's unmerged topic branch, and a fetch
// restores whatever it rewrote. Narrowing loses no violation: work on such a branch reaches a local branch
// the moment it lands, and is judged there.

/** The ref namespaces a revision argument reaches, as git defines them. */
const NAMESPACES_BY_REVISION: Readonly<Record<string, readonly string[]>> = {
  '--all': ['refs/heads/', 'refs/tags/', 'refs/remotes/', 'refs/notes/'],
  '--branches': ['refs/heads/'],
  '--remotes': ['refs/remotes/'],
  '--tags': ['refs/tags/'],
  HEAD: ['refs/heads/'],
}

/** Namespaces holding history this repository cannot rewrite, or did not write. */
const UNOWNED_NAMESPACES: ReadonlySet<string> = new Set<string>(['refs/notes/', 'refs/remotes/'])

/**
 * Report the ref namespaces a revision argument reaches.
 * @param revision one revision argument, as passed to `git log`.
 * @returns the namespaces it selects; empty when the argument names no namespace.
 */
export const namespacesReachedBy = (revision: string): readonly string[] =>
  NAMESPACES_BY_REVISION[revision] ?? []

/**
 * Decide whether a ref namespace holds history this repository owns.
 * @param namespace a ref namespace, slash-terminated.
 * @returns true when a commit there is the repository's to rewrite.
 */
export const isOwnedNamespace = (namespace: string): boolean => !UNOWNED_NAMESPACES.has(namespace)

/** The revisions a history gate walks: every commit this repository owns, and no other. */
export const OWNED_HISTORY_REVISIONS: readonly string[] = ['--branches', '--tags', 'HEAD']
