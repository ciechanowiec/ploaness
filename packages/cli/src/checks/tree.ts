// Working-tree integrity: a fingerprint taken before the gates, and checked again after. Verification must
// judge the tree the project committed, not one a gate quietly rewrote as a side effect. A formatter or
// a code generator that edits during `verify` would otherwise let a build pass on content that is not in
// the repository, and the next clean checkout would fail.
import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { type Context, workingTreeFiles } from '../context.js'
import { failed, type GateResult, passed } from '../exec.js'

const fingerprint = (context: Context): string => {
  const hash: ReturnType<typeof createHash> = createHash('sha256')
  for (const file of workingTreeFiles(context.root)) {
    const full: string = path.join(context.root, file)
    hash.update(file)
    try {
      hash.update(statSync(full).isFile() ? readFileSync(full) : Buffer.alloc(0))
    } catch {
      // An indexed-but-deleted path contributes its name only, so deleting one still changes the digest.
      hash.update('<absent>')
    }
  }
  return hash.digest('hex')
}

// The fingerprint is taken by one gate and compared by another, so it must outlive both calls, and
// there is no channel between gates to carry it as a value.
// eslint-disable-next-line functional/no-let -- must outlive two separate gate invocations
let snapshot: string | undefined

/** Record the tree state before the gates that could modify it run. */
// Enough of the fingerprint to compare by eye; the full value is never the useful part of a report.
const FINGERPRINT_PREVIEW: number = 12

export const treeSnapshot = (context: Context): GateResult => {
  // Recording state the later tree-verify gate reads is this gate's whole purpose.
  // eslint-disable-next-line unicorn/no-top-level-assignment-in-function -- see the binding above
  snapshot = fingerprint(context)
  return passed(`tree fingerprint recorded (${snapshot.slice(0, FINGERPRINT_PREVIEW)})`)
}

/** Verify no gate modified, or created, a file in the working tree during verification. */
export const treeVerify = (context: Context): GateResult => {
  if (snapshot === undefined) {
    return passed('no tree snapshot was taken, so there is nothing to compare')
  }
  const current: string = fingerprint(context)
  return current === snapshot
    ? passed('the working tree is unchanged since verification began')
    : failed('a gate changed the working tree during verification', [
        'run `ploaness format`, review the result, and commit it before verifying',
        `expected ${snapshot.slice(0, FINGERPRINT_PREVIEW)} but found ${current.slice(0, FINGERPRINT_PREVIEW)}`,
        'git status will show which files changed',
      ])
}
