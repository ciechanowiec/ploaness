// The pinned browser server a contract runs its pages in, started with the arguments the e2e gate uses
// and reached as the suite reaches it, so a contract judges the engines the sweep runs.
//
// Used from the repository root after `pnpm run build`, with the pinned Playwright image present.
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
export type Page = Parameters<typeof MeasurePage>[0]
export type Browser = NonNullable<ReturnType<ReturnType<Page['context']>['browser']>>
type BrowserType = ReturnType<Browser['browserType']>

/** A started server. */
export interface PinnedServer {
  /** Connect to one engine, waiting for the server to answer. */
  readonly connect: (engine: string) => Promise<Browser>
  /** Remove the server's container. */
  readonly stop: () => void
}

const SECRET_BYTES: number = 16
const START_ATTEMPTS: number = 60
const RETRY_MS: number = 1000

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

/** The Playwright the config package declares: its browser types, version, and core's directory. */
interface PinnedPlaywright {
  readonly playwright: Readonly<Record<string, BrowserType>>
  readonly version: string
  readonly playwrightCore: string
}

const pinnedPlaywright = async (): Promise<PinnedPlaywright> => {
  const configRequire: NodeJS.Require = createRequire(path.resolve('packages/config/package.json'))
  const playwright: Readonly<Record<string, BrowserType>> = (
    (await import(configRequire.resolve('@playwright/test'))) as { readonly default: Record<string, BrowserType> }
  ).default
  const coreManifest: string = createRequire(configRequire.resolve('@playwright/test/package.json')).resolve(
    'playwright-core/package.json',
  )
  const { version } = configRequire(coreManifest) as { readonly version: string }
  return { playwright, version, playwrightCore: realpathSync(path.dirname(coreManifest)) }
}

/**
 * Start the pinned browser server.
 * @param purpose names the container, beside this process's id.
 * @returns the server.
 */
export const startPinnedServer = async (purpose: string): Promise<PinnedServer> => {
  const port: number = await freePort()
  const secret: string = randomBytes(SECRET_BYTES).toString('hex')
  const { playwright, version, playwrightCore }: PinnedPlaywright = await pinnedPlaywright()
  const name: string = `ploaness-${purpose}-${String(process.pid)}`
  const started: string = execFileSync('ps', ['-o', 'lstart=', '-p', String(process.pid)], { encoding: 'utf8' })
    .trim()
    .replaceAll(/\s+/gu, ' ')
  const owner: { readonly pid: number; readonly started: string; readonly host: string } = {
    pid: process.pid,
    started,
    host: hostname(),
  }
  execFileSync(
    'docker',
    pinnedBrowserServerArguments({
      image: playwrightImageOf(version),
      name,
      port,
      playwrightCore,
      isHostNetwork: false,
      secret,
      owner,
    }),
  )
  const connect = async (engine: string, attempt: number): Promise<Browser> => {
    const browserType: BrowserType | undefined = playwright[engine]
    if (browserType === undefined) {
      throw new Error(`Playwright has no ${engine}`)
    }
    try {
      return await browserType.connect(pinnedBrowserEndpoint(port, secret))
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
  return {
    connect: async (engine: string): Promise<Browser> => await connect(engine, 1),
    stop: (): void => {
      execFileSync('docker', ['rm', '--force', name])
    },
  }
}
