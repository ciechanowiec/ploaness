// Install-script allowlist. The decision lives in governance; this reads the two files pnpm accepts it in.
//
// Left undeclared, every package in the resolved set may run a build or postinstall script during
// `pnpm install` - the broadest surface a project has for executing code it never called. The gate
// requires the allowlist to exist and says nothing about what is on it: which packages a project trusts
// with an install script is a decision for the project to record, not one the harness can make for it.
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { declaresInstallScriptAllowlist } from '@ploaness/governance'
import type { Context } from '../context.js'
import { failed, type GateResult, passed } from '../exec.js'

const WORKSPACE_FILE: string = 'pnpm-workspace.yaml'

const readWorkspace = (root: string): string => {
  const full: string = path.join(root, WORKSPACE_FILE)
  return existsSync(full) ? readFileSync(full, 'utf8') : ''
}

/** The project must name the dependencies permitted to run an install script. */
export const installScripts = (context: Context): GateResult =>
  declaresInstallScriptAllowlist(readWorkspace(context.root), context.packageJson)
    ? passed('the dependencies permitted to run an install script are declared')
    : failed('no install-script allowlist is declared', [
        `declare onlyBuiltDependencies in ${WORKSPACE_FILE}, or under the "pnpm" key of package.json`,
        'an empty list is a valid answer: it permits no dependency to run an install script',
      ])
