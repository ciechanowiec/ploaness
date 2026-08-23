import { describe, expect, it } from 'vitest'
import { readSettings, type Settings } from '../src/settings.js'

describe('readSettings', () => {
  it('returns the strict defaults for a project that declares nothing', () => {
    const settings = readSettings({})
    expect(settings.sourceRoots).toEqual(['src', 'tests', 'scripts'])
    expect(settings.bundleBudgetBytes).toBe(900 * 1024)
    expect(settings.unmanagedAssets).toEqual([])
    expect(settings.pretest).toEqual([])
  })

  it('adds project exclusions to the defaults rather than replacing them', () => {
    const settings = readSettings({ ploaness: { typographyExclusions: ['^vendor/'] } })
    expect(settings.typographyExclusions).toContain('^vendor/')
    expect(settings.typographyExclusions).toContain(String.raw`^src/payload-types\.ts$`)
  })

  it('ignores an unmanaged entry that records no reason', () => {
    const settings = readSettings({
      ploaness: {
        unmanagedAssets: [
          { path: 'CLAUDE.md' },
          { path: '.editorconfig', reason: 'the monorepo root owns it' },
        ],
      },
    })
    expect(settings.unmanagedAssets).toEqual([
      { path: '.editorconfig', reason: 'the monorepo root owns it' },
    ])
  })

  it('falls back to the default when a value has the wrong type', () => {
    expect(readSettings({ ploaness: { bundleBudgetBytes: 'big' } }).bundleBudgetBytes).toBe(
      900 * 1024,
    )
    expect(readSettings({ ploaness: { sourceRoots: 'src' } }).sourceRoots).toEqual([
      'src',
      'tests',
      'scripts',
    ])
  })

  it('rejects a non-positive bundle budget', () => {
    expect(readSettings({ ploaness: { bundleBudgetBytes: 0 } }).bundleBudgetBytes).toBe(900 * 1024)
  })

  // The analysis environment exists so a static gate can IMPORT a Payload config, which validates
  // process.env at module scope. Payload's own two variables are supplied by default; a project may add
  // to them but must not be able to erase them, or the gate would die on the very configuration the
  // default was written to satisfy.
  it("supplies Payload's required variables by default", () => {
    const settings: Settings = readSettings({})
    expect(settings.analysisEnv['PAYLOAD_SECRET']).toBeDefined()
    expect(settings.analysisEnv['DATABASE_URL']).toBeDefined()
  })

  it('merges a declared variable over the defaults without dropping them', () => {
    const settings: Settings = readSettings({
      ploaness: { analysisEnv: { DATABASE_URL: 'postgres://declared', EXTRA_TOKEN: 'x' } },
    })
    expect(settings.analysisEnv['DATABASE_URL']).toBe('postgres://declared')
    expect(settings.analysisEnv['EXTRA_TOKEN']).toBe('x')
    expect(settings.analysisEnv['PAYLOAD_SECRET']).toBeDefined()
  })

  it('drops a non-string value, which spawn could not accept as an environment', () => {
    const settings: Settings = readSettings({
      ploaness: { analysisEnv: { PORT: 5432, HOST: 'localhost' } },
    })
    expect(settings.analysisEnv['PORT']).toBeUndefined()
    expect(settings.analysisEnv['HOST']).toBe('localhost')
  })

  it('ignores a malformed analysisEnv entirely', () => {
    expect(
      readSettings({ ploaness: { analysisEnv: 'nope' } }).analysisEnv['PAYLOAD_SECRET'],
    ).toBeDefined()
  })
})
