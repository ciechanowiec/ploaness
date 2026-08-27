import { describe, expect, it } from 'vitest'
import { type DeclaredExclusion, readRawSettings, readSettings } from '../src/settings.js'
import { layerSettingBlocks, rebaseExclusion } from '../src/settings-layering.js'

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
