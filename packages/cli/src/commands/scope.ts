// `ploaness scope`: what a `delta` run's browser sweep covers in the application the command runs in,
// and why, without running anything. `--json` prints the document the `e2e` gate hands the sweep.
import { type SweepScope, scopeLines } from '@ploaness/governance'
import { isScopeFailure, sweepScopeFor } from '../change-scope.js'
import { hasOwnRuntime, type Member, memberAt, type Repository } from '../context.js'
import type { GateResult } from '../exec.js'

const JSON_INDENT: number = 2

const runtimeMembers = (repository: Repository): string =>
  repository.members
    .filter((member: Member): boolean => hasOwnRuntime(member))
    .map((member: Member): string => member.path)
    .join(', ')

/**
 * Print the change scope of the application at the working directory.
 * @param repository the repository.
 * @param isJson whether to print the scope document rather than its report.
 * @returns the process exit code.
 */
export const scope = (repository: Repository, isJson: boolean): number => {
  const member: Member | undefined = memberAt(repository, process.cwd())
  if (member === undefined || !hasOwnRuntime(member)) {
    console.error(
      `this package has no runtime of its own, so it has no browser sweep to scope; run \`ploaness scope\` ` +
        `in an application: ${runtimeMembers(repository) || 'none'}`,
    )
    return 1
  }
  const found: SweepScope | GateResult = sweepScopeFor(repository, member)
  if (isScopeFailure(found)) {
    console.error([found.summary, ...found.findings].join('\n'))
    return 1
  }
  console.info(isJson ? JSON.stringify(found, null, JSON_INDENT) : scopeLines(found).join('\n'))
  return 0
}
