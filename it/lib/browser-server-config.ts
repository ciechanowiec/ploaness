// Inspect the consumer's packed config in a fresh process, after its environment is fixed.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { asRecord, isArray, VERIFICATION_ENVIRONMENT_VARIABLE } from '@ploaness/governance'

const requireServers = (
  config: Record<string, unknown>,
  settings: Record<string, unknown>,
  shouldReuse: boolean,
): void => {
  const auxiliary: unknown = settings['auxiliaryServers']
  const servers: unknown = config['webServer']
  if (!(isArray(auxiliary) && isArray(servers)) || auxiliary.length === 0) {
    throw new Error('Expected nonempty auxiliary servers in the fixture and exported config')
  }
  const expectedUrls: readonly unknown[] = [
    ...auxiliary.map((server: unknown): unknown => asRecord(server)['url']),
    settings['serverUrl'],
  ]
  if (servers.length !== expectedUrls.length) {
    throw new Error('The config lost or added a browser server')
  }
  for (const [index, server] of servers.entries()) {
    const entry: Record<string, unknown> = asRecord(server)
    if (entry['url'] !== expectedUrls[index] || entry['reuseExistingServer'] !== shouldReuse) {
      throw new Error(`Wrong startup order or reuse policy at ${String(index)}: ${JSON.stringify(entry)}`)
    }
  }
}

const inspect = async (mode: string | undefined): Promise<void> => {
  if (mode !== 'reuse' && mode !== 'fresh') {
    throw new Error('Expected reuse or fresh config mode')
  }
  const RetriesArgument: number = 3
  const shouldReuse: boolean = mode === 'reuse'
  const manifestPath: string = path.resolve('package.json')
  const consumerRequire: NodeJS.Require = createRequire(manifestPath)
  const imported: unknown = await import(pathToFileURL(consumerRequire.resolve('ploaness/playwright')).href)
  const config: Record<string, unknown> = asRecord(asRecord(imported)['default'])
  const manifest: Record<string, unknown> = asRecord(JSON.parse(readFileSync(manifestPath, 'utf8')))
  const settings: Record<string, unknown> = asRecord(manifest['ploaness'])
  requireServers(config, settings, shouldReuse)
  if (config['retries'] !== Number(process.argv[RetriesArgument])) {
    throw new Error('The verification marker changed CI retry behavior')
  }
  console.info(`all browser servers use ${mode} mode`)
}

const MODE_ARGUMENT: number = 2
const mode: string | undefined = process.argv[MODE_ARGUMENT]
if (mode === '--environment') {
  console.info(VERIFICATION_ENVIRONMENT_VARIABLE)
} else {
  await inspect(mode)
}
