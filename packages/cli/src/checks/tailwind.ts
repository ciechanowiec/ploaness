// The token-bound gate. The rule is pure and lives in @ploaness/governance; this file supplies the
// I/O: which tracked files carry Tailwind classes, and what a finding reads like.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  type ArbitraryValueViolation,
  findArbitraryValues,
  hasExtension,
  matchesRole,
} from '@ploaness/governance'
import { type Context, trackedFiles } from '../context.js'
import { failed, type GateResult, passed } from '../exec.js'

// Scoped by role rather than by a list of folders. A Tailwind class is written in JSX, so `.tsx` is
// where the rule can find one - and it is also the scope that keeps the rule from misreading a regex
// or an index expression in ordinary TypeScript, which is what a whole-of-`src` scan would do.
const MARKUP_EXTENSIONS: readonly string[] = ['.tsx']

// A file under a source root, so a project that declares another one is covered without saying so
// twice. `matchesRole` is reused rather than a second glob matcher.
const isScanned = (context: Context, file: string): boolean =>
  hasExtension(file, MARKUP_EXTENSIONS) &&
  context.settings.sourceRoots.some((root: string): boolean => file.startsWith(`${root}/`)) &&
  !matchesRole(file, context.settings.typographyExclusions)

/** Verify every visual value comes from the Tailwind theme rather than an arbitrary literal. */
export const tailwindTokens = (context: Context): GateResult => {
  const scanned: readonly string[] = trackedFiles(context.root).filter((file: string): boolean =>
    isScanned(context, file),
  )
  const findings: readonly string[] = scanned.flatMap((file: string): readonly string[] => {
    const content: string = readFileSync(path.join(context.root, file), 'utf8')
    return findArbitraryValues(content).map(
      (violation: ArbitraryValueViolation): string =>
        `${file}:${String(violation.line)}:${String(violation.column)} ` +
        `arbitrary Tailwind value \`${violation.value}\`; apply a theme token through a utility class`,
    )
  })
  return findings.length > 0
    ? failed(`${String(findings.length)} arbitrary Tailwind value(s)`, findings)
    : passed(`${String(scanned.length)} markup file(s) use only token-bound Tailwind utilities`)
}
