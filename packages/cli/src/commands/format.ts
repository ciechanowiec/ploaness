// Formatting. It writes; it never judges. Review what it
// changed before committing, because a formatter that runs unattended is how unreviewed edits enter a
// repository.
import { biomeWrite, eslintWrite } from '../checks/toolchain.js'
import type { Member, Repository } from '../context.js'
import type { RunResult } from '../exec.js'

// Each member is formatted against its own configuration. Both tools resolve a relative glob against
// the config that declares it, so running once at the repository root would format one member's files
// by another member's rules - or, where the root holds no configuration of its own, by none.
const formatMember = (member: Member, isSolo: boolean): number => {
  if (!isSolo) {
    console.info(`\n${member.path}`)
  }
  // Each invocation lives beside the gate that judges what it writes, so the two cannot disagree about
  // which files the tool touches. Both functions once carried their own copy of it, and the ESLint half
  // stayed that way a tool longer: it was told `.` and nothing else, so a run started at a workspace
  // root descended into every member and applied the ROOT's rules to files that member excludes. It
  // rewrote a generated import map, and no gate could report it - each member's own run correctly
  // ignores that file, which is exactly why the writer had to be told where to stop.
  const biome: RunResult = biomeWrite(member)
  console.info(biome.output)
  const eslint: RunResult = eslintWrite(member)
  if (eslint.output.length > 0) {
    console.info(eslint.output)
  }
  // Biome runs again because ESLint's fixers wrote last and Biome is the formatter. A fixer emits
  // whatever its rule considers correct, not whatever the formatter would have printed, so the pass
  // above can leave text that the `biome` gate then fails on - and it did:
  // `unicorn/prefer-negative-index` rewrote `values.slice(0, values.length - 1)` to
  // `values.slice(0, - 1)`, which is a formatting defect the gate reports on a change format itself
  // made. Running format twice repaired it, which is the tell: the command was one pass short of a
  // fixed point rather than wrong about any single fix. Biome's writer is deterministic and converges,
  // so this pass costs one process and changes nothing when there was nothing to settle.
  const settled: RunResult = biomeWrite(member)
  console.info(settled.output)
  // ESLint exits non-zero for findings it cannot fix. Those are for `ploaness verify` to report, so
  // formatting succeeds as long as Biome could write - and the second run is the one that describes
  // the tree the caller is actually left with.
  return biome.code === 0 && settled.code === 0 ? 0 : 1
}

/**
 * Apply Biome's formatting and safe fixes, then ESLint's fixable rules, then Biome once more, in
 * every member. The closing pass is what makes the command leave a tree the `biome` gate accepts.
 */
export const format = (repository: Repository): number => {
  const isSolo: boolean = repository.members.length <= 1
  const codes: readonly number[] = repository.members.map((member: Member): number =>
    formatMember(member, isSolo),
  )
  console.info('\nFormatting applied. Review the changes before committing them.')
  return codes.some((code: number): boolean => code !== 0) ? 1 : 0
}
