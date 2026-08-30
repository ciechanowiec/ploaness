// The environment-coherence gate. It reads four kinds of file and calls one pure function; every
// decision is in packages/governance/src/environment-coherence.ts.
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import {
  type ComposeProject,
  composeProjectsIn,
  ENVIRONMENT_EXAMPLE_FILES,
  type EnvironmentViolation,
  findEnvironmentViolations,
  VALIDATED_ENVIRONMENT_MODULE,
  type WorkflowFile,
} from '@ploaness/governance'

import { type Member, type Repository as Repo, workingTreeFiles } from '../context.js'
import { failed, type GateResult, passed } from '../exec.js'

const WORKFLOW_DIRECTORY: string = path.join('.github', 'workflows')
const WORKFLOW_SUFFIXES: readonly string[] = ['.yml', '.yaml']

const readIfPresent = (root: string, relativePath: string): string | undefined => {
  const file: string = path.join(root, relativePath)
  return existsSync(file) ? readFileSync(file, 'utf8') : undefined
}

const isPresent = (value: string | undefined): value is string => value !== undefined

// One example file per repository, taken in the declared order. A project that ships two has documented
// its environment twice and the first is the one a reader is pointed at, so reading both would let the
// weaker copy vouch for the stronger.
const exampleFile = (repository: Repo): string | undefined =>
  ENVIRONMENT_EXAMPLE_FILES.map((candidate: string): string | undefined =>
    readIfPresent(repository.root, candidate),
  ).find(isPresent)

// Per member, because a workspace holds one validated module per application, and a member that is a
// library has none.
const appSources = (repository: Repo): readonly string[] =>
  repository.members
    .map((member: Member): string | undefined =>
      readIfPresent(repository.root, path.join(member.path, VALIDATED_ENVIRONMENT_MODULE)),
    )
    .filter(isPresent)

const composeSources = (repository: Repo): readonly string[] =>
  composeProjectsIn(workingTreeFiles(repository.root)).map((project: ComposeProject): string =>
    readFileSync(path.join(repository.root, project.file), 'utf8'),
  )

// Discovered from the working tree rather than listed, for the reason `scripts/verify.sh` records about
// its own shell scripts: an enumeration is correct only at the moment it is written, and a workflow
// added later would be a workflow nothing reads.
const workflows = (repository: Repo): readonly WorkflowFile[] =>
  workingTreeFiles(repository.root)
    .filter(
      (file: string): boolean =>
        file.startsWith(`${WORKFLOW_DIRECTORY}${path.sep}`) &&
        WORKFLOW_SUFFIXES.some((suffix: string): boolean => file.endsWith(suffix)),
    )
    .map(
      (file: string): WorkflowFile => ({
        file,
        content: readFileSync(path.join(repository.root, file), 'utf8'),
      }),
    )

const describe = (violation: EnvironmentViolation): string =>
  `${violation.name}: ${violation.reason}`

/**
 * Every environment variable the repository declares in one place reaches the others it has to.
 *
 * A repository that reads no variable, ships no compose file, and runs no verifying workflow passes over
 * an empty set rather than being declared inapplicable - the same shape the container gate takes, and
 * for the same reason: the day one of those appears it is already checked.
 * @param repository the repository being judged, and the members whose modules it holds.
 * @returns the gate result.
 */
export const environment = (repository: Repo): GateResult => {
  const violations: readonly EnvironmentViolation[] = findEnvironmentViolations({
    applicationSources: appSources(repository),
    example: exampleFile(repository),
    composeSources: composeSources(repository),
    workflows: workflows(repository),
  })
  return violations.length > 0
    ? failed(
        `${String(violations.length)} environment variable(s) are declared in one place and missing from another`,
        violations.map((violation: EnvironmentViolation): string => describe(violation)),
      )
    : passed('every declared environment variable reaches the places that need it')
}
