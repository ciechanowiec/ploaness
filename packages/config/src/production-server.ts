// The verified browser suite starts the production artifact using the application's own Next install.
import { type ChildProcess, spawn } from 'node:child_process'
import { cpSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { type ProductionBuild, readProductionBuild } from './production-build.js'

const root: string = process.cwd()
const requireProject: NodeJS.Require = createRequire(path.join(root, 'package.json'))
const { directory, output }: ProductionBuild = await readProductionBuild(root)
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
