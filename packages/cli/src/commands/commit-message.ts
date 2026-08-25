// The commit-message validator. It is a plain command rather than a git hook: ploaness enforces no
// hooks, because a hook is local, opt-in, and bypassable with --no-verify, so CI is the only place a
// rule can actually be held. `commit-history` runs the same policy as a gate.
import { existsSync, readFileSync } from 'node:fs'
import { commitHistory, commitMessageProblems } from '../checks/history.js'
import type { Context } from '../context.js'
import type { GateResult } from '../exec.js'

/**
 * The commit-message entry point, in three modes: a message file, a revision range, or the whole
 * history.
 */
/** Report a run of findings under a closing line, and return the failing exit code. */
const reportProblems = (findings: readonly string[], summary: string): number => {
  for (const finding of findings) {
    console.error(finding)
  }
  console.error(`\n${summary}. See .ploaness/agent-guide.md.`)
  return 1
}

/** Check the messages already in the history, either a range or all of it. */
const checkHistory = (context: Context, revisions: readonly string[]): number => {
  const result: GateResult = commitHistory(context, revisions)
  if (!result.ok) {
    return reportProblems(result.findings, result.summary)
  }
  console.info(result.summary)
  return 0
}

/** Check one pending message, read from the file the author points at. */
const checkPending = (context: Context, file: string): number => {
  // A hook invokes this with a path git supplies, and a mistyped mode reaches it as a filename. Either
  // way an absent file is a thing to say, not a stack trace to print.
  if (!existsSync(file)) {
    return reportProblems([`no such file: ${file}`], 'the commit message could not be read')
  }
  const problems: readonly string[] = commitMessageProblems(context, readFileSync(file, 'utf8'))
  return problems.length > 0
    ? reportProblems(problems, `${String(problems.length)} commit-message problem(s)`)
    : 0
}

/**
 * The commit-message entry point, in three modes: a message file, a revision range, or the whole
 * history.
 * @param context the resolved project environment.
 * @param mode a message file path, `--range`, or `--all`.
 * @param value the revision range, when mode is `--range`.
 * @returns the process exit code.
 */
export const commitMessage = (
  context: Context,
  mode: string | undefined,
  value: string | undefined,
): number => {
  if (mode === undefined) {
    console.error('usage: ploaness commit-message <message-file> | --range <base>..<head> | --all')
    return 1
  }
  if (mode === '--all') {
    return checkHistory(context, ['HEAD'])
  }
  if (mode === '--range') {
    return checkHistory(context, [value ?? 'HEAD'])
  }
  return checkPending(context, mode)
}
