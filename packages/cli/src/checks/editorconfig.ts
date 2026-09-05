// Conformance to the committed `.editorconfig`. The decision lives in governance; this reads the tree.
//
// Every file in the working tree is checked except those excluded by role: a binary asset, recognised
// from its own bytes rather than from its name, and a path the project excludes from the typography
// rules. The standard's line cap is narrower still, because a cap is a Code Rule written for a person:
// it binds on authored code, not on prose, which wraps by meaning rather than by column, and not on a
// path the project declares generated, whose lines nobody here chose.
import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import {
  type EditorconfigRules,
  type EditorconfigViolation,
  findEditorconfigViolations,
  isBinary,
  isLineCapEnforced,
  matchesRole,
  parseEditorconfig,
} from '@ploaness/governance'
import { type Context, workingTreeFiles } from '../context.js'
import { failed, type GateResult, passed } from '../exec.js'

const CONFIG_FILE: string = '.editorconfig'

interface ReadFile {
  readonly file: string
  readonly bytes: Buffer
}

/** Check every text file in the working tree against the committed `.editorconfig`. */
export const editorconfig = (context: Context): GateResult => {
  const configPath: string = path.join(context.root, CONFIG_FILE)
  if (!existsSync(configPath)) {
    return failed(`${CONFIG_FILE} is missing, so formatting cannot be proven`, [
      `${CONFIG_FILE} is a managed file; restore it with \`ploaness sync\``,
    ])
  }
  const rules: EditorconfigRules = parseEditorconfig(readFileSync(configPath, 'utf8'))
  // An enumerated path is not always a regular file: a symlink and a submodule gitlink both appear here,
  // and reading either throws rather than yielding text.
  const tracked: readonly string[] = workingTreeFiles(context.root).filter(
    (file: string): boolean => {
      const full: string = path.join(context.root, file)
      return existsSync(full) && statSync(full).isFile()
    },
  )

  // Select first, then judge: the two steps read separately and neither accumulates into a mutable box.
  const readable: readonly ReadFile[] = tracked
    .filter((file: string): boolean => !matchesRole(file, context.settings.typographyExclusions))
    .map((file: string): ReadFile => ({ file, bytes: readFileSync(path.join(context.root, file)) }))
    .filter((entry: ReadFile): boolean => !isBinary(entry.bytes))

  const findings: readonly string[] = readable.flatMap((entry: ReadFile): readonly string[] =>
    findEditorconfigViolations(
      entry.bytes.toString('utf8'),
      rules,
      isLineCapEnforced(entry.file, context.settings.generatedArtefacts),
    ).map(
      (violation: EditorconfigViolation): string =>
        `${entry.file}:${String(violation.line)} ${violation.reason}`,
    ),
  )
  const checked: number = readable.length

  return findings.length > 0
    ? failed(`${String(findings.length)} formatting violation(s)`, findings)
    : passed(`${String(checked)} working-tree file(s) match ${CONFIG_FILE}`)
}
