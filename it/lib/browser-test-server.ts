// The auxiliary service started by the packed Playwright configuration.
import { writeFileSync } from 'node:fs'
import type { Server } from 'node:http'
import { createRequire } from 'node:module'
import path from 'node:path'
import { readKey } from '@ploaness/governance'
import { healthServer, listen, SIBLING_ENVIRONMENT_VARIABLE } from './browser-server-support.js'

const IDENTITY_ARGUMENT: number = 2
const identity: string | undefined = process.argv[IDENTITY_ARGUMENT]
const port: number = Number(process.env['PORT'])
if (identity === undefined || !Number.isSafeInteger(port) || port <= 0) {
  throw new Error('Expected a service identity and a fixed PORT')
}

// A sibling application reads the environment files of the directory it starts in through Next's own
// loader. The service does the same and answers with what it read, so the browser spec observes whether
// those files reached a server the runner started.
const requireConsumer: NodeJS.Require = createRequire(path.join(process.cwd(), 'package.json'))
const requireNext: NodeJS.Require = createRequire(requireConsumer.resolve('next/package.json'))
type EnvironmentLoader = (directory: string, isDevelopment: boolean) => unknown
const isLoader = (value: unknown): value is EnvironmentLoader => typeof value === 'function'
const load: unknown = readKey(requireNext('@next/env'), 'loadEnvConfig')
if (!isLoader(load)) {
  throw new TypeError('the installed Next environment loader is unavailable')
}
load(process.cwd(), true)
const sibling: string | undefined = process.env[SIBLING_ENVIRONMENT_VARIABLE]
const server: Server = healthServer(sibling === undefined ? identity : `${identity} ${sibling}`)
await listen(server, port)
writeFileSync(`.started-${identity}`, String(process.pid))
