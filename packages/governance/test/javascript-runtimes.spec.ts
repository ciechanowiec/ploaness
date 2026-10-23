import { describe, expect, it } from 'vitest'
import { isJavascriptRuntime, type RuntimeRole, rolesFor, runtimesOf } from '../src/javascript-runtimes.js'
import { findUndeclaredRuntimes, readSettings, type Settings } from '../src/settings.js'
import { readMemberSettings } from '../src/settings-layering.js'

const EDGE: string = String.raw`^edge/viewer-request\.cjs$`
const REASON: string = 'the CloudFront Function of the website, which CloudFront runs without a build step'

const allowlisted = (entry: Readonly<Record<string, unknown>>): Settings =>
  readSettings({ ploaness: { javascriptAllowlist: [{ pattern: EDGE, reason: REASON, ...entry }] } })

describe('isJavascriptRuntime', () => {
  it('accepts the engines the harness lints for and nothing else', () => {
    expect(isJavascriptRuntime('node')).toBe(true)
    expect(isJavascriptRuntime('cloudfront-js-2.0')).toBe(true)
    expect(isJavascriptRuntime('cloudfront-js-1.0')).toBe(false)
    expect(isJavascriptRuntime(undefined)).toBe(false)
  })
})

describe('runtimesOf', () => {
  const roles: readonly RuntimeRole[] = [
    { role: '^edge/', runtime: 'cloudfront-js-2.0' },
    { role: { memberPath: 'web', pattern: '^tools/' }, runtime: 'node' },
  ]

  it('names the engine of the entry a file matches, scoped as the entry is', () => {
    expect(runtimesOf('edge/viewer-request.cjs', roles)).toEqual(['cloudfront-js-2.0'])
    expect(runtimesOf('web/tools/build.mjs', roles)).toEqual(['node'])
    expect(runtimesOf('tools/build.mjs', roles)).toEqual([])
  })

  it('reports both engines when two entries disagree about one file', () => {
    expect(runtimesOf('edge/a.cjs', [...roles, { role: String.raw`\.cjs$`, runtime: 'node' }])).toEqual([
      'node',
      'cloudfront-js-2.0',
    ])
  })

  it('selects the roles of one engine', () => {
    expect(rolesFor(roles, 'cloudfront-js-2.0')).toEqual(['^edge/'])
  })
})

describe('the runtime an allowlist entry declares', () => {
  it('honours an entry that declares a known runtime', () => {
    const settings: Settings = allowlisted({ runtime: 'cloudfront-js-2.0' })
    expect(settings.javascriptAllowlist).toContain(EDGE)
    expect(rolesFor(settings.javascriptRuntimes, 'cloudfront-js-2.0')).toEqual([EDGE])
    expect(findUndeclaredRuntimes(settings.declaredExclusions)).toEqual([])
  })

  it('keeps the same file plain Node.js when it is declared so', () => {
    const settings: Settings = allowlisted({ runtime: 'node' })
    expect(runtimesOf('edge/viewer-request.cjs', settings.javascriptRuntimes)).toEqual(['node'])
  })

  it('refuses an entry without a runtime, naming the values it may declare', () => {
    const settings: Settings = allowlisted({})
    expect(settings.javascriptAllowlist).not.toContain(EDGE)
    expect(findUndeclaredRuntimes(settings.declaredExclusions)).toEqual([
      `javascriptAllowlist entry "${EDGE}" declares no runtime; ` +
        'declare the engine its file runs in, one of: node, cloudfront-js-2.0',
    ])
  })

  it('refuses an entry declaring a runtime the harness does not lint for', () => {
    const settings: Settings = allowlisted({ runtime: 'cloudfront-js-1.0' })
    expect(settings.javascriptAllowlist).not.toContain(EDGE)
    expect(findUndeclaredRuntimes(settings.declaredExclusions)[0]).toContain(
      'declares unknown runtime "cloudfront-js-1.0"',
    )
  })

  it.each([
    ['a bare pattern', EDGE],
    ['a value that is not an entry', 0],
  ])('refuses %s, which can state no runtime', (_: string, entry: unknown) => {
    const settings: Settings = readSettings({ ploaness: { javascriptAllowlist: [entry] } })
    expect(findUndeclaredRuntimes(settings.declaredExclusions)[0]).toContain('declares no runtime')
  })

  it('asks no other setting for a runtime', () => {
    const settings: Settings = readSettings({
      ploaness: { typographyExclusions: [{ pattern: '^generated/', reason: 'generated' }] },
    })
    expect(findUndeclaredRuntimes(settings.declaredExclusions)).toEqual([])
  })

  it('declares the built-in allowlist as Node.js', () => {
    expect(runtimesOf('eslint.config.mjs', readSettings({}).javascriptRuntimes)).toEqual(['node'])
  })

  it('keeps the runtime of a root entry for the member it reaches, and refuses one without', () => {
    const settings: Settings = readMemberSettings(
      {
        javascriptAllowlist: [
          { pattern: '^app/edge/', reason: REASON, runtime: 'cloudfront-js-2.0' },
          { pattern: '^app/tools/', reason: REASON },
        ],
      },
      { javascriptAllowlist: [{ pattern: '^own/', reason: REASON, runtime: 'node' }] },
      'app',
    )
    expect(runtimesOf('edge/viewer-request.cjs', settings.javascriptRuntimes)).toEqual(['cloudfront-js-2.0'])
    expect(runtimesOf('own/build.mjs', settings.javascriptRuntimes)).toEqual(['node'])
    expect(runtimesOf('tools/build.mjs', settings.javascriptRuntimes)).toEqual([])
  })
})
