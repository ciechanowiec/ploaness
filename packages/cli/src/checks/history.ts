// History gates. They read the repository rather than the build, so none of them needs a compilation and
// a freshly written commit can still be amended.
import {
  type CommitShape,
  findMergeCommits,
  type HistoryViolation,
  isNonTrivial,
  OWNED_HISTORY_REVISIONS,
  type ParsedMessage,
  parseMessage,
  parseNumstat,
  type SquashMergePolicy,
  type SquashVerdict,
  settleSquashSubject,
  validateMessage,
} from '@ploaness/governance'
import { type Context, git } from '../context.js'
import { failed, type GateResult, passed } from '../exec.js'

const nonEmptyLines = (raw: string): readonly string[] =>
  raw.split('\n').filter((line: string): boolean => line.trim().length > 0)

// One line per commit: its hash, then the hashes of its parents. One walk yields both the commits to
// judge and how many parents each has, and counting the parents git recorded is what makes the squash
// rule unforgeable, exactly as it makes the linear-history rule so.
const parentsOf = (
  context: Context,
  revisionArguments: readonly string[],
): ReadonlyMap<string, number> =>
  new Map<string, number>(
    nonEmptyLines(git(context, ['rev-list', '--parents', ...revisionArguments])).map(
      (line: string): readonly [string, number] => {
        const hashes: readonly string[] = line.trim().split(' ')
        return [hashes[0] ?? '', Math.max(0, hashes.length - 1)]
      },
    ),
  )

// The commits the declared branch reaches. Both spellings of the branch are consulted because in CI it
// is usually only a remote-tracking ref: a full-depth checkout of a pull request brings `origin/main`
// and no local `main`. A branch present under neither yields an empty set, so every prefixed commit is
// then a finding naming the branch rather than a pass nothing verified.
const branchCommits = (context: Context, branch: string): ReadonlySet<string> => {
  const references: readonly string[] = nonEmptyLines(
    git(context, [
      'for-each-ref',
      '--format=%(refname)',
      `refs/heads/${branch}`,
      `refs/remotes/*/${branch}`,
    ]),
  )
  return new Set<string>(
    references.length === 0 ? [] : nonEmptyLines(git(context, ['rev-list', ...references])),
  )
}

/** Extended verification walks every commit, so a shallow clone is rejected up front. */
// Enough of a commit hash to identify it in a report without filling the line.
const SHORT_SHA_LENGTH: number = 9

export const requireFullHistory = (context: Context): GateResult => {
  try {
    return git(context, ['rev-parse', '--is-shallow-repository']) === 'true'
      ? failed('the repository is shallow', [
          'the history gates walk every commit; check out with full depth (fetch-depth: 0 in CI)',
        ])
      : passed('the full history is present')
  } catch {
    return failed('this is not a git repository', ['ploaness governs a versioned working tree'])
  }
}

/**
 * Validate commit messages. Every commit is held to every rule, including the ones git writes for you: a
 * merge, a revert, or an autosquash subject must be given a conforming form by hand.
 *
 * It walks the same refs `linearHistory` does, and the default is the shared constant rather than a
 * literal so the two cannot drift apart. Walking only HEAD was the earlier spelling and it left a hole
 * this repository's own rules describe: a branch off HEAD's ancestry is history the repository owns and
 * can rewrite, so a banned message there is a violation nothing reported. A real project carried an
 * agent-attribution trailer on such a branch past a passing gate.
 */
export const commitHistory = (
  context: Context,
  revisionArguments: readonly string[] = OWNED_HISTORY_REVISIONS,
): GateResult => {
  const parents: ReadonlyMap<string, number> = parentsOf(context, revisionArguments)
  // The one prefix set aside, where the declared platform wrote it. The branch is walked once for the
  // whole run rather than asked about per commit, and not at all for a project that declared no platform.
  const policy: SquashMergePolicy | undefined = context.settings.squashMerges
  const onBranch: ReadonlySet<string> =
    policy === undefined ? new Set<string>() : branchCommits(context, policy.branch)
  const findings: readonly string[] = [...parents].flatMap(
    ([sha, parentCount]: readonly [string, number]): readonly string[] => {
      const message: ParsedMessage = parseMessage(
        git(context, ['log', '--format=%B', '-n', '1', sha]),
      )
      const subject: SquashVerdict = settleSquashSubject(
        { header: message.header, parentCount, isOnBranch: onBranch.has(sha) },
        policy,
      )
      const isBodyRequired: boolean = isNonTrivial(
        parseNumstat(git(context, ['show', '--numstat', '--format=', sha])),
      )
      return [
        ...subject.problems,
        ...validateMessage({ header: subject.header, body: message.body }, isBodyRequired),
      ].map((problem: string): string => `${sha.slice(0, SHORT_SHA_LENGTH)} ${problem}`)
    },
  )
  return findings.length > 0
    ? failed(
        `${String(findings.length)} commit-message problem(s) across ${String(parents.size)} commit(s)`,
        findings,
      )
    : passed(`${String(parents.size)} commit message(s) conform`)
}

/** Validate one pending message, from a message file the author points at. */
export const commitMessageProblems = (context: Context, raw: string): readonly string[] => {
  const isRequireBody: boolean = isNonTrivial(
    parseNumstat(git(context, ['diff', '--cached', '--numstat'])),
  )
  return validateMessage(parseMessage(raw), isRequireBody)
}

// One line per commit: the commit hash followed by its parent hashes, all space separated. Counting the
// parents git recorded is what makes the rule unforgeable: a subject that mentions merging is an ordinary
// commit, and rewording a merge does not hide it.
const PARENT_FORMAT: string = '--format=%H %P'

/** The history is linear: a merge commit is prohibited wherever this repository owns it. */
export const linearHistory = (context: Context): GateResult => {
  const commits: readonly CommitShape[] = nonEmptyLines(
    git(context, ['log', ...OWNED_HISTORY_REVISIONS, PARENT_FORMAT]),
  ).map((line: string): CommitShape => {
    const hashes: readonly string[] = line.trim().split(' ')
    return {
      sha: hashes[0] ?? '',
      subject: '',
      parentCount: Math.max(0, hashes.length - 1),
    }
  })
  const violations: readonly HistoryViolation[] = findMergeCommits(
    commits.map(
      (commit: CommitShape): CommitShape => ({
        ...commit,
        subject:
          commit.parentCount > 1 ? git(context, ['log', '--format=%s', '-n', '1', commit.sha]) : '',
      }),
    ),
  )
  return violations.length > 0
    ? failed(
        `${String(violations.length)} merge commit(s) in the history`,
        violations.map(
          (violation: HistoryViolation): string =>
            `${violation.sha.slice(0, SHORT_SHA_LENGTH)} ${violation.reason}`,
        ),
      )
    : passed(`${String(commits.length)} commit(s) form a linear history`)
}
