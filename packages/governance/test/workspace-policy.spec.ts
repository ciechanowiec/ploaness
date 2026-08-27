import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  analysisBoundaries,
  eslintArguments,
  findGovernedMembers,
  findPayloadMemberViolations,
  findRepositoryRoot as findRepoRoot,
  findServerUrlCollisions,
  findUngovernedProjects,
  hasRuntime,
  type MemberKind,
  type MemberShape,
  memberKindOf,
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

describe('memberKindOf', () => {
  it('reads a package declaring payload as a Payload application', () => {
    expect(memberKindOf({ dependencies: { payload: '3.88.0', next: '16.3.2' } })).toBe('payload')
  })

  it('reads a package declaring next alone as an application', () => {
    expect(memberKindOf({ dependencies: { next: '16.3.2' } })).toBe('application')
  })

  it('reads a package declaring neither as a library', () => {
    expect(memberKindOf({ devDependencies: { vitest: '4.1.11' } })).toBe('library')
  })

  it('reads a manifest it cannot parse as a library rather than guessing', () => {
    expect(memberKindOf(undefined)).toBe('library')
  })

  it('reads a framework declared as a devDependency too', () => {
    expect(memberKindOf({ devDependencies: { next: '16.3.2' } })).toBe('application')
  })
})

describe('hasRuntime', () => {
  it('gives a build, a bundle and a browser to both kinds of application', () => {
    const kinds: readonly MemberKind[] = ['payload', 'application']
    expect(kinds.every((kind: MemberKind): boolean => hasRuntime(kind))).toBe(true)
  })

  it('gives none of the three to a library', () => {
    expect(hasRuntime('library')).toBe(false)
  })
})

// Asserted through the matcher the analyzers use rather than against the literal, because the string is
// not the promise: what each of them is handed is a glob, and what matters is which files it covers.
const coversFile = (siblingPaths: readonly string[], file: string): boolean =>
  analysisBoundaries(siblingPaths).some((pattern: string): boolean =>
    path.matchesGlob(file, pattern),
  )

describe('analysisBoundaries', () => {
  it('stops the analysis at every depth inside a sibling, not at the sibling directory', () => {
    expect(coversFile(['cms'], 'cms/src/collections/Media.ts')).toBe(true)
  })

  it('leaves the member its own sources', () => {
    expect(coversFile(['cms', 'fe'], 'src/index.ts')).toBe(false)
  })

  it('does not stop at a member whose name merely begins with a sibling name', () => {
    expect(coversFile(['cms'], 'cms-legacy/src/index.ts')).toBe(false)
  })

  it('gives a member with no sibling nothing to exclude', () => {
    expect(analysisBoundaries([])).toStrictEqual([])
  })
})

// The joint between the gate and the formatter, which is the thing that actually drifted. Each read its
// own argument list, they agreed about the target and disagreed about the boundary, and the half that
// was wrong was the half that WRITES - so nothing reported it. Asserted as "the two lists differ by the
// mode flag and by nothing else" rather than against a literal, because a literal would pass while both
// call sites were wrong together.
const withoutMode = (mode: 'fix' | 'report'): readonly string[] =>
  eslintArguments(['cms', 'fe'], mode).filter(
    (argument: string): boolean => argument !== '--fix' && argument !== '--max-warnings=0',
  )

describe('eslintArguments', () => {
  it('tells a writing run exactly the boundary it tells a judging run', () => {
    expect(withoutMode('fix')).toStrictEqual(withoutMode('report'))
  })

  it('stops a run at every sibling, so a root-started one cannot reach into a member', () => {
    expect(eslintArguments(['cms', 'fe'], 'fix')).toStrictEqual([
      '.',
      '--fix',
      '--ignore-pattern',
      'cms/**',
      '--ignore-pattern',
      'fe/**',
    ])
  })

  it('renders a verdict when judging and applies fixes when writing', () => {
    expect(eslintArguments([], 'report')).toStrictEqual(['.', '--max-warnings=0'])
    expect(eslintArguments([], 'fix')).toStrictEqual(['.', '--fix'])
  })
})
