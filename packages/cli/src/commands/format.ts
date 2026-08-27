// Formatting. It writes; it never judges. Review what it
// changed before committing, because a formatter that runs unattended is how unreviewed edits enter a
// repository.
import { biomeWrite } from '../checks/toolchain.js'
import { type Member, type Repository, resolveTool } from '../context.js'
import { type RunResult, runNode } from '../exec.js'

// Each member is formatted against its own configuration. Both tools resolve a relative glob against
// the config that declares it, so running once at the repository root would format one member's files
// by another member's rules - or, where the root holds no configuration of its own, by none.
const formatMember = (member: Member, isSolo: boolean): number => {
  if (!isSolo) {
    console.info(`\n${member.path}`)
  }
  // The invocation lives beside the gate that judges what this writes, so the two cannot disagree
  // about which files Biome touches. This function once carried its own copy of it.
  const biome: RunResult = biomeWrite(member)
  console.info(biome.output)
  const eslint: RunResult = runNode(resolveTool('eslint'), ['.', '--fix'], { cwd: member.root })
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
