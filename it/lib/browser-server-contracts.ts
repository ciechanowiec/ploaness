// Exercise fresh-server ownership through the installed CLI, runner, wrapper and real Next application.
import { type ChildProcess, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import type { Server as HttpServer } from 'node:http'
import { createRequire } from 'node:module'
import { createServer, type Server } from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { asRecord, asText, VERIFICATION_ENVIRONMENT_VARIABLE } from '@ploaness/governance'
import {
  arePortsFree,
  type CommandResult,
  close,
  freePort,
  healthServer,
  invoke,
  listen,
  requireResult,
  SIBLING_ENVIRONMENT_VARIABLE,
  stopApp,
  waitForApp,
  waitUntil,
} from './browser-server-support.js'

const EXECUTABLE_ARGUMENT: number = 2
const library: string = path.dirname(fileURLToPath(import.meta.url))
const manifestPath: string = path.resolve('package.json')
const manifest: Record<string, unknown> = asRecord(JSON.parse(readFileSync(manifestPath, 'utf8')))
const originalSettings: Record<string, unknown> = asRecord(manifest['ploaness'])
const serverUrl: string = asText(originalSettings['serverUrl'])
const appPort: number = Number(new URL(serverUrl).port)
const executable: string | undefined = process.argv[EXECUTABLE_ARGUMENT]
if (executable === undefined) {
  throw new Error('Expected the packed ploaness executable')
}

const JSON_INDENT: number = 2
const ESCAPED_QUOTE: string = String.raw`'\''`
const shellQuote = (value: string): string => `'${value.replaceAll("'", (): string => ESCAPED_QUOTE)}'`

// What each helper answers. The second starts in `services/` and answers with the value only that
// directory's environment file holds, so the spec fails when a started sibling never read its own files.
const SIBLING_VALUE: string = 'from-services'
const HELPER_BODIES: readonly string[] = ['alpha', `beta ${SIBLING_VALUE}`]

const helperCommand = (identity: string): string =>
  [
    shellQuote(process.execPath),
    '--import=tsx/esm',
    shellQuote(path.join(library, 'browser-test-server.ts')),
    identity,
  ].join(' ')

const writeSettings = (settings: Readonly<Record<string, unknown>>): void => {
  writeFileSync(manifestPath, `${JSON.stringify({ ...manifest, ploaness: settings }, null, JSON_INDENT)}\n`)
}

const resetEvidence = (): void => {
  for (const file of ['.wrapper-marker', '.browser-tests-ran', '.started-alpha', 'services/.started-beta']) {
    rmSync(file, { force: true })
  }
}

const requireNoStartup = (): void => {
  for (const file of ['.wrapper-marker', '.browser-tests-ran', '.started-alpha', 'services/.started-beta']) {
    if (existsSync(file)) {
      throw new Error(`An occupied endpoint reached browser startup: ${file}`)
    }
  }
}

const gate = async (): Promise<CommandResult> =>
  await invoke(executable, ['gate', 'e2e'], { [VERIFICATION_ENVIRONMENT_VARIABLE]: '0' })

const occupied = async (server: Server, url: string, host: string = '127.0.0.1'): Promise<void> => {
  resetEvidence()
  await listen(server, Number(new URL(url).port), host)
  try {
    requireResult(await gate(), 1, `${url} is in use; stop the existing server`)
    requireNoStartup()
    if (!server.listening) {
      throw new Error('Verification stopped an existing server it did not own')
    }
  } finally {
    await close(server)
  }
}

const configContracts = async (): Promise<void> => {
  const inspector: string = path.join(library, 'browser-server-config.ts')
  const manual: CommandResult = await invoke(process.execPath, [inspector, 'reuse', '0'], {
    [VERIFICATION_ENVIRONMENT_VARIABLE]: undefined,
  })
  requireResult(manual, 0, 'all browser servers use reuse mode')
  const verification: CommandResult = await invoke(process.execPath, [inspector, 'fresh', '0'], {
    [VERIFICATION_ENVIRONMENT_VARIABLE]: '1',
  })
  requireResult(verification, 0, 'all browser servers use fresh mode')
  const continuous: CommandResult = await invoke(process.execPath, [inspector, 'fresh', '0'], {
    CI: 'true',
    [VERIFICATION_ENVIRONMENT_VARIABLE]: undefined,
  })
  requireResult(continuous, 0, 'all browser servers use fresh mode')
}

const writeBrowserSpec = (helperUrls: readonly string[]): void => {
  rmSync('tests/e2e', { recursive: true, force: true })
  mkdirSync('tests/e2e', { recursive: true })
  mkdirSync('src/app/api/verification-mode', { recursive: true })
  writeFileSync(
    'src/app/api/verification-mode/route.ts',
    [
      "export const dynamic = 'force-dynamic'",
      'export function GET(): Response { return Response.json({ mode: process.env.NODE_ENV }) }',
      '',
    ].join('\n'),
  )
  writeFileSync(
    'tests/e2e/server-ownership.e2e.spec.ts',
    [
      "import { writeFileSync } from 'node:fs'",
      "import { expect, test } from '@playwright/test'",
      "test('drives the application and both helper services', async ({ page, request }) => {",
      "  await page.goto('/')",
      "  await expect(page.getByRole('heading', { name: 'Accessibility contract' })).toBeVisible()",
      "  const mode = await request.get('/api/verification-mode')",
      '  const isVerification: boolean =',
      `    process.env[${JSON.stringify(VERIFICATION_ENVIRONMENT_VARIABLE)}] !== undefined`,
      "  const expected: string = isVerification ? 'production' : 'development'",
      '  expect(await mode.json()).toEqual({ mode: expected })',
      `  const urls = ${JSON.stringify(helperUrls)}`,
      '  for (const [index, url] of urls.entries()) {',
      '    const response = await request.get(url)',
      '    expect(response.ok()).toBe(true)',
      `    expect(await response.text()).toBe(${JSON.stringify(HELPER_BODIES)}[index])`,
      '  }',
      "  writeFileSync('.browser-tests-ran', 'passed')",
      '})',
      '',
    ].join('\n'),
  )
}

const freshStartup = async (ports: readonly number[]): Promise<void> => {
  resetEvidence()
  requireResult(await gate(), 0, '[PASS] e2e')
  if (readFileSync('.wrapper-marker', 'utf8') !== '1' || !existsSync('.browser-tests-ran')) {
    throw new Error('The gate lost its verification marker or did not execute the browser assertions')
  }
  for (const file of ['.started-alpha', 'services/.started-beta']) {
    if (!existsSync(file)) {
      throw new Error(`The runner did not start its declared helper: ${file}`)
    }
  }
  for (const port of ports) {
    const server: Server = createServer()
    await listen(server, port)
    await close(server)
  }
}

const HELD_SPEC: string = 'tests/e2e/held.e2e.spec.ts'
const HELD_MARKER: string = '.browser-tests-held'
const RELEASE_TIMEOUT_MS: number = 15_000

// A run ended by SIGTERM, as a cancelled CI job ends it, must stop the servers it started. Playwright
// starts each one detached, in a process group of its own, so ending the run's group does not reach them.
// The held spec keeps the run open until every server answers, so the signal arrives mid-run.
const terminated = async (ports: readonly number[]): Promise<void> => {
  writeFileSync(
    HELD_SPEC,
    [
      "import { writeFileSync } from 'node:fs'",
      "import { test } from '@playwright/test'",
      "test('holds the run open until it is terminated', async () => {",
      `  writeFileSync(${JSON.stringify(HELD_MARKER)}, 'held')`,
      '  await new Promise<never>(() => {})',
      '})',
      '',
    ].join('\n'),
  )
  rmSync(HELD_MARKER, { force: true })
  const run: ChildProcess = spawn(executable, ['gate', 'e2e'], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, CI: '', [VERIFICATION_ENVIRONMENT_VARIABLE]: '0' },
  })
  try {
    await waitUntil((): boolean => existsSync(HELD_MARKER), 'the held spec runs')
  } finally {
    await stopApp(run)
    rmSync(HELD_SPEC, { force: true })
    rmSync(HELD_MARKER, { force: true })
  }
  await waitUntil(
    async (): Promise<boolean> => await arePortsFree(ports),
    `a terminated run stops every server it started, on ports ${ports.join(', ')}`,
    RELEASE_TIMEOUT_MS,
  )
}

const manualReuse = async (helperPorts: readonly number[]): Promise<void> => {
  const consumerRequire: NodeJS.Require = createRequire(manifestPath)
  const helpers: readonly HttpServer[] = HELPER_BODIES.map((body: string): HttpServer => healthServer(body))
  const app: ChildProcess = spawn(
    process.execPath,
    [consumerRequire.resolve('next/dist/bin/next'), 'dev', '--port', String(appPort)],
    { detached: true, stdio: 'ignore', env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' } },
  )
  try {
    for (const [index, server] of helpers.entries()) {
      await listen(server, helperPorts[index])
    }
    await waitForApp(serverUrl)
    resetEvidence()
    requireResult(await gate(), 1, `${serverUrl} is in use; stop the existing server`)
    requireNoStartup()
    const playwright: string = path.join(path.dirname(consumerRequire.resolve('@playwright/test')), 'cli.js')
    const result: CommandResult = await invoke(process.execPath, [playwright, 'test', '--reporter=line'], {
      [VERIFICATION_ENVIRONMENT_VARIABLE]: undefined,
    })
    requireResult(result, 0, '1 passed')
    if (!(existsSync('.browser-tests-ran') && helpers.every((server: HttpServer): boolean => server.listening))) {
      throw new Error('The manual run did not reuse and preserve the existing services')
    }
    await waitForApp(serverUrl)
  } finally {
    await stopApp(app)
    for (const server of helpers) {
      await close(server)
    }
  }
}

const helperPorts: readonly number[] = [await freePort(), await freePort()]
const helperUrls: readonly string[] = helperPorts.map(
  (port: number): string => `http://127.0.0.1:${String(port)}/health`,
)
const settings: Readonly<Record<string, unknown>> = {
  ...originalSettings,
  auxiliaryServers: helperUrls.map((url: string, index: number) => ({
    command: helperCommand(index === 0 ? 'alpha' : 'beta'),
    url,
    ...(index !== 0 && { cwd: 'services' }),
  })),
  testWrapper: [process.execPath, path.join(library, 'browser-test-wrapper.ts')],
}
mkdirSync('services', { recursive: true })
writeFileSync('services/.env', `${SIBLING_ENVIRONMENT_VARIABLE}=${SIBLING_VALUE}\n`)
// The application has an environment file of its own as well: Next's loader marks the runner only after
// it has loaded a file, and that mark is what reaches the helpers.
writeFileSync('.env', 'PLOANESS_FIXTURE_APPLICATION_ENVIRONMENT=present\n')
writeSettings(settings)
writeBrowserSpec(helperUrls)
await configContracts()
for (const url of [serverUrl, ...helperUrls]) {
  await occupied(healthServer('occupied'), url)
}
// The real HTTP service returns 404 away from /health; the TCP listener never sends an HTTP response.
await occupied(healthServer('unhealthy'), serverUrl)
await occupied(createServer(), serverUrl)
const localhostUrl: string = serverUrl.replace('127.0.0.1', 'localhost')
writeSettings({ ...settings, serverUrl: localhostUrl })
await occupied(createServer(), localhostUrl)
await occupied(createServer(), localhostUrl, '::1')
writeSettings({ ...settings, serverUrl: 'file:///browser-server' })
requireResult(await gate(), 1, 'browser server URLs must use http or https')
writeSettings(settings)
await freshStartup([appPort, ...helperPorts])
const nextConfig: string = readFileSync('next.config.ts', 'utf8')
writeFileSync('next.config.ts', nextConfig.replace('export default {', "export default { output: 'standalone',"))
await freshStartup([appPort, ...helperPorts])
await terminated([appPort, ...helperPorts])
await manualReuse(helperPorts)
console.info('browser server ownership contracts passed')
