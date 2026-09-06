// The suppression ceiling gate. The decision lives in governance; this reads the tree.
//
// Its summary is what satisfies the reporting rule. `reportGate` prints a gate's summary on every run,
// pass or fail, so putting the count and the headroom there makes the trend readable before the ceiling
// is reached without adding a reporting path of its own. Findings stay empty while the project is
// within budget because the summary already carries the whole report; passing findings are reserved for
// a separate informational report such as dependency freshness.
import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import {
  countSourceLines,
  findSuppressions,
  hasExtension,
  isGovernedCode,
  isOxlintSuppression,
  judgeSuppressions,
  OXLINT_EXTENSIONS,
  oxlintSourceFiles,
  type SourceComment,
  type SuppressionReport,
  type SuppressionSite,
} from '@ploaness/governance'
import { type Member, workingTreeFiles } from '../context.js'
import { failed, type GateResult, passed } from '../exec.js'
import { sourceComments } from '../source-comments.js'
import { managedPaths } from './assets.js'

interface ScannedFile {
  readonly file: string
  readonly content: string
}

const isUnderSourceRoots = (file: string, sourceRoots: readonly string[]): boolean =>
  sourceRoots.some((sourceRoot: string): boolean => file.startsWith(`${sourceRoot}/`))

const sitesOf = (scanned: ScannedFile): readonly SuppressionSite[] => [
  ...findSuppressions(scanned.file, scanned.content),
  ...(hasExtension(scanned.file, OXLINT_EXTENSIONS)
    ? sourceComments(scanned.content, scanned.file)
        .filter(isOxlintSuppression)
        .map(
          (comment: SourceComment): SuppressionSite => ({
            file: scanned.file,
            line: comment.line,
            token: 'oxlint-disable',
          }),
        )
    : []),
]

const eligibleFiles = (
  context: Member,
  inventory: readonly string[],
  native: ReadonlySet<string>,
): readonly string[] => {
  const managed: ReadonlySet<string> = managedPaths(context)
  const excluded: readonly string[] = context.settings.typographyExclusions
  return inventory.filter((file: string): boolean => {
    const full: string = path.join(context.root, file)
    return (
      (hasExtension(file, OXLINT_EXTENSIONS)
        ? native.has(file)
        : isUnderSourceRoots(file, context.settings.sourceRoots)) &&
      !managed.has(file) &&
      isGovernedCode(file, excluded) &&
      existsSync(full) &&
      statSync(full).isFile()
    )
  })
}

/** Count suppressions and source lines across the project's own code. */
export const suppressions = (context: Member): GateResult => {
  // A managed file is ploaness's, byte for byte, and the project can neither remove a suppression
  // inside it nor be asked to justify one. Its lines are left out of the denominator for the same
  // reason: a ceiling earned by code the project did not write would be an allowance, not a measure.
  // An enumerated path is not always a regular file: a symlink and a submodule gitlink both appear here.
  const inventory: readonly string[] = workingTreeFiles(context.root)
  const native: ReadonlySet<string> = new Set(
    oxlintSourceFiles(inventory, context.settings.generatedArtefacts, context.siblingPaths),
  )
  const files: readonly string[] = eligibleFiles(context, inventory, native)

  // Read once, then derive both figures from the same contents rather than accumulating as we go.
  const contents: readonly ScannedFile[] = files.map(
    (file: string): ScannedFile => ({
      file,
      content: readFileSync(path.join(context.root, file), 'utf8'),
    }),
  )
  const sites: readonly SuppressionSite[] = contents.flatMap(
    (scanned: ScannedFile): readonly SuppressionSite[] => sitesOf(scanned),
  )
  const sourceLines: number = contents.reduce(
    (total: number, scanned: ScannedFile): number => total + countSourceLines(scanned.content),
    0,
  )

  const report: SuppressionReport = judgeSuppressions(
    sites,
    sourceLines,
    context.settings.maxSuppressions,
  )
  const summary: string =
    `${String(report.count)} of ${String(report.ceiling)} permitted, ` +
    `${String(report.remaining)} remaining (${String(report.sourceLines)} source lines)`
  if (report.withinCeiling) {
    return passed(summary)
  }
  return failed(summary, [
    `the suppression ceiling is ${String(report.ceiling)} for ` +
      `${String(report.sourceLines)} source lines; remove one before adding another`,
    ...report.sites.map(
      (site: SuppressionSite): string => `${site.file}:${String(site.line)} ${site.token}`,
    ),
  ])
}
