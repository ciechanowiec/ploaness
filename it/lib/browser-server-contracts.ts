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
  type CommandResult,
  close,
  freePort,
  healthServer,
  invoke,
  listen,
  requireResult,
  stopApp,
  waitForApp,
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
  const continuous: CommandResult = await invoke(process.execPath, [inspector, 'fresh', '2'], {
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
      "    expect(await response.text()).toBe(['alpha', 'beta'][index])",
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

const manualReuse = async (helperPorts: readonly number[]): Promise<void> => {
  const consumerRequire: NodeJS.Require = createRequire(manifestPath)
  const helpers: readonly HttpServer[] = [healthServer('alpha'), healthServer('beta')]
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
await manualReuse(helperPorts)
console.info('browser server ownership contracts passed')
