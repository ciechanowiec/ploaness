// The auxiliary service started by the packed Playwright configuration.
import { writeFileSync } from 'node:fs'
import type { Server } from 'node:http'
import { healthServer, listen } from './browser-server-support.js'

const IDENTITY_ARGUMENT: number = 2
const identity: string | undefined = process.argv[IDENTITY_ARGUMENT]
const port: number = Number(process.env['PORT'])
if (identity === undefined || !Number.isSafeInteger(port) || port <= 0) {
  throw new Error('Expected a service identity and a fixed PORT')
}
const server: Server = healthServer(identity)
await listen(server, port)
writeFileSync(`.started-${identity}`, String(process.pid))
