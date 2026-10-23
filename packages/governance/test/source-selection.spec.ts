import { describe, expect, it } from 'vitest'
import { biomeSelection } from '../src/biome-selection.js'
import { coverageIncludes } from '../src/coverage-policy.js'
import { matchesGlob, matchesRole } from '../src/file-roles.js'
import { globAlternatives } from '../src/glob-alternatives.js'
import { memberDirectories, memberGlobs, memberSettingBlock } from '../src/member-patterns.js'
import { findUnreachedExclusionsBySetting, readSettings, type Settings } from '../src/settings.js'
import { readMemberSettings } from '../src/settings-layering.js'
import { allowedJavaScriptFiles, isCommonJsExport, matchesAnyGlob, memberFiles } from '../src/source-selection.js'

const role = (pattern: string): { readonly pattern: string; readonly reason: string } => ({
  pattern,
  reason: 'generated fixture',
})

// An allowlist entry also declares the engine its file runs in.
const script = (pattern: string): { readonly pattern: string; readonly reason: string; readonly runtime: string } => ({
  ...role(pattern),
  runtime: 'node',
})

describe('source selection', () => {
  it('selects formatter inputs without descending into generated directories or other members', () => {
    expect(
      biomeSelection(
        ['src/read.ts', 'src/generated/read.ts', 'app/src/read.ts', 'edge/read.cjs', 'notes.txt'],
        ['src/**/*', '**/*.cjs', 'app/**/*', '!src/generated'],
        ['app'],
      ),
    ).toEqual(['src/read.ts', 'edge/read.cjs'])
    expect(biomeSelection(['src/generated.ts', 'src/read.ts'], ['src/**/*', '!src/generated.ts'], [])).toEqual([
      'src/read.ts',
    ])
  })
  it('admits only JavaScript and excludes nested member entry points', () => {
    expect(
      allowedJavaScriptFiles(
        ['edge/read.cjs', 'edge/view.jsx', 'edge/read.ts', 'app/edge/read.js'],
        ['edge/'],
        ['app'],
      ),
    ).toEqual(['edge/read.cjs', 'edge/view.jsx'])
    expect(memberFiles(['src/read.ts', 'app/src/read.ts', 'application/read.ts'], ['app'])).toEqual([
      'src/read.ts',
      'application/read.ts',
    ])
  })

  it('measures executable TypeScript extensions under additional source roots', () => {
    const includes: readonly string[] = coverageIncludes(['src', 'lib', '.'])
    for (const file of ['lib/read.ts', 'lib/read.mts', 'lib/read.cts', 'root.ts']) {
      expect(matchesAnyGlob(file, includes)).toBe(true)
    }
    expect(matchesAnyGlob('lib/read.js', includes)).toBe(false)
    expect(matchesAnyGlob('lib/view.tsx', includes)).toBe(false)
  })

  it('excludes generated artifacts from coverage without a duplicate declaration', () => {
    const settings: Settings = readSettings({ ploaness: { generatedArtefacts: [role('lib/generated/**')] } })
    expect(matchesAnyGlob('lib/generated/client.mts', settings.coverageExclude)).toBe(true)
    expect(matchesAnyGlob('src/payload-generated-schema.ts', settings.coverageExclude)).toBe(true)
    expect(matchesAnyGlob('lib/authored.mts', settings.coverageExclude)).toBe(false)
  })

  it('rejects JavaScript exceptions reaching only TypeScript', () => {
    const settings: Settings = readSettings({ ploaness: { javascriptAllowlist: [script('^edge/')] } })
    expect(findUnreachedExclusionsBySetting(settings.declaredExclusions, ['edge/read.ts'])).toHaveLength(1)
    expect(findUnreachedExclusionsBySetting(settings.declaredExclusions, ['edge/read.jsx'])).toEqual([])
  })

  it('validates coverage exclusions against the configured source roots', () => {
    const settings: Settings = readSettings({ ploaness: { coverageExclude: [role('lib/{read,write}.mts')] } })
    expect(findUnreachedExclusionsBySetting(settings.declaredExclusions, ['lib/read.mts'], ['lib'])).toEqual([])
    expect(findUnreachedExclusionsBySetting(settings.declaredExclusions, ['lib/other.mts'], ['lib'])).toHaveLength(1)
  })
})

describe('declaration origins', () => {
  it('keeps managed-asset ownership at its declaring directory', () => {
    const root: Record<string, unknown> = {
      unmanagedAssets: [
        { path: 'AGENTS.md', reason: 'root-owned instructions' },
        { path: 'app/AGENTS.md', reason: 'application-owned instructions' },
        null,
      ],
    }
    expect(readMemberSettings(root, {}, 'app').unmanagedAssets).toEqual([
      { path: 'AGENTS.md', reason: 'application-owned instructions' },
    ])
    expect(readMemberSettings(root, {}, 'web').unmanagedAssets).toEqual([])
    expect(readMemberSettings(root, {}).unmanagedAssets).toHaveLength(2)
    expect(readMemberSettings({ unmanagedAssets: false }, {}, 'app').unmanagedAssets).toEqual([])
  })
  it('keeps root regexes rooted while member declarations stay local', () => {
    const settings: Settings = readMemberSettings(
      { javascriptAllowlist: [script('^app/edge/')], typographyExclusions: [role('^app/generated/')] },
      { javascriptAllowlist: [script('^own/')] },
      'app',
    )
    expect(matchesRole('edge/read.cjs', settings.javascriptAllowlist)).toBe(true)
    expect(matchesRole('own/read.cjs', settings.javascriptAllowlist)).toBe(true)
    expect(matchesRole('app/edge/read.cjs', settings.javascriptAllowlist)).toBe(false)
    expect(matchesRole('generated/schema.ts', settings.typographyExclusions)).toBe(true)
  })

  it('does not inherit a root-only coverage exclusion into another member', () => {
    const settings: Settings = readMemberSettings({ coverageExclude: [role('scripts/deploy.ts')] }, {}, 'app')
    expect(matchesAnyGlob('scripts/deploy.ts', settings.coverageExclude)).toBe(false)
  })

  it('projects explicit cross-member and targeted globs without leaking to siblings', () => {
    expect(memberGlobs('**/scripts/deploy.ts', 'apps/web')).toContain('**/scripts/deploy.ts')
    expect(memberGlobs('{app,web}/generated/**', 'app')).toEqual(['generated/**'])
    expect(memberGlobs('app/generated/**', 'web')).toEqual([])
    expect(memberGlobs('app', 'app')).toEqual([])
    expect(memberGlobs('src/**', '.')).toEqual(['src/**'])
  })

  it('projects source and pure directories at their declaring root', () => {
    expect(memberDirectories('app/lib', 'app')).toEqual(['lib'])
    expect(memberDirectories('app', 'app')).toEqual(['.'])
    expect(memberDirectories('apps', 'apps/web')).toEqual(['.'])
    expect(memberDirectories('.', 'apps/web')).toEqual(['.'])
    expect(memberDirectories('src', 'app')).toEqual([])
    expect(memberDirectories('src', '.')).toEqual(['src'])
    const settings: Settings = readMemberSettings(
      {
        sourceRoots: ['app/lib'],
        pureLogicRoots: [role('app/lib/core')],
        generatedArtefacts: [role('app/lib/generated/**')],
        frameworkGlue: [role('app/lib/framework/**')],
      },
      {},
      'app',
    )
    expect(settings.sourceRoots).toContain('lib')
    expect(settings.pureLogicRoots).toContain('lib/core')
    expect(settings.generatedArtefacts).toContain('lib/generated/**')
    expect(settings.frameworkGlue).toContain('lib/framework/**')
  })

  it('drops malformed path declarations without weakening scalar constraints', () => {
    expect(
      memberSettingBlock({ sourceRoots: [null, 1], generatedArtefacts: false, maxSuppressions: 0 }, 'app'),
    ).toEqual({ sourceRoots: [], generatedArtefacts: [], maxSuppressions: 0 })
  })
})

describe('brace alternatives', () => {
  it('supports nested alternatives and literal framework directory names', () => {
    expect(globAlternatives('src/{one,{two,three}}.ts')).toEqual([
      'src/one.ts',
      'src/two.ts',
      'src/one.ts',
      'src/three.ts',
    ])
    expect(matchesGlob('src/{one,two}.ts', 'src/one.ts')).toBe(true)
    expect(matchesGlob('src/{one,two}.ts', 'src/three.ts')).toBe(false)
    expect(matchesGlob('src/app/(payload)/**', 'src/app/(payload)/custom.scss')).toBe(true)
    expect(matchesGlob('**/*.ts', '.generated/schema.ts')).toBe(true)
  })

  it.each(['src/{one,two.ts', 'src/one}.ts', 'src/{one}.ts', 'src/{one,}.ts', 'src/{1..3}.ts'])(
    'reports unsupported brace syntax with a concrete repair: %s',
    (pattern: string) => {
      expect(() => globAlternatives(pattern)).toThrow(/braces/)
    },
  )

  it('bounds the number of alternatives', () => {
    expect(() =>
      globAlternatives(`src/{${Array.from({ length: 257 }, (_, index) => String(index)).join(',')}}.ts`),
    ).toThrow(/split the declaration/)
  })
})

describe('CommonJS export policy', () => {
  it('accepts runtime export initialization without permitting other mutations', () => {
    expect(isCommonJsExport('=', 'module', 'exports', true)).toBe(true)
    expect(isCommonJsExport('=', 'exports', 'read', true)).toBe(true)
    expect(isCommonJsExport('=', 'module.exports', 'read', true)).toBe(true)
    expect(isCommonJsExport('+=', 'module', 'exports', true)).toBe(false)
    expect(isCommonJsExport('=', 'module', 'exports', false)).toBe(false)
    expect(isCommonJsExport('=', 'module', 'other', true)).toBe(false)
    expect(isCommonJsExport('=', 'record', 'exports', true)).toBe(false)
  })
})
