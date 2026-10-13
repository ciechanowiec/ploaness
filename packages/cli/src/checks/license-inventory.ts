import type { Context } from '../context.js'
import { type RunResult, run } from '../exec.js'

/**
 * Ask pnpm for the licence inventory of the resolved set.
 *
 * `--recursive` is what makes it the resolved set of a workspace. Without it pnpm reports the root
 * importer alone, so every dependency a member declares - the application's framework included - was
 * never measured by the gates that read this inventory.
 * @param context the repository whose installation is read.
 * @param isProductionOnly whether to restrict the inventory to the production graph of every importer.
 * @returns the pnpm run; its `stdout` is the JSON inventory grouped by licence.
 */
export const runLicenseInventory = (context: Context, isProductionOnly: boolean = false): RunResult =>
  run('pnpm', ['licenses', 'list', '--recursive', ...(isProductionOnly ? ['--prod'] : []), '--json'], {
    cwd: context.root,
  })
