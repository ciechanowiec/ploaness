// The commit-message validator. It is a plain command rather than a git hook: ploaness enforces no
// hooks, because a hook is local, opt-in, and bypassable with --no-verify, so CI is the only place a
// rule can actually be held. `commit-history` runs the same policy as a gate.
import { readFileSync } from 'node:fs'
import { commitHistory, commitMessageProblems } from '../checks/history.js'
import type { Context } from '../context.js'

/**
 * The commit-message entry point, in three modes: a message file, a revision range, or the whole
 * history.
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
  if (mode === '--all' || mode === '--range') {
    const revisions: readonly string[] = mode === '--all' ? ['HEAD'] : [value ?? 'HEAD']
    const result = commitHistory(context, revisions)
    if (!result.ok) {
      for (const finding of result.findings) {
        console.error(finding)
      }
      console.error(`\n${result.summary}. See .ploaness/agent-guide.md.`)
      return 1
    }
    console.info(result.summary)
    return 0
  }
  const problems: readonly string[] = commitMessageProblems(context, readFileSync(mode, 'utf8'))
  if (problems.length > 0) {
    for (const problem of problems) {
      console.error(problem)
    }
    console.error(`\n${problems.length} commit-message problem(s). See .ploaness/agent-guide.md.`)
    return 1
  }
  return 0
}
