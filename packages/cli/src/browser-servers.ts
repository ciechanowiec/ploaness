// TCP checks precede Playwright's HTTP readiness checks: an unhealthy listener still owns its port.
import type { LookupAddress } from 'node:dns'
import { lookup } from 'node:dns/promises'
import { createConnection, type Socket } from 'node:net'
import {
  type BrowserServerEndpoint,
  type BrowserServerProbe,
  browserServerConnectionFailure,
  browserServerEndpoint,
  browserServerProblem,
  combineBrowserServerProbes,
} from '@ploaness/governance'

const PROBE_TIMEOUT_MS: number = 5000

const probeAddress = (
  endpoint: BrowserServerEndpoint,
  address: LookupAddress,
  signal: AbortSignal,
): Promise<BrowserServerProbe> =>
  new Promise((resolve): void => {
    const socket: Socket = createConnection({
      host: address.address,
      family: address.family,
      port: endpoint.port,
      signal,
    })
    socket.once('connect', (): void => {
      socket.destroy()
      resolve({ status: 'occupied' })
    })
    socket.once('error', (error: NodeJS.ErrnoException): void => {
      resolve(browserServerConnectionFailure(error.code, error.message))
    })
  })

const probeAddresses = async (endpoint: BrowserServerEndpoint, signal: AbortSignal): Promise<BrowserServerProbe> => {
  const addresses: readonly LookupAddress[] = await lookup(endpoint.host, { all: true })
  signal.throwIfAborted()
  return combineBrowserServerProbes(
    await Promise.all(
      addresses.map((address: LookupAddress): Promise<BrowserServerProbe> => probeAddress(endpoint, address, signal)),
    ),
  )
}

const probeEndpoint = async (endpoint: BrowserServerEndpoint): Promise<BrowserServerProbe> => {
  const controller: AbortController = new AbortController()
  const timer: NodeJS.Timeout = setTimeout((): void => {
    controller.abort()
  }, PROBE_TIMEOUT_MS)
  const deadline: Promise<BrowserServerProbe> = new Promise<BrowserServerProbe>((resolve): void => {
    controller.signal.addEventListener(
      'abort',
      (): void => {
        resolve({
          status: 'unknown',
          detail: `the port check exceeded ${String(PROBE_TIMEOUT_MS)}ms`,
        })
      },
      { once: true },
    )
  })
  try {
    return await Promise.race([probeAddresses(endpoint, controller.signal), deadline])
  } catch (error: unknown) {
    return { status: 'unknown', detail: error instanceof Error ? error.message : String(error) }
  } finally {
    clearTimeout(timer)
    controller.abort()
  }
}

/** Check every declared browser endpoint before starting any browser server. */
export const browserServerProblems = async (urls: readonly string[]): Promise<readonly string[]> => {
  for (const url of urls) {
    try {
      const endpoint: BrowserServerEndpoint = browserServerEndpoint(url)
      const problem: string | undefined = browserServerProblem(endpoint, await probeEndpoint(endpoint))
      if (problem !== undefined) {
        return [problem]
      }
    } catch (error: unknown) {
      const detail: string = error instanceof Error ? error.message : String(error)
      return [`cannot check browser server ${url}: ${detail}; correct its configured URL and rerun verification`]
    }
  }
  return []
}
