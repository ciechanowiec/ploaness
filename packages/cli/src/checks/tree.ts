// Working-tree integrity: a fingerprint taken before the gates, and checked again after. Verification must
// judge the tree the project committed, not one a gate quietly rewrote as a side effect. A formatter or
// a code generator that edits during `verify` would otherwise let a build pass on content that is not in
// the repository, and the next clean checkout would fail.
import type { Context } from '../context.js'
import { failed, type GateResult, passed } from '../exec.js'
import { workingTreeFingerprint } from '../working-tree.js'

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
  snapshot = workingTreeFingerprint(context.root)
  return passed(`tree fingerprint recorded (${snapshot.slice(0, FINGERPRINT_PREVIEW)})`)
}

/**
 * Verify the working tree is byte-for-byte what it was when the snapshot was taken.
 *
 * It compares two fingerprints, so it establishes THAT the tree changed and never WHO changed it. A gate
 * rewriting a file is the reason the gate exists, but an editor saving a file while verification runs
 * produces the same digest mismatch, and naming the first as the cause would be asserting something two
 * hashes cannot show. The report offers both readings and leaves the choice to the reader.
 */
export const treeVerify = (context: Context): GateResult => {
  if (snapshot === undefined) {
    return failed('no tree snapshot was taken', [
      'run complete verification to establish tree integrity',
    ])
  }
  const current: string = workingTreeFingerprint(context.root)
  return current === snapshot
    ? passed('the working tree is unchanged since verification began')
    : failed('the working tree changed during verification', [
        'a gate may have rewritten a file: run `ploaness format`, review the result, and commit it',
        'or a file was edited while verification was running, in which case re-run against a settled tree',
        `expected ${snapshot.slice(0, FINGERPRINT_PREVIEW)} but found ${current.slice(0, FINGERPRINT_PREVIEW)}`,
        'git status will show which files changed',
      ])
}
