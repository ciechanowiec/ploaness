// The pinned browsers a verification run measures in, and the application clock it runs at.
//
// The browsers run in the Playwright image of the version the project resolves, started here before the
// suite and removed after it. The image is never pulled during verification: a run that fetched it
// would depend on the network and on what the registry serves that day, so a missing image is a failure
// that names the command to fetch it beforehand.
import { randomBytes } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createConnection, createServer, type Server, type Socket } from 'node:net'
import { hostname } from 'node:os'
import path from 'node:path'
import {
  type BrowserServerOwner,
  browserServerListingArguments,
  CLOCK_ENVIRONMENT_VARIABLE,
  isOrphanedBrowserServer,
  type ListedBrowserServer,
  listedBrowserServers,
  pinnedBrowserEndpoint,
  pinnedBrowserServerArguments,
  playwrightImageOf,
  REAL_CLOCK,
} from '@ploaness/governance'
import type { Context } from './context.js'
import { failed, type GateResult, type RunResult, run } from './exec.js'

const START_TIMEOUT_MS: number = 60_000

const SECRET_BYTES: number = 16

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

// When a process started, as `ps` reports it; undefined when no process holds the PID.
const processStart = (context: Context, pid: number): string | undefined => {
  const result: RunResult = run('ps', ['-o', 'lstart=', '-p', String(pid)], { cwd: context.root })
  const started: string = result.output.trim().replaceAll(/\s+/gu, ' ')
  return started !== '' && result.code === 0 ? started : undefined
}

const isPresent = (context: Context, name: string): boolean =>
  run('docker', ['container', 'inspect', name], { cwd: context.root }).code === 0

// A run killed outright, by SIGKILL, a timeout or a machine that went to sleep, never removes its browser
// server, so each run first removes the ones whose owner is gone. Another run may remove the same one at
// the same moment, which is why a failed removal only counts while the container is still there.
const removeOrphans = (context: Context, host: string): GateResult | undefined => {
  const listed: RunResult = run('docker', [...browserServerListingArguments], { cwd: context.root })
  if (listed.code !== 0) {
    return failed('the browser servers earlier runs started could not be listed', [listed.output])
  }
  const stuck: readonly string[] = listedBrowserServers(listed.output)
    .filter(
      (server: ListedBrowserServer): boolean =>
        server.owner !== undefined &&
        isOrphanedBrowserServer(server.owner, host, processStart(context, server.owner.pid)),
    )
    .filter(
      (server: ListedBrowserServer): boolean =>
        run('docker', ['rm', '--force', server.name], { cwd: context.root }).code !== 0 &&
        isPresent(context, server.name),
    )
    .map((server: ListedBrowserServer): string => server.name)
  return stuck.length === 0
    ? undefined
    : failed('a browser server left by a run that no longer exists could not be removed', [
        `remove it with docker rm --force: ${stuck.join(', ')}`,
      ])
}

// This run, recorded on the server it starts, once the servers of runs that are gone have been removed.
const ownerAfterRemovingOrphans = (context: Context): BrowserServerOwner | GateResult => {
  const started: string | undefined = processStart(context, process.pid)
  if (started === undefined) {
    return failed('the run could not read its own start time, which marks the browser server it starts', [
      'ploaness reads it with `ps -o lstart= -p <pid>`; make `ps` available on the PATH',
    ])
  }
  const owner: BrowserServerOwner = { pid: process.pid, started, host: hostname() }
  return removeOrphans(context, owner.host) ?? owner
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
  const owner: BrowserServerOwner | GateResult = ownerAfterRemovingOrphans(context)
  if (!('pid' in owner)) {
    return owner
  }
  // A Linux Docker engine shares the host's network, so the container reaches the application without a
  // tunnel. Docker Desktop's VM does not share the host's loopback, which shows as a server the host
  // cannot reach on its own loopback, and the run then publishes a port and tunnels instead.
  const shared: PinnedBrowsers | GateResult | undefined =
    process.platform === 'linux'
      ? await startServer(
          context,
          { image, playwrightCore: playwright.directory, isHostNetwork: true, owner },
          HOST_NETWORK_PROBE_MS,
        )
      : undefined
  return shared === undefined || isStartFailure(shared)
    ? await startServer(
        context,
        { image, playwrightCore: playwright.directory, isHostNetwork: false, owner },
        START_TIMEOUT_MS,
      )
    : shared
}

interface ServerPlan {
  readonly image: string
  readonly playwrightCore: string
  readonly isHostNetwork: boolean
  readonly owner: BrowserServerOwner
}

const startServer = async (
  context: Context,
  plan: ServerPlan,
  timeoutMs: number,
): Promise<PinnedBrowsers | GateResult> => {
  const port: number = await freePort()
  const name: string = `ploaness-browsers-${String(port)}`
  const secret: string = randomBytes(SECRET_BYTES).toString('hex')
  const started: RunResult = run('docker', pinnedBrowserServerArguments({ ...plan, name, port, secret }), {
    cwd: context.root,
  })
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
  return { endpoint: pinnedBrowserEndpoint(port, secret), stop, isTunnelled: !plan.isHostNetwork }
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
