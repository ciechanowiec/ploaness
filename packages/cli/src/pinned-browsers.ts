// The pinned browsers a verification run measures in, and the application clock it runs at.
//
// The browsers run in the Playwright image of the version the project resolves, started here before the
// suite and removed after it. The image is never pulled during verification: a run that fetched it
// would depend on the network and on what the registry serves that day, so a missing image is a failure
// that names the command to fetch it beforehand.
import { realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createConnection, createServer, type Server, type Socket } from 'node:net'
import path from 'node:path'
import {
  CLOCK_ENVIRONMENT_VARIABLE,
  pinnedBrowserEndpoint,
  pinnedBrowserServerArguments,
  playwrightImageOf,
  REAL_CLOCK,
} from '@ploaness/governance'
import type { Context } from './context.js'
import { failed, type GateResult, type RunResult, run } from './exec.js'

const START_TIMEOUT_MS: number = 60_000

// Long enough for the server to start on a machine whose host network works, short enough that a machine
// whose does not falls back to the tunnel without delaying the run much.
const HOST_NETWORK_PROBE_MS: number = 20_000

const POLL_MS: number = 250

const MILLISECONDS_PER_SECOND: number = 1000

/** The browsers a run connects to, and how to remove them afterwards. */
export interface PinnedBrowsers {
  readonly endpoint: string
  readonly stop: () => void
  /** Whether pages reach the application only through the client's tunnel. */
  readonly isTunnelled: boolean
}

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

const isListening = async (port: number): Promise<boolean> =>
  await new Promise<boolean>((resolve): void => {
    const socket: Socket = createConnection({ host: '127.0.0.1', port })
    socket.once('connect', (): void => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', (): void => {
      resolve(false)
    })
  })

const isListeningBy = async (port: number, deadline: number): Promise<boolean> => {
  if (await isListening(port)) {
    return true
  }
  if (performance.now() > deadline) {
    return false
  }
  await new Promise<void>((resolve): void => {
    setTimeout(resolve, POLL_MS)
  })
  return await isListeningBy(port, deadline)
}

interface ResolvedPlaywright {
  readonly directory: string
  readonly version: string
}

// The `playwright-core` the project's own `@playwright/test` loads, which is the version the image must
// carry browsers for.
const resolvePlaywrightCore = (context: Context): ResolvedPlaywright | undefined => {
  try {
    const fromProject: NodeJS.Require = createRequire(path.join(context.root, 'package.json'))
    const testManifest: string = fromProject.resolve('@playwright/test/package.json')
    const fromTest: NodeJS.Require = createRequire(testManifest)
    const playwrightManifest: string = fromTest.resolve('playwright/package.json')
    const coreManifest: string = createRequire(playwrightManifest).resolve('playwright-core/package.json')
    const manifest: unknown = createRequire(coreManifest)(coreManifest)
    const version: unknown =
      typeof manifest === 'object' && manifest !== null ? Reflect.get(manifest, 'version') : undefined
    return typeof version === 'string' ? { directory: realpathSync(path.dirname(coreManifest)), version } : undefined
  } catch {
    return undefined
  }
}

/**
 * Start the pinned browser server for one end-to-end run.
 * @param context the member under test.
 * @returns the endpoint and its stop, or the failure that prevented starting it.
 */
export const startPinnedBrowsers = async (context: Context): Promise<PinnedBrowsers | GateResult> => {
  const playwright: ResolvedPlaywright | undefined = resolvePlaywrightCore(context)
  if (playwright === undefined) {
    return failed("playwright-core could not be resolved through the project's @playwright/test", [
      "install the project dependencies; the pinned browsers run the project's own Playwright",
    ])
  }
  const image: string = playwrightImageOf(playwright.version)
  const inspected: RunResult = run('docker', ['image', 'inspect', '--format={{.Id}}', image], { cwd: context.root })
  if (inspected.code !== 0) {
    return failed(`the pinned browser image ${image} is not available locally`, [
      `run \`docker pull ${image}\` before verification; the run never fetches it`,
      ...(inspected.output.length > 0 ? [inspected.output] : []),
    ])
  }
  // A Linux Docker engine shares the host's network, so the container reaches the application without a
  // tunnel. Docker Desktop's VM does not share the host's loopback, which shows as a server the host
  // cannot reach on its own loopback, and the run then publishes a port and tunnels instead.
  const shared: PinnedBrowsers | GateResult | undefined =
    process.platform === 'linux'
      ? await startServer(
          context,
          { image, playwrightCore: playwright.directory, isHostNetwork: true },
          HOST_NETWORK_PROBE_MS,
        )
      : undefined
  return shared === undefined || isStartFailure(shared)
    ? await startServer(
        context,
        { image, playwrightCore: playwright.directory, isHostNetwork: false },
        START_TIMEOUT_MS,
      )
    : shared
}

interface ServerPlan {
  readonly image: string
  readonly playwrightCore: string
  readonly isHostNetwork: boolean
}

const startServer = async (
  context: Context,
  plan: ServerPlan,
  timeoutMs: number,
): Promise<PinnedBrowsers | GateResult> => {
  const port: number = await freePort()
  const name: string = `ploaness-browsers-${String(port)}`
  const started: RunResult = run('docker', pinnedBrowserServerArguments({ ...plan, name, port }), { cwd: context.root })
  if (started.code !== 0) {
    return failed('the pinned browser server did not start', [started.output])
  }
  const stop = (): void => {
    run('docker', ['rm', '--force', name], { cwd: context.root })
  }
  if (!(await isListeningBy(port, performance.now() + timeoutMs))) {
    const logs: RunResult = run('docker', ['logs', name], { cwd: context.root })
    stop()
    return failed(`the pinned browser server did not listen within ${String(timeoutMs / MILLISECONDS_PER_SECOND)}s`, [
      logs.output,
    ])
  }
  return { endpoint: pinnedBrowserEndpoint(port), stop, isTunnelled: !plan.isHostNetwork }
}

/** Whether a start answered a failure rather than browsers. */
export const isStartFailure = (started: PinnedBrowsers | GateResult): started is GateResult => !('endpoint' in started)

const CLOCK_PRELOAD: string = import.meta.resolve('@ploaness/config/clock')

/**
 * The environment that starts an application process at the verification clock.
 * @param context the member.
 * @param nodeOptions the `NODE_OPTIONS` the process needs anyway.
 * @returns `NODE_OPTIONS` with the clock preload, and the instant; only `NODE_OPTIONS` for the real clock.
 */
export const clockedEnvironment = (context: Context, nodeOptions: string): Readonly<Record<string, string>> =>
  context.settings.clock === REAL_CLOCK
    ? { NODE_OPTIONS: nodeOptions }
    : {
        NODE_OPTIONS: `${nodeOptions} --import=${CLOCK_PRELOAD}`,
        [CLOCK_ENVIRONMENT_VARIABLE]: context.settings.clock,
      }
