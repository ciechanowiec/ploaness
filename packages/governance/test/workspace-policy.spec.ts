import { describe, expect, it } from 'vitest'
import {
  findGovernedMembers,
  findPayloadMemberViolations,
  findRepositoryRoot as findRepoRoot,
  findServerUrlCollisions,
  findUngovernedProjects,
  type MemberShape,
  type ProjectManifest,
  ROOT_MEMBER_PATH,
  readWorkspacePackages,
  selectProjects,
} from '../src/workspace-policy.js'

const governed = (path: string): ProjectManifest => ({
  path,
  packageJson: { devDependencies: { ploaness: '1.0.0' } },
})

const plain = (path: string): ProjectManifest => ({ path, packageJson: {} })

const member = (path: string, isPayload: boolean = false): MemberShape => ({
  path,
  isPayload,
  sourceRoots: ['src', 'tests', 'scripts'],
})

type EntryLookup = (directory: string, entry: string) => boolean

const lookupIn =
  (tree: Readonly<Record<string, readonly string[]>>): EntryLookup =>
  (directory: string, entry: string): boolean =>
    (tree[directory] ?? []).includes(entry)

describe('findRepositoryRoot', () => {
  it('stops at the nearest directory holding a workspace file', () => {
    const hasEntry: EntryLookup = lookupIn({
      '/a': ['pnpm-workspace.yaml'],
      '/': ['.git', 'package.json'],
    })
    expect(findRepoRoot(['/a/b', '/a', '/'], hasEntry)).toBe('/a')
  })

  it('does not escape a workspace file to reach an enclosing checkout', () => {
    const hasEntry: EntryLookup = lookupIn({
      '/work/case': ['pnpm-workspace.yaml'],
      '/work': ['.git', 'package.json'],
    })
    expect(findRepoRoot(['/work/case', '/work', '/'], hasEntry)).toBe('/work/case')
  })

  it('falls back to a checkout carrying both a git directory and a manifest', () => {
    const hasEntry: EntryLookup = lookupIn({ '/repo': ['.git', 'package.json'] })
    expect(findRepoRoot(['/repo/src', '/repo', '/'], hasEntry)).toBe('/repo')
  })

  it('ignores a git directory with no manifest beside it', () => {
    const hasEntry: EntryLookup = lookupIn({ '/repo': ['.git'] })
    expect(findRepoRoot(['/repo/src', '/repo'], hasEntry)).toBe('/repo/src')
  })

  it('returns the working directory when nothing above it qualifies', () => {
    expect(findRepoRoot(['/scratch', '/'], lookupIn({}))).toBe('/scratch')
  })
})

describe('readWorkspacePackages', () => {
  it('reads every declared directory pattern', () => {
    const file: string = ['packages:', "  - 'apps/*'", '  - packages/**', ''].join('\n')
    expect(readWorkspacePackages(file)).toEqual(['apps/*', 'packages/**'])
  })

  it('keeps an exclusion pattern so the selector can apply it', () => {
    const file: string = ['packages:', '  - apps/*', "  - '!apps/legacy'"].join('\n')
    expect(readWorkspacePackages(file)).toEqual(['apps/*', '!apps/legacy'])
  })

  it('drops a trailing comment from a pattern', () => {
    const file: string = ['packages:', '  - apps/* # the applications'].join('\n')
    expect(readWorkspacePackages(file)).toEqual(['apps/*'])
  })

  it('reads no pattern from a workspace file that declares no packages key', () => {
    const file: string = ['overrides:', '  vitest: 3.0.0'].join('\n')
    expect(readWorkspacePackages(file)).toEqual([])
  })
})

describe('selectProjects', () => {
  it('selects the repository root even when no pattern names it', () => {
    expect(selectProjects(['apps/*'], [ROOT_MEMBER_PATH, 'apps/web'])).toEqual([
      ROOT_MEMBER_PATH,
      'apps/web',
    ])
  })

  it('selects the root alone when the workspace declares no packages', () => {
    expect(selectProjects([], [ROOT_MEMBER_PATH, 'apps/web'])).toEqual([ROOT_MEMBER_PATH])
  })

  it('applies an exclusion whichever order it was written in', () => {
    const patterns: readonly string[] = ['!apps/legacy', 'apps/*']
    expect(selectProjects(patterns, [ROOT_MEMBER_PATH, 'apps/web', 'apps/legacy'])).toEqual([
      ROOT_MEMBER_PATH,
      'apps/web',
    ])
  })

  it('does not select a directory holding no manifest', () => {
    expect(selectProjects(['apps/*'], [ROOT_MEMBER_PATH])).toEqual([ROOT_MEMBER_PATH])
  })
})

describe('findGovernedMembers', () => {
  it('governs every project declaring the harness', () => {
    expect(findGovernedMembers([governed(ROOT_MEMBER_PATH), governed('apps/web')])).toEqual([
      ROOT_MEMBER_PATH,
      'apps/web',
    ])
  })

  it('leaves a project that does not declare the harness ungoverned', () => {
    expect(findGovernedMembers([governed(ROOT_MEMBER_PATH), plain('apps/web')])).toEqual([
      ROOT_MEMBER_PATH,
    ])
  })

  it('falls back to the root when nothing declares the harness', () => {
    expect(findGovernedMembers([plain(ROOT_MEMBER_PATH), plain('packages/cli')])).toEqual([
      ROOT_MEMBER_PATH,
    ])
  })
})

describe('findUngovernedProjects', () => {
  it('reports a pnpm project that dropped the harness declaration', () => {
    const findings: readonly string[] = findUngovernedProjects(
      [governed(ROOT_MEMBER_PATH), plain('apps/rogue')],
      [member(ROOT_MEMBER_PATH)],
    )
    expect(findings).toHaveLength(1)
    expect(findings[0]).toContain('apps/rogue/package.json')
  })

  it('accepts a project already covered by a member source root', () => {
    expect(
      findUngovernedProjects(
        [governed(ROOT_MEMBER_PATH), plain('tests/fixtures/consumer')],
        [member(ROOT_MEMBER_PATH)],
      ),
    ).toEqual([])
  })

  it('resolves a source root against the member that declared it', () => {
    expect(
      findUngovernedProjects(
        [governed('apps/web'), plain('apps/web/tests/fixture')],
        [member('apps/web')],
      ),
    ).toEqual([])
  })

  it('reports nothing when every project is governed', () => {
    expect(
      findUngovernedProjects(
        [governed(ROOT_MEMBER_PATH), governed('apps/web')],
        [member(ROOT_MEMBER_PATH), member('apps/web')],
      ),
    ).toEqual([])
  })
})

describe('findPayloadMemberViolations', () => {
  it('accepts a repository where one member declares payload', () => {
    expect(
      findPayloadMemberViolations([member(ROOT_MEMBER_PATH), member('apps/web', true)]),
    ).toEqual([])
  })

  it('refuses a repository where no member declares payload', () => {
    const findings: readonly string[] = findPayloadMemberViolations([member(ROOT_MEMBER_PATH)])
    expect(findings).toHaveLength(1)
    expect(findings[0]).toContain('payload')
  })
})

describe('findServerUrlCollisions', () => {
  it('reports a second member driving an origin another already drives', () => {
    const findings: readonly string[] = findServerUrlCollisions([
      { path: 'apps/web', serverUrl: 'http://localhost:3000' },
      { path: 'apps/admin', serverUrl: 'http://localhost:3000' },
    ])
    expect(findings).toHaveLength(1)
    expect(findings[0]).toContain('apps/admin')
    expect(findings[0]).toContain('apps/web')
  })

  it('accepts members that drive distinct origins', () => {
    expect(
      findServerUrlCollisions([
        { path: 'apps/web', serverUrl: 'http://localhost:3000' },
        { path: 'apps/admin', serverUrl: 'http://localhost:3100' },
      ]),
    ).toEqual([])
  })

  it('never reports a repository with one member', () => {
    expect(findServerUrlCollisions([{ path: '.', serverUrl: 'http://localhost:3000' }])).toEqual([])
  })
})
