// Formatting. It writes; it never judges. Review what it
// changed before committing, because a formatter that runs unattended is how unreviewed edits enter a
// repository.
import { biomeWrite } from '../checks/toolchain.js'
import { type Context, resolveTool } from '../context.js'
import { type RunResult, runNode } from '../exec.js'

/** Apply Biome's formatting and safe fixes, then ESLint's fixable rules. */
export const format = (context: Context): number => {
  // The invocation lives beside the gate that judges what this writes, so the two cannot disagree
  // about which files Biome touches. This function once carried its own copy of it.
  const biome: RunResult = biomeWrite(context)
  console.info(biome.output)
  const eslint: RunResult = runNode(resolveTool('eslint'), ['.', '--fix'], { cwd: context.root })
  if (eslint.output.length > 0) {
    console.info(eslint.output)
  }
  console.info('\nFormatting applied. Review the changes before committing them.')
  // ESLint exits non-zero for findings it cannot fix. Those are for `ploaness verify` to report, so
  // formatting succeeds as long as Biome could write.
  return biome.code === 0 ? 0 : 1
}
