// Real processes and listeners for the packed browser-server contracts.
import { type ChildProcess, type ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http'
import { createServer, type Server } from 'node:net'
import { text } from 'node:stream/consumers'
import { setTimeout as delay } from 'node:timers/promises'

const COMMAND_TIMEOUT_MS: number = 240_000
const REQUEST_TIMEOUT_MS: number = 1000
const HTTP_OK: number = 200
const HTTP_NOT_FOUND: number = 404
const POLL_INTERVAL_MS: number = 100
const STARTUP_TIMEOUT_MS: number = 180_000

/** An external command's observable outcome. */
export interface CommandResult {
  readonly code: number
  readonly output: string
}

/** Run asynchronously so fixture listeners can answer the child while it verifies them. */
export const invoke = async (
  command: string,
  commandArguments: readonly string[],
  environment: Readonly<Record<string, string | undefined>> = {},
): Promise<CommandResult> => {
  const child: ChildProcessWithoutNullStreams = spawn(command, [...commandArguments], {
    env: { ...process.env, CI: '', ...environment },
    stdio: 'pipe',
    timeout: COMMAND_TIMEOUT_MS,
  })
  const completion: Promise<number> = new Promise<number>((resolve, reject): void => {
    child.once('error', reject)
    child.once('close', (code: number | null): void => {
      resolve(code ?? 1)
    })
  })
  const [code, stdout, stderr]: readonly [number, string, string] = await Promise.all([
    completion,
    text(child.stdout),
    text(child.stderr),
  ])
  return { code, output: `${stdout}${stderr}` }
}

/** Require both the exit code and the named finding, retaining diagnostics on failure. */
export const requireResult = (result: CommandResult, code: number, finding: string): void => {
  if (result.code !== code || !result.output.includes(finding)) {
    throw new Error(`Expected exit ${String(code)} and ${finding}\n${result.output}`)
  }
}

/** Start a real TCP or HTTP listener and return the kernel-assigned port. */
export const listen = async (server: Server, port: number = 0, host: string = '127.0.0.1'): Promise<number> => {
  await new Promise<void>((resolve, reject): void => {
    server.once('error', reject)
    server.listen(port, host, resolve)
  })
  const address: ReturnType<Server['address']> = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('The browser server fixture did not receive a TCP port')
  }
  return address.port
}

/** Close only the listener owned by this fixture. */
export const close = async (server: Server): Promise<void> => {
  await new Promise<void>((resolve, reject): void => {
    server.close((error: Error | undefined): void => {
      if (error === undefined) {
        resolve()
      } else {
        reject(error)
      }
    })
  })
}

/** Obtain a candidate port for a server the real runner will start. */
export const freePort = async (): Promise<number> => {
  const server: Server = createServer()
  const port: number = await listen(server)
  await close(server)
  return port
}

/** A health service whose identity makes reuse and fresh startup observable. */
export const healthServer = (identity: string): HttpServer =>
  createHttpServer((request, response): void => {
    response.writeHead(request.url === '/health' ? HTTP_OK : HTTP_NOT_FOUND, { 'Content-Type': 'text/plain' })
    response.end(identity)
  })

const isReady = async (url: string): Promise<boolean> => {
  try {
    const response: Response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
    const body: string = await response.text()
    return response.ok && body.includes('Accessibility contract')
  } catch {
    return false
  }
}

/** Wait for the real Next page, with a deadline rather than a fixed startup sleep. */
export const waitForApp = async (url: string, started: number = Date.now()): Promise<void> => {
  if (await isReady(url)) {
    return
  }
  if (Date.now() - started >= STARTUP_TIMEOUT_MS) {
    throw new Error(`The fixture application did not become ready at ${url}`)
  }
  await delay(POLL_INTERVAL_MS)
  await waitForApp(url, started)
}

/** Stop the process group created specifically for the manual-reuse contract. */
export const stopApp = async (child: ChildProcess): Promise<void> => {
  const pid: number | undefined = child.pid
  if (pid === undefined || child.exitCode !== null || child.signalCode !== null) {
    return
  }
  const completion: Promise<void> = new Promise<void>((resolve): void => {
    child.once('exit', (): void => {
      resolve()
    })
  })
  process.kill(-pid, 'SIGTERM')
  await completion
}
