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
  validateMessage,
} from '@ploaness/governance'
import { type Context, git } from '../context.js'
import { failed, type GateResult, passed } from '../exec.js'

const nonEmptyLines = (raw: string): readonly string[] =>
  raw.split('\n').filter((line: string): boolean => line.trim().length > 0)

const shasOf = (context: Context, revisionArguments: readonly string[]): readonly string[] =>
  nonEmptyLines(git(context, ['rev-list', ...revisionArguments]))

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
 */
export const commitHistory = (
  context: Context,
  revisionArguments: readonly string[] = ['HEAD'],
): GateResult => {
  const shas: readonly string[] = shasOf(context, revisionArguments)
  const findings: readonly string[] = shas.flatMap((sha: string): readonly string[] => {
    const message: ParsedMessage = parseMessage(
      git(context, ['log', '--format=%B', '-n', '1', sha]),
    )
    const isBodyRequired: boolean = isNonTrivial(
      parseNumstat(git(context, ['show', '--numstat', '--format=', sha])),
    )
    return validateMessage(message, isBodyRequired).map(
      (problem: string): string => `${sha.slice(0, SHORT_SHA_LENGTH)} ${problem}`,
    )
  })
  return findings.length > 0
    ? failed(
        `${String(findings.length)} commit-message problem(s) across ${String(shas.length)} commit(s)`,
        findings,
      )
    : passed(`${String(shas.length)} commit message(s) conform`)
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
