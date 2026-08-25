// The Playwright half of test integrity. Vitest's focused-test ban is an ESLint rule, while Playwright
// owns the equivalent switch in its runner config; both must be unconditional so a local verification
// cannot judge less than CI.
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { projectSettings } from '../project-settings.js'

interface WebServer {
  readonly command: string
  readonly url: string
}

interface PlaywrightConfig {
  readonly forbidOnly?: boolean
  readonly webServer?: readonly WebServer[]
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

// The joint between the settings reader and the config that acts on it. Both halves matter: the
// application must stay first whatever a project declares, because `baseURL` and the pinned
// accessibility sweep drive that origin - and the declared servers must arrive whole, because the
// re-exported config leaves a project no other way to start one.
describe('the servers the end-to-end run starts', () => {
  it('drives the application the project declares an origin for, first', async () => {
    const config: PlaywrightConfig = await loadConfig()
    expect(config.webServer?.[0]?.url).toBe(projectSettings.serverUrl)
  })

  it('starts exactly the auxiliary servers the project declared, in order, after it', async () => {
    const config: PlaywrightConfig = await loadConfig()
    expect(config.webServer?.slice(1)).toEqual(
      projectSettings.auxiliaryServers.map(
        (server: WebServer): WebServer => ({
          command: server.command,
          url: server.url,
        }),
      ),
    )
  })
})
