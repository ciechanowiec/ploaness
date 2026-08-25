// The Playwright half of test integrity. Vitest's focused-test ban is an ESLint rule, while Playwright
// owns the equivalent switch in its runner config; both must be unconditional so a local verification
// cannot judge less than CI.
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

interface PlaywrightConfig {
  readonly forbidOnly?: boolean
}

const specDirectory: string = path.dirname(fileURLToPath(import.meta.url))

const loadConfig = async (): Promise<PlaywrightConfig> => {
  const loaded: unknown = await import(
    pathToFileURL(path.join(specDirectory, '..', 'playwright.js')).href
  )
  if (typeof loaded !== 'object' || loaded === null || !Object.hasOwn(loaded, 'default')) {
    throw new TypeError('playwright.js does not default-export a config')
  }
  return (loaded as { readonly default: PlaywrightConfig }).default
}

describe('focused Playwright tests', () => {
  it('refuses test.only in a local run as well as in CI', async () => {
    const config: PlaywrightConfig = await loadConfig()
    expect(config.forbidOnly).toBe(true)
  })
})
