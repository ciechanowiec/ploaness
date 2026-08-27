// Discovery, exercised against file lists no repository has to be built to produce.
//
// The case that matters is `cms/docker-compose.yml`: the gate used to look for a compose file at the
// repository root alone, so a real Payload project had its Dockerfile linted and its compose file read
// by nothing at all, behind a passing verdict.
import { describe, expect, it } from 'vitest'
import {
  type ComposeProject,
  composeProjectsIn,
  dockerfilesIn,
  isComposeFile,
  isDockerfile,
} from '../src/container-files.js'

describe('isDockerfile', (): void => {
  it('acceptsEveryConventionalSpelling', (): void => {
    expect(
      ['Dockerfile', 'api.Dockerfile', 'Dockerfile.debug'].every((file: string): boolean =>
        isDockerfile(file),
      ),
    ).toBe(true)
  })

  it('rejectsAFileThatMerelyMentionsDocker', (): void => {
    expect(isDockerfile('docs/Dockerfile-guide.md')).toBe(false)
  })
})

describe('dockerfilesIn', (): void => {
  it('findsADockerfileOutsideTheRepositoryRoot', (): void => {
    expect(dockerfilesIn(['cms/pgadmin/Dockerfile', 'README.md'])).toStrictEqual([
      'cms/pgadmin/Dockerfile',
    ])
  })

  // The order is the report's, not the tree's: `git ls-files` order is not a promise, and a findings
  // list that reorders between machines reads as a change nobody made.
  it('ordersTheReportIndependentlyOfTheTreeOrder', (): void => {
    expect(
      dockerfilesIn(['fe/Dockerfile', 'cms/pgadmin/Dockerfile', 'api.Dockerfile']),
    ).toStrictEqual(['api.Dockerfile', 'cms/pgadmin/Dockerfile', 'fe/Dockerfile'])
  })
})

describe('isComposeFile', (): void => {
  it('acceptsTheFourNamesComposeReadsOnItsOwn', (): void => {
    expect(
      ['compose.yaml', 'compose.yml', 'docker-compose.yaml', 'docker-compose.yml'].every(
        (file: string): boolean => isComposeFile(file),
      ),
    ).toBe(true)
  })

  // An override is merged into the project its base file defines. Discovering it as a project of its own
  // would hand compose a fragment to validate alone and report a defect the project does not have.
  it('rejectsAnOverrideFile', (): void => {
    expect(isComposeFile('docker-compose.override.yml')).toBe(false)
  })
})

describe('composeProjectsIn', (): void => {
  // The defect this module exists for: discovery that looked at the repository root alone validated
  // nothing in a project that keeps its application, and its compose file, in a member directory.
  it('findsAComposeProjectInAMemberDirectory', (): void => {
    expect(composeProjectsIn(['cms/docker-compose.yml', 'fe/package.json'])).toStrictEqual([
      { directory: 'cms', file: 'cms/docker-compose.yml' },
    ])
  })

  it('namesTheRootProjectWithAnEmptyDirectory', (): void => {
    expect(composeProjectsIn(['compose.yaml'])).toStrictEqual([
      { directory: '', file: 'compose.yaml' },
    ])
  })

  // One directory is one project however many files compose merges there, because that is the unit
  // `docker compose config` validates.
  it('reportsOneProjectPerDirectory', (): void => {
    const projects: readonly ComposeProject[] = composeProjectsIn([
      'cms/docker-compose.yml',
      'cms/docker-compose.override.yml',
    ])
    expect(projects).toHaveLength(1)
  })

  it('prefersTheNameComposeItselfPrefers', (): void => {
    expect(composeProjectsIn(['cms/docker-compose.yml', 'cms/compose.yaml'])).toStrictEqual([
      { directory: 'cms', file: 'cms/compose.yaml' },
    ])
  })

  it('findsEveryProjectWhenAWorkspaceHasSeveral', (): void => {
    expect(
      composeProjectsIn(['fe/compose.yml', 'cms/docker-compose.yml', 'compose.yaml']).map(
        (project: ComposeProject): string => project.directory,
      ),
    ).toStrictEqual(['', 'cms', 'fe'])
  })
})
