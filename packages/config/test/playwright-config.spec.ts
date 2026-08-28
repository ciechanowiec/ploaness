// The Playwright half of test integrity. Vitest's focused-test ban is an ESLint rule, while Playwright
// owns the equivalent switch in its runner config; both must be unconditional so a local verification
// cannot judge less than CI.
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
// The build output, for the reason vitest-config.spec.ts records: the config loaded below reads the
// settings module out of `dist`, and a spec comparing against a second instance proves less than it looks.
import { projectSettings } from '../dist/project-settings.js'

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
    pathToFileURL(path.join(specDirectory, '..', 'dist', 'playwright.js')).href
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

// The joint between the settings reader and the config that acts on it. Both halves matter, and the
// ORDER is the half that was wrong: Playwright awaits each webServer entry before starting the next, so
// an application that cannot answer until a declared server does was waited on until the budget ran out
// while that server sat unstarted behind it. The declared servers must also arrive whole, because the
// re-exported config leaves a project no other way to start one.
describe('the servers the end-to-end run starts', () => {
  it('starts exactly the auxiliary servers the project declared, in order, before the application', async () => {
    const config: PlaywrightConfig = await loadConfig()
    expect(config.webServer?.slice(0, projectSettings.auxiliaryServers.length)).toEqual(
      projectSettings.auxiliaryServers.map(
        (server: WebServer): WebServer => ({
          command: server.command,
          url: server.url,
        }),
      ),
    )
  })

  it('drives the application the project declares an origin for, last', async () => {
    const config: PlaywrightConfig = await loadConfig()
    expect(config.webServer?.at(-1)?.url).toBe(projectSettings.serverUrl)
  })
})
