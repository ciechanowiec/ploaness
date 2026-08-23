// The git-hook entry points. A hook must be fast enough that a developer does not learn to pass
// --no-verify, so the pre-commit path runs only the two checks that catch most of what a commit gets
// wrong, and CI remains the backstop for everything else.
import { readFileSync } from 'node:fs'
import { commitHistory, commitMessageProblems } from '../checks/history.js'
import { type Context, resolveTool } from '../context.js'
import { type RunResult, runNode } from '../exec.js'

/** The pre-commit hook: formatting on staged files, then a full type check. */
export const precommit = (context: Context): number => {
  const biome: RunResult = runNode(
    resolveTool('@biomejs/biome', 'biome'),
    ['check', '--staged', '--no-errors-on-unmatched'],
    { cwd: context.root },
  )
  if (biome.code !== 0) {
    console.error(biome.output)
    return 1
  }
  const types: RunResult = runNode(
    resolveTool('typescript', 'tsc'),
    ['--noEmit', '-p', 'tsconfig.json'],
    {
      cwd: context.root,
    },
  )
  if (types.code !== 0) {
    console.error(types.output)
    return 1
  }
  console.info('ploaness precommit: staged formatting and the type check are clean.')
  return 0
}

/**
 * The commit-message entry point, in three modes: a pending message file (the commit-msg hook), a
 * revision range, or the whole history.
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
