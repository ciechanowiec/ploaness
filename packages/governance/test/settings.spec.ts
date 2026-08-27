import { describe, expect, it } from 'vitest'
import { matchesRole } from '../src/file-roles.js'
import { readSettings, type Settings } from '../src/settings.js'

describe('readSettings', () => {
  it('returns the strict defaults for a project that declares nothing', () => {
    const settings: Settings = readSettings({})
    expect(settings.sourceRoots).toEqual(['src', 'tests', 'scripts'])
    expect(settings.bundleBudgetBytes).toBe(900 * 1024)
    expect(settings.unmanagedAssets).toEqual([])
    expect(settings.pretest).toEqual([])
  })

  it('adds project exclusions to the defaults rather than replacing them', () => {
    const settings: Settings = readSettings({
      ploaness: {
        typographyExclusions: [
          { pattern: '^vendor/', reason: 'third-party sources, vendored as-is' },
        ],
      },
    })
    expect(settings.typographyExclusions).toContain('^vendor/')
    // Asserted by what the shipped default MATCHES rather than by its literal text. It has to reach a
    // generated file at the repository root and the same file inside a member, and pinning the string
    // made the second case a spec change rather than a finding.
    expect(matchesRole('src/payload-types.ts', settings.typographyExclusions)).toBe(true)
    expect(matchesRole('apps/web/src/payload-types.ts', settings.typographyExclusions)).toBe(true)
  })

  it('ignores an unmanaged entry that records no reason', () => {
    const settings: Settings = readSettings({
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
})

describe('analysisEnv', () => {
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

describe('maxSuppressions', () => {
  it('accepts no declaration, leaving the earned ceiling in force', () => {
    expect(readSettings({}).maxSuppressions).toBeUndefined()
  })

  it('accepts zero, which states that no suppression is permitted', () => {
    expect(readSettings({ ploaness: { maxSuppressions: 0 } }).maxSuppressions).toBe(0)
  })

  it('accepts a stricter positive cap', () => {
    expect(readSettings({ ploaness: { maxSuppressions: 3 } }).maxSuppressions).toBe(3)
  })

  it('drops a negative cap rather than honouring it', () => {
    expect(readSettings({ ploaness: { maxSuppressions: -1 } }).maxSuppressions).toBeUndefined()
  })

  it('drops a non-integer cap', () => {
    expect(readSettings({ ploaness: { maxSuppressions: 2.5 } }).maxSuppressions).toBeUndefined()
  })
})

describe('vulnerability settings', () => {
  const entry: Record<string, unknown> = {
    advisory: 'GHSA-93q8-gq69-wqmw',
    reason: 'reachable only through the dev server',
    addedOn: '2026-08-23',
  }

  it('reads a fully recorded exception', () => {
    const settings: Settings = readSettings({ ploaness: { vulnerabilityAllowlist: [entry] } })
    expect(settings.vulnerabilityAllowlist).toEqual([entry])
  })

  // An unexplained or undated exception is one nobody can review, so it is dropped and the finding
  // returns rather than being quietly excused.
  it('drops an exception with no reason', () => {
    const { reason: _reason, ...rest } = entry
    expect(
      readSettings({ ploaness: { vulnerabilityAllowlist: [rest] } }).vulnerabilityAllowlist,
    ).toEqual([])
  })

  it('drops an exception with no addition date', () => {
    const { addedOn: _addedOn, ...rest } = entry
    expect(
      readSettings({ ploaness: { vulnerabilityAllowlist: [rest] } }).vulnerabilityAllowlist,
    ).toEqual([])
  })

  it('drops an exception whose date is not a date', () => {
    const malformed: Record<string, unknown> = { ...entry, addedOn: 'last tuesday' }
    expect(
      readSettings({ ploaness: { vulnerabilityAllowlist: [malformed] } }).vulnerabilityAllowlist,
    ).toEqual([])
  })

  it('drops an entry that is not an object', () => {
    expect(
      readSettings({ ploaness: { vulnerabilityAllowlist: ['GHSA-1'] } }).vulnerabilityAllowlist,
    ).toEqual([])
  })

  it('drops a whole allowlist that is not a list', () => {
    expect(
      readSettings({ ploaness: { vulnerabilityAllowlist: 'GHSA-1' } }).vulnerabilityAllowlist,
    ).toEqual([])
  })

  it('reads a declared severity', () => {
    expect(readSettings({ ploaness: { vulnerabilitySeverity: 'low' } }).vulnerabilitySeverity).toBe(
      'low',
    )
  })

  it('leaves the severity undeclared when it is not a string', () => {
    expect(
      readSettings({ ploaness: { vulnerabilitySeverity: 3 } }).vulnerabilitySeverity,
    ).toBeUndefined()
  })
})

describe('secretAllowlist', () => {
  const entry: Record<string, unknown> = {
    path: 'tests/fixtures/key.json',
    reason: 'fake test key asserted on by a fixture',
  }

  it('reads a fully recorded exception', () => {
    expect(readSettings({ ploaness: { secretAllowlist: [entry] } }).secretAllowlist).toEqual([
      entry,
    ])
  })

  it('drops an exception with no reason, so a typo re-exposes the finding', () => {
    const { reason: _reason, ...rest } = entry
    expect(readSettings({ ploaness: { secretAllowlist: [rest] } }).secretAllowlist).toEqual([])
  })

  it('drops an exception with an empty reason', () => {
    const blank: Record<string, unknown> = { ...entry, reason: ' '.repeat(3) }
    expect(readSettings({ ploaness: { secretAllowlist: [blank] } }).secretAllowlist).toEqual([])
  })

  it('drops an entry that is not an object', () => {
    expect(readSettings({ ploaness: { secretAllowlist: ['a.json'] } }).secretAllowlist).toEqual([])
  })

  it('drops a whole allowlist that is not a list', () => {
    expect(readSettings({ ploaness: { secretAllowlist: 'a.json' } }).secretAllowlist).toEqual([])
  })

  it('defaults to excusing nothing', () => {
    expect(readSettings({}).secretAllowlist).toEqual([])
  })
})

// Harness Integrity: a setting may make the harness stricter, never looser. Both of these used to be
// one-line escapes - one narrowed five gates' scope, the other made the bundle budget unreachable.
describe('settings that cannot loosen the harness', () => {
  it('adds a declared source root to the shipped ones rather than replacing them', () => {
    const roots: readonly string[] = readSettings({
      ploaness: { sourceRoots: ['app'] },
    }).sourceRoots
    expect(roots).toContain('app')
    expect(roots).toContain('tests')
    expect(roots).toContain('scripts')
  })

  it('cannot drop a shipped source root by declaring a narrower list', () => {
    expect(readSettings({ ploaness: { sourceRoots: ['src'] } }).sourceRoots).toContain('tests')
  })

  it('does not repeat a root a project declares that is already shipped', () => {
    const roots: readonly string[] = readSettings({
      ploaness: { sourceRoots: ['src'] },
    }).sourceRoots
    expect(roots.filter((root: string): boolean => root === 'src')).toHaveLength(1)
  })

  it('honours a stricter bundle budget', () => {
    const budget: number = readSettings({ ploaness: { bundleBudgetBytes: 1024 } }).bundleBudgetBytes
    expect(budget).toBe(1024)
  })

  it('refuses a bundle budget larger than the shipped ceiling', () => {
    const shipped: number = readSettings({}).bundleBudgetBytes
    const raised: number = readSettings({
      ploaness: { bundleBudgetBytes: shipped * 100 },
    }).bundleBudgetBytes
    expect(raised).toBe(shipped)
  })
})
