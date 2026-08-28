import { describe, expect, it } from 'vitest'
import {
  type DeclaredExclusion,
  readRawSettings,
  readSettings,
  type Settings,
} from '../src/settings.js'
import {
  layerSettingBlocks,
  readMemberSettings,
  rebaseExclusion,
} from '../src/settings-layering.js'

const layered = (
  base: Record<string, unknown>,
  overlay: Record<string, unknown>,
): Record<string, unknown> => layerSettingBlocks(base, overlay)

describe('layerSettingBlocks', () => {
  it('adds a member root to the repository roots rather than replacing them', () => {
    // Replacing would let a member narrow the scope the harness refuses to narrow.
    expect(layered({ sourceRoots: ['src'] }, { sourceRoots: ['domain'] })['sourceRoots']).toEqual([
      'src',
      'domain',
    ])
  })

  it('carries a repository exclusion down to a member that declares none', () => {
    const merged: Record<string, unknown> = layered(
      { typographyExclusions: [{ pattern: '^generated/', reason: 'generated' }] },
      {},
    )
    expect(merged['typographyExclusions']).toHaveLength(1)
  })

  it('honours the smaller bundle budget whichever half declared it', () => {
    expect(
      layered({ bundleBudgetBytes: 900 }, { bundleBudgetBytes: 500 })['bundleBudgetBytes'],
    ).toBe(500)
    expect(
      layered({ bundleBudgetBytes: 500 }, { bundleBudgetBytes: 900 })['bundleBudgetBytes'],
    ).toBe(500)
  })

  it('keeps the repository budget for a member that declares none', () => {
    expect(layered({ bundleBudgetBytes: 500 }, {})['bundleBudgetBytes']).toBe(500)
  })

  it('replaces a command list rather than concatenating it', () => {
    // Concatenating two argv lists produces a command nobody wrote.
    expect(
      layered({ pretest: ['pnpm', 'run', 'db'] }, { pretest: ['echo', 'ok'] })['pretest'],
    ).toEqual(['echo', 'ok'])
  })

  it('lets a member name its own origin', () => {
    expect(
      layered({ serverUrl: 'http://localhost:3000' }, { serverUrl: 'http://localhost:3100' })[
        'serverUrl'
      ],
    ).toBe('http://localhost:3100')
  })

  it('keeps both halves of an environment map', () => {
    const merged: Record<string, unknown> = layered(
      { analysisEnv: { SHARED: 'a' } },
      { analysisEnv: { OWN: 'b' } },
    )
    expect(merged['analysisEnv']).toEqual({ SHARED: 'a', OWN: 'b' })
  })
})

describe('layering and the single-package read agree', () => {
  it('reads one block exactly as readSettings reads that manifest', () => {
    // The joint that keeps a single-package project unaffected: with nothing above it, a member's
    // settings are the settings that manifest always produced.
    const block: Record<string, unknown> = { sourceRoots: ['domain'], bundleBudgetBytes: 500 }
    expect(readRawSettings(layerSettingBlocks({}, block))).toEqual(
      readSettings({ ploaness: block }),
    )
  })

  it('agrees for a manifest declaring nothing at all', () => {
    expect(readRawSettings(layerSettingBlocks({}, {}))).toEqual(readSettings({}))
  })
})

describe('layering a malformed or partial declaration', () => {
  it('ignores a non-list where an additive list was expected', () => {
    // A typo can never widen a rule: the half that is not a list contributes nothing.
    expect(layered({ sourceRoots: 'src' }, { sourceRoots: ['domain'] })['sourceRoots']).toEqual([
      'domain',
    ])
  })

  it('keeps the member threshold when the repository declared a non-number', () => {
    expect(
      layered({ bundleBudgetBytes: 'small' }, { bundleBudgetBytes: 500 })['bundleBudgetBytes'],
    ).toBe(500)
  })

  it('keeps the repository threshold when the member declared a non-number', () => {
    expect(
      layered({ bundleBudgetBytes: 500 }, { bundleBudgetBytes: 'small' })['bundleBudgetBytes'],
    ).toBe(500)
  })

  it('falls back to the repository value when a replaced key is declared empty', () => {
    expect(layered({ serverUrl: 'http://localhost:3000' }, { serverUrl: null })['serverUrl']).toBe(
      'http://localhost:3000',
    )
  })

  it('keeps a key only one half declares', () => {
    expect(layered({ maxSuppressions: 3 }, { serverUrl: 'http://localhost:3200' })).toEqual({
      maxSuppressions: 3,
      serverUrl: 'http://localhost:3200',
    })
  })
})

const exclusion = (pattern: string, kind: DeclaredExclusion['kind']): DeclaredExclusion => ({
  setting: 'typographyExclusions',
  pattern,
  reason: 'generated',
  kind,
})

describe('rebaseExclusion', () => {
  it('leaves a member at the repository root untouched', () => {
    // The single-package proof: with nothing above it, a project's exclusions are read exactly as
    // they were written.
    const entry: DeclaredExclusion = exclusion('^src/generated/', 'regex')
    expect(rebaseExclusion('.', entry)).toEqual(entry)
  })

  it('moves an anchored pattern into the member it was written in', () => {
    expect(rebaseExclusion('apps/web', exclusion('^src/generated/', 'regex')).pattern).toBe(
      '^apps/web/src/generated/',
    )
  })

  it('leaves an unanchored pattern alone, because it already matches at any depth', () => {
    // Prefixing would NARROW it to one member, which is the unsafe direction: the gate would stop
    // skipping a file the project had already accounted for.
    const entry: DeclaredExclusion = exclusion(String.raw`importMap\.js$`, 'regex')
    expect(rebaseExclusion('apps/web', entry)).toEqual(entry)
  })

  it('prefixes a glob, which is always relative to the package that declared it', () => {
    expect(rebaseExclusion('apps/web', exclusion('src/migrations/**', 'glob')).pattern).toBe(
      'apps/web/src/migrations/**',
    )
  })

  it('leaves a route alone, because it names a URL rather than a path', () => {
    const entry: DeclaredExclusion = exclusion('/admin', 'route')
    expect(rebaseExclusion('apps/web', entry)).toEqual(entry)
  })
})

// A member INHERITS the repository's values and OWNS its declarations. Layering the declarations too
// made every member answer for the repository's: a workspace root correctly excusing its Vale detector
// definitions - whose content IS the character the ban detects - had each member report that exclusion
// as reaching nothing, because no member holds the file. One correct declaration failed two gates, and
// no edit a member could make would have fixed it.
describe('readMemberSettings', () => {
  const Repository: Record<string, unknown> = {
    typographyExclusions: [
      { pattern: String.raw`^\.vale/styles/`, reason: 'detector definitions' },
    ],
    sourceRoots: ['src'],
  }
  const Own: Record<string, unknown> = {
    pureLogicRoots: [{ pattern: 'src/config', reason: 'pure by construction' }],
  }

  it('inherits the repository effective values', () => {
    const settings: Settings = readMemberSettings(Repository, Own)
    expect(settings.typographyExclusions).toContain(String.raw`^\.vale/styles/`)
    expect(settings.pureLogicRoots).toContain('src/config')
  })

  it('declares only what the member itself wrote', () => {
    const settings: Settings = readMemberSettings(Repository, Own)
    const settingsDeclared: readonly string[] = settings.declaredExclusions.map(
      (entry: DeclaredExclusion): string => entry.setting,
    )
    expect(settingsDeclared).toEqual(['pureLogicRoots'])
  })

  it('declares nothing for a member that declared nothing', () => {
    expect(readMemberSettings(Repository, {}).declaredExclusions).toEqual([])
  })

  it('is equal to reading the block alone when the repository declared nothing', () => {
    // The single-package proof: with no repository block there is nothing to inherit, so a member's
    // settings are exactly what its own block says.
    expect(readMemberSettings({}, Own)).toEqual(readRawSettings(Own))
  })
})

// The same direction as the bundle budget, and registered beside it: a member holding itself to a
// shorter crawl is stricter, while one declaring a longer crawl than the root allowed is not.
describe('layerSettingBlocks, the accessibility ceiling', () => {
  it('honours the smaller route budget whichever half declared it', () => {
    expect(
      layered({ accessibilityRouteBudget: 200 }, { accessibilityRouteBudget: 40 })[
        'accessibilityRouteBudget'
      ],
    ).toBe(40)
    expect(
      layered({ accessibilityRouteBudget: 40 }, { accessibilityRouteBudget: 200 })[
        'accessibilityRouteBudget'
      ],
    ).toBe(40)
  })
})
