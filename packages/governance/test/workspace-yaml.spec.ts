import { describe, expect, it } from 'vitest'
import { findOverrides, findReleaseAgeViolations } from '../src/install-policy.js'
import { readWorkspacePackages, selectProjects } from '../src/workspace-policy.js'
import {
  readWorkspaceDocument,
  topLevelBlockLines,
  topLevelMappingEntries,
  topLevelScalar,
} from '../src/yaml-blocks.js'

const DIRECTORIES: readonly string[] = ['.', 'apps/cms', 'apps/web']

describe('workspace discovery reads YAML meaning', () => {
  it.each([
    'packages: ["apps/cms", "apps/web"]',
    'packages:\n  - apps/cms\n# public website\n  - apps/web',
    '"packages":\n- apps/cms\n- apps/web',
    'members: &members [apps/cms, apps/web]\npackages: *members',
  ])('schedules every declared member for %s', (file: string) => {
    expect(selectProjects(readWorkspacePackages(file), DIRECTORIES)).toEqual(DIRECTORIES)
  })

  it.each([
    'packages: [apps/cms',
    'packages: [apps/cms]\npackages: [apps/web]',
    'packages: apps/cms',
    'packages: [apps/cms, 12]',
    'packages: null',
    '- apps/cms',
    '!!omap [packages: [apps/cms, apps/web]]',
    '!!set {packages: null}',
    '%YAML 1.1\n---\n!!omap [packages: [apps/cms, apps/web]]',
    '%YAML 1.1\n---\n!!set {packages: null}',
  ])('refuses incomplete discovery for %s', (file: string) => {
    expect(() => readWorkspacePackages(file)).toThrow('pnpm-workspace.yaml')
  })

  it('preserves a quoted hash as part of a directory name', () => {
    expect(readWorkspacePackages('packages: ["apps/cms#preview"]')).toEqual(['apps/cms#preview'])
  })
})

describe('other workspace policies read the same YAML', () => {
  it('reads an empty document without inventing settings', () => {
    expect(readWorkspaceDocument('# no workspace settings\n')).toEqual({})
    expect(topLevelBlockLines('', 'packages')).toEqual([])
  })

  it('renders a flow list as canonical block lines', () => {
    expect(topLevelBlockLines('packages: [apps/cms, apps/web]', 'packages')).toEqual(['- apps/cms', '- apps/web'])
  })

  it('rejects unknown tags instead of ignoring their meaning', () => {
    expect(() => readWorkspaceDocument('packages: !custom [apps/cms]')).toThrow('pnpm-workspace.yaml')
  })

  it('rejects unresolved aliases instead of dropping their members', () => {
    expect(() => readWorkspacePackages('packages: *missing')).toThrow('pnpm-workspace.yaml')
  })

  it('rejects a collection where a scalar is required', () => {
    expect(() => topLevelScalar('minimumReleaseAgeStrict: []', 'minimumReleaseAgeStrict')).toThrow('must be a scalar')
  })

  it.each(['overrides: false', 'overrides: []'])('rejects a non-mapping override block: %s', (file: string) => {
    expect(() => topLevelMappingEntries(file, 'overrides')).toThrow('must be a mapping')
  })

  it.each([
    'overrides: !!omap [react: "19"]',
    'packageExtensions: {widget: !!set {react: null}}',
    '%YAML 1.1\n---\noverrides: !!omap [react: "19"]',
    '%YAML 1.1\n---\npackageExtensions: {widget: !!set {react: null}}',
  ])('rejects tagged collections that cannot describe dependency settings: %s', (file: string) => {
    expect(() => findOverrides(file)).toThrow('pnpm-workspace.yaml')
  })

  it('names the workspace when an override contains a cyclic alias', () => {
    expect(() => findOverrides('packageExtensions: {widget: &self {dependencies: *self}}')).toThrow(
      'pnpm-workspace.yaml',
    )
  })

  it('retains structured package extensions as one entry per package', () => {
    const entries: ReturnType<typeof findOverrides> = findOverrides(
      'packageExtensions: {"widget@1": {peerDependencies: {react: "19"}}}',
    )
    expect(entries.map((entry): string => entry.packageName)).toEqual(['widget@1'])
    expect(entries[0]?.specifier).toContain('peerDependencies')
  })

  it('retains a quoted override key and the complete git specifier', () => {
    expect(findOverrides('overrides: {"@scope/widget": "git+ssh://example.invalid/widget#tag"}')).toEqual([
      { key: 'overrides', packageName: '@scope/widget', specifier: 'git+ssh://example.invalid/widget#tag' },
    ])
  })

  it('checks exclusions in a flow sequence', () => {
    expect(
      findReleaseAgeViolations('minimumReleaseAgeStrict: "true"\nminimumReleaseAgeExclude: [ploaness, react]'),
    ).toEqual([expect.stringContaining('names react')])
  })
})
