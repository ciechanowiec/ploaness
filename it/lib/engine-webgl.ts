// Every pinned engine draws WebGL, so the engine pass judges the page a visitor's browser shows. The
// server starts with the arguments the e2e gate uses, and each engine connects as the suite does. Firefox
// draws nothing without what those arguments set up: a page asking for a WebGL context gets none, and a
// WebGL library logs the error the sweep reports.
//
// Run from the repository root after `pnpm run build`, with the pinned Playwright image present.
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createServer, type Server } from 'node:net'
import { hostname } from 'node:os'
import path from 'node:path'
import { pinnedBrowserEndpoint, pinnedBrowserServerArguments, playwrightImageOf } from '@ploaness/governance'
import type { measurePage as MeasurePage } from '../../packages/config/src/layout.ts'

// Playwright's types, reached through the config package that declares Playwright.
type Page = Parameters<typeof MeasurePage>[0]
type Browser = NonNullable<ReturnType<ReturnType<Page['context']>['browser']>>
type BrowserType = ReturnType<Browser['browserType']>

// The one browser call the page function below makes; the lint project compiles without the DOM lib.
declare const document: { readonly createElement: (tag: 'canvas') => { getContext: (kind: string) => unknown } }

const hasWebGlInPage = (): boolean => {
  const canvas: { getContext: (kind: string) => unknown } = document.createElement('canvas')
  return (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) !== null
}

const SECRET_BYTES: number = 16
const SECRET: string = randomBytes(SECRET_BYTES).toString('hex')

const freePort = async (): Promise<number> =>
  await new Promise<number>((resolve, reject): void => {
    const server: Server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', (): void => {
      const address: ReturnType<Server['address']> = server.address()
      const port: number = typeof address === 'object' && address !== null ? address.port : 0
      server.close((): void => {
        resolve(port)
      })
    })
  })

const PORT: number = await freePort()
const START_ATTEMPTS: number = 60
const RETRY_MS: number = 1000
const ENGINES: readonly string[] = ['chromium', 'firefox', 'webkit']

const configRequire: NodeJS.Require = createRequire(path.resolve('packages/config/package.json'))
const playwright: Readonly<Record<string, BrowserType>> = (
  (await import(configRequire.resolve('@playwright/test'))) as { readonly default: Record<string, BrowserType> }
).default
const coreManifest: string = createRequire(configRequire.resolve('@playwright/test/package.json')).resolve(
  'playwright-core/package.json',
)
const { version } = configRequire(coreManifest) as { readonly version: string }
const name: string = `ploaness-engine-webgl-${String(process.pid)}`
const playwrightCore: string = realpathSync(path.dirname(coreManifest))
const started: string = execFileSync('ps', ['-o', 'lstart=', '-p', String(process.pid)], { encoding: 'utf8' })
  .trim()
  .replaceAll(/\s+/gu, ' ')
execFileSync(
  'docker',
  pinnedBrowserServerArguments({
    image: playwrightImageOf(version),
    name,
    port: PORT,
    playwrightCore,
    isHostNetwork: false,
    secret: SECRET,
    owner: { pid: process.pid, started, host: hostname() },
  }),
)

const connect = async (engine: string, attempt: number): Promise<Browser> => {
  const browserType: BrowserType | undefined = playwright[engine]
  if (browserType === undefined) {
    throw new Error(`Playwright has no ${engine}`)
  }
  try {
    return await browserType.connect(pinnedBrowserEndpoint(PORT, SECRET))
  } catch (error) {
    if (attempt >= START_ATTEMPTS) {
      throw error
    }
    await new Promise<void>((resolve): void => {
      setTimeout(resolve, RETRY_MS)
    })
    return await connect(engine, attempt + 1)
  }
}

const canDrawWebGl = async (engine: string): Promise<boolean> => {
  const browser: Browser = await connect(engine, 1)
  try {
    const page: Page = await browser.newPage()
    return await page.evaluate(hasWebGlInPage)
  } finally {
    await browser.close()
  }
}

try {
  const drawn: readonly (readonly [string, boolean])[] = await Promise.all(
    ENGINES.map(async (engine: string): Promise<readonly [string, boolean]> => [engine, await canDrawWebGl(engine)]),
  )
  const without: readonly string[] = drawn.filter(([, isDrawn]) => !isDrawn).map(([engine]) => engine)
  if (without.length > 0) {
    throw new Error(`The pinned engines must draw WebGL; these drew none: ${without.join(', ')}`)
  }
  console.info('every pinned engine draws WebGL')
} finally {
  execFileSync('docker', ['rm', '--force', name])
}
