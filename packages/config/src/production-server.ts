// The verified browser suite starts the production artifact using the application's own Next install.
import { type ChildProcess, spawn } from 'node:child_process'
import { cpSync, existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { type ProductionOutput, productionOutputOf, readKey } from '@ploaness/governance'

type ConfigLoader = (phase: string, directory: string) => Promise<unknown>
const isLoader = (value: unknown): value is ConfigLoader => typeof value === 'function'

const root: string = process.cwd()
const requireProject: NodeJS.Require = createRequire(path.join(root, 'package.json'))
const loadModule: unknown = requireProject('next/dist/server/config.js')
const load: unknown = readKey(loadModule, 'default')
if (!isLoader(load)) {
  throw new TypeError('the installed Next configuration loader is unavailable')
}
const config: unknown = await load('phase-production-server', root)
const distributionDirectory: unknown = readKey(config, 'distDir')
if (typeof distributionDirectory !== 'string' || readKey(config, 'output') === 'export') {
  throw new TypeError('production browser verification needs Next server output; static export is unsupported')
}
const directory: string = path.resolve(root, distributionDirectory)
if (!(existsSync(path.join(directory, 'BUILD_ID')) && existsSync(path.join(directory, 'required-server-files.json')))) {
  throw new Error(`production output is missing under ${directory}; run ploaness gate e2e to rebuild and verify`)
}
const manifest: unknown = JSON.parse(readFileSync(path.join(directory, 'required-server-files.json'), 'utf8'))
const output: ProductionOutput = productionOutputOf(manifest)
const standaloneRoot: string = path.join(directory, 'standalone', output.relativeAppDir)

const copyAssets = (): void => {
  for (const [source, destination] of [
    [path.join(root, 'public'), path.join(standaloneRoot, 'public')],
    [path.join(directory, 'static'), path.join(standaloneRoot, output.distDir, 'static')],
  ] as const) {
    if (existsSync(source)) {
      cpSync(source, destination, { recursive: true, force: true })
    }
  }
}

if (output.standalone) {
  copyAssets()
  await import(pathToFileURL(path.join(standaloneRoot, 'server.js')).href)
} else {
  const child: ChildProcess = spawn(process.execPath, [requireProject.resolve('next/dist/bin/next'), 'start'], {
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'production' },
  })
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, (): void => {
      child.kill(signal)
    })
  }
  child.on('error', (error: Error): void => {
    throw error
  })
  child.on('exit', (code: number | null): void => {
    if (code === null) {
      process.exitCode = 1
      return
    }
    process.exitCode = code
  })
}
