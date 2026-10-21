// Resolve the application's production artifact through its own installed Next configuration loader.
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { type ProductionOutput, productionOutputOf, readKey } from '@ploaness/governance'

type ConfigLoader = (phase: string, directory: string) => Promise<unknown>
const isLoader = (value: unknown): value is ConfigLoader => typeof value === 'function'

/** The verified location and metadata shared by browser startup and bundle measurement. */
export interface ProductionBuild {
  readonly directory: string
  readonly output: ProductionOutput
}

/**
 * Load production configuration and require the build markers Next emits for server output.
 * @param root the application directory, in a process running with the production environment.
 * @returns the configured output directory and its recorded server layout.
 */
export const readProductionBuild = async (root: string): Promise<ProductionBuild> => {
  const requireProject: NodeJS.Require = createRequire(path.join(root, 'package.json'))
  const loadModule: unknown = requireProject('next/dist/server/config.js')
  const load: unknown = readKey(loadModule, 'default')
  if (!isLoader(load)) {
    throw new TypeError('the installed Next configuration loader is unavailable')
  }
  const config: unknown = await load('phase-production-server', root)
  const distributionDirectory: unknown = readKey(config, 'distDir')
  if (typeof distributionDirectory !== 'string' || readKey(config, 'output') === 'export') {
    throw new TypeError('production verification needs Next server output; static export is unsupported')
  }
  const directory: string = path.resolve(root, distributionDirectory)
  const manifestPath: string = path.join(directory, 'required-server-files.json')
  if (!(existsSync(path.join(directory, 'BUILD_ID')) && existsSync(manifestPath))) {
    throw new Error(`production output is missing under ${directory}; run the build gate first`)
  }
  const manifest: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'))
  return { directory, output: productionOutputOf(manifest) }
}
