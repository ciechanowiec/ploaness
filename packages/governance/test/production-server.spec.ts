import { describe, expect, it } from 'vitest'
import {
  PRODUCTION_DIRECTORY_MARKER,
  parseProductionDirectory,
  productionOutputOf,
  shellArgument,
} from '../src/production-server.js'

describe('production output selection', () => {
  it('distinguishes ordinary and nested standalone output', () => {
    expect(productionOutputOf({ config: { distDir: '.next' }, relativeAppDir: '' })).toEqual({
      standalone: false,
      distDir: '.next',
      relativeAppDir: '',
    })
    expect(
      productionOutputOf({ config: { distDir: 'build', output: 'standalone' }, relativeAppDir: 'apps/cms' }),
    ).toEqual({
      standalone: true,
      distDir: 'build',
      relativeAppDir: 'apps/cms',
    })
  })
  it.each([
    {},
    { config: { distDir: '.next', output: 'export' }, relativeAppDir: '' },
    { config: { distDir: '.next' } },
  ])('refuses an unsupported or incomplete build %j', (manifest) => {
    expect(() => productionOutputOf(manifest)).toThrow('Next server output')
  })
  it('quotes paths without permitting shell substitution', () => {
    expect(shellArgument('/a b/$(name)')).toBe("'/a b/$(name)'")
    expect(shellArgument("it's/a/path")).toBe("'it'\"'\"'s/a/path'")
  })
})

describe('production directory evidence', () => {
  const report: string = `${PRODUCTION_DIRECTORY_MARKER}${JSON.stringify('/project/.production')}`

  it('reads the directory independently of configuration chatter', () => {
    expect(parseProductionDirectory(`configuration loaded\n${report}\r\n`)).toBe('/project/.production')
  })

  it.each(['', 'configuration loaded', `${report}\n${report}`])('rejects missing or duplicate evidence', (text) => {
    expect(parseProductionDirectory(text)).toBeUndefined()
  })

  it.each(['{', '{}', 'null', '[]', '1', '""', '"   "'])('rejects malformed evidence %s', (text) => {
    expect(parseProductionDirectory(`${PRODUCTION_DIRECTORY_MARKER}${text}`)).toBeUndefined()
  })
})
