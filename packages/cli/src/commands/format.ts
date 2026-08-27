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
  // ESLint exits non-zero for findings it cannot fix. Those are for `ploaness verify` to report, so
  // formatting succeeds as long as Biome could write.
  return biome.code === 0 ? 0 : 1
}

/** Apply Biome's formatting and safe fixes, then ESLint's fixable rules, in every member. */
export const format = (repository: Repository): number => {
  const isSolo: boolean = repository.members.length <= 1
  const codes: readonly number[] = repository.members.map((member: Member): number =>
    formatMember(member, isSolo),
  )
  console.info('\nFormatting applied. Review the changes before committing them.')
  return codes.some((code: number): boolean => code !== 0) ? 1 : 0
}
