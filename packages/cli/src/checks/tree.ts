// Working-tree integrity: a fingerprint taken before the gates, and checked again after. Verification must
// judge the tree the project committed, not one a gate quietly rewrote as a side effect. A formatter or
// a code generator that edits during `verify` would otherwise let a build pass on content that is not in
// the repository, and the next clean checkout would fail.
import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { type Context, trackedFiles } from '../context.js'
import { failed, type GateResult, passed } from '../exec.js'

const fingerprint = (context: Context): string => {
  const hash: ReturnType<typeof createHash> = createHash('sha256')
  for (const file of trackedFiles(context.root)) {
    const full: string = path.join(context.root, file)
    hash.update(file)
    try {
      hash.update(statSync(full).isFile() ? readFileSync(full) : Buffer.alloc(0))
    } catch {
      // A tracked-but-deleted path contributes its name only, so deleting one still changes the digest.
      hash.update('<absent>')
    }
  }
  return hash.digest('hex')
}

let snapshot: string | undefined

/** Record the tree state before the gates that could modify it run. */
export const treeSnapshot = (context: Context): GateResult => {
  snapshot = fingerprint(context)
  return passed(`tree fingerprint recorded (${snapshot.slice(0, 12)})`)
}

/** Verify no gate modified a tracked file during verification. */
export const treeVerify = (context: Context): GateResult => {
  if (snapshot === undefined) {
    return passed('no tree snapshot was taken, so there is nothing to compare')
  }
  const current: string = fingerprint(context)
  return current === snapshot
    ? passed('the working tree is unchanged since verification began')
    : failed('a gate modified a tracked file during verification', [
        'run `ploaness format`, review the result, and commit it before verifying',
        `expected ${snapshot.slice(0, 12)} but found ${current.slice(0, 12)}`,
        'git status will show which files changed',
      ])
}
