// `ploaness sync`: the only command that writes managed files. Everything else reads them.
import { type SyncChange, syncAssets } from '../checks/assets.js'
import type { Context } from '../context.js'

/** Materialise the managed files, then report exactly what changed. */
export const sync = (context: Context): number => {
  const changes: readonly SyncChange[] = syncAssets(context)
  if (changes.length === 0) {
    console.info('ploaness sync: every managed path already matches the catalogue.')
    return 0
  }
  console.info(`ploaness sync: ${changes.length} change(s)`)
  for (const change of changes) {
    console.info(`  ${change.action} ${change.path}`)
  }
  const refused: readonly SyncChange[] = changes.filter(
    (change: SyncChange): boolean => change.action === 'refused',
  )
  if (refused.length > 0) {
    console.error(
      `\n${refused.length} file(s) carry duplicate, out-of-order, or non-leading ploaness markers.\nRepair the markers by hand, then run \`ploaness sync\` again.`,
    )
    return 1
  }
  console.info('\nReview these edits and commit them.')
  return 0
}
