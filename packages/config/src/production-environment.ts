import { createRequire } from 'node:module'
import path from 'node:path'
import { readKey } from '@ploaness/governance'

type EnvironmentLoader = (directory: string, isDevelopment: boolean) => unknown
const isLoader = (value: unknown): value is EnvironmentLoader => typeof value === 'function'

/**
 * Prepare spec imports with the same environment expansion and precedence as the installed Next build.
 * The caller runs with NODE_ENV=production, as the end-to-end gate requires.
 * @param root the application directory.
 */
export const loadProductionEnvironment = (root: string): void => {
  const requireProject: NodeJS.Require = createRequire(path.join(root, 'package.json'))
  const requireNext: NodeJS.Require = createRequire(requireProject.resolve('next/package.json'))
  const environmentModule: unknown = requireNext('@next/env')
  const load: unknown = readKey(environmentModule, 'loadEnvConfig')
  if (!isLoader(load)) {
    throw new TypeError('the installed Next production environment loader is unavailable')
  }
  load(root, false)
}
