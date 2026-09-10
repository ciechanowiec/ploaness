// The environment-coherence gate. It reads five kinds of file and calls one pure function; every
// decision is in packages/governance/src/environment-coherence.ts.
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import {
  BUILD_CONFIGURATION_FILES,
  type ComposeProject,
  composeProjectsIn,
  type DockerfileSource,
  dockerfilesBuilding,
  dockerfilesIn,
  ENVIRONMENT_EXAMPLE_FILES,
  type EnvironmentViolation,
  findEnvironmentViolations,
  type ImageBuild,
  VALIDATED_ENVIRONMENT_MODULE,
  type WorkflowFile,
  workflowsIn,
} from '@ploaness/governance'

import { type Member, type Repository as Repo, workingTreeFiles } from '../context.js'
import { failed, type GateResult, passed } from '../exec.js'

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

// Discovered by the same rule the blocklist gate reads workflows by, so the two never disagree about
// what a workflow is.
const workflows = (repository: Repo): readonly WorkflowFile[] =>
  workflowsIn(workingTreeFiles(repository.root)).map(
    (file: string): WorkflowFile => ({
      file,
      content: readFileSync(path.join(repository.root, file), 'utf8'),
    }),
  )

// Discovered by the same rule the container gate reads Dockerfiles by, for the same reason.
const dockerfileSources = (repository: Repo): readonly DockerfileSource[] =>
  dockerfilesIn(workingTreeFiles(repository.root)).map(
    (file: string): DockerfileSource => ({
      file,
      content: readFileSync(path.join(repository.root, file), 'utf8'),
    }),
  )

// The files whose reads a build inlines: the validated module, and the framework configuration at the
// member's own root. Per member, because an image is built per member - what one member's build inlines
// says nothing about the arguments a sibling's image declares.
const BUILD_SOURCE_FILES: readonly string[] = [
  VALIDATED_ENVIRONMENT_MODULE,
  ...BUILD_CONFIGURATION_FILES,
]

const builds = (repository: Repo): readonly ImageBuild[] => {
  const dockerfiles: readonly DockerfileSource[] = dockerfileSources(repository)
  const memberPaths: readonly string[] = repository.members.map(
    (member: Member): string => member.path,
  )
  return repository.members.map(
    (member: Member): ImageBuild => ({
      sources: BUILD_SOURCE_FILES.map((relative: string): string | undefined =>
        readIfPresent(repository.root, path.join(member.path, relative)),
      ).filter(isPresent),
      dockerfiles: dockerfilesBuilding(member.path, memberPaths, dockerfiles),
    }),
  )
}

const describe = (violation: EnvironmentViolation): string =>
  `${violation.name}: ${violation.reason}`

/**
 * Every environment variable the repository declares in one place reaches the others it has to.
 *
 * A repository that reads no variable, ships no compose file, builds no image, and runs no verifying
 * workflow passes over an empty set rather than being declared inapplicable - the same shape the
 * container gate takes, and for the same reason: the day one of those appears it is already checked.
 * @param repository the repository being judged, and the members whose modules it holds.
 * @returns the gate result.
 */
export const environment = (repository: Repo): GateResult => {
  const violations: readonly EnvironmentViolation[] = findEnvironmentViolations({
    applicationSources: appSources(repository),
    example: exampleFile(repository),
    composeSources: composeSources(repository),
    workflows: workflows(repository),
    builds: builds(repository),
  })
  return violations.length > 0
    ? failed(
        `${String(violations.length)} environment variable(s) are declared in one place and missing from another`,
        violations.map((violation: EnvironmentViolation): string => describe(violation)),
      )
    : passed('every declared environment variable reaches the places that need it')
}
