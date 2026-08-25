// The suppression ceiling.
//
// A justification never stops a suppression from being added: whoever adds one writes it. What stops
// one is a budget, because a full budget makes the next suppression cost the removal of an existing
// one. So the ceiling is the mechanism, and the justification rules that analyzers already enforce are
// the complement rather than the substitute.
//
// The ceiling is a density against the size of the code rather than a bare count, so it neither
// strangles a small repository nor loosens as a large one grows. A project may declare a STRICTER
// ceiling and never a looser one: a setting that raised it would be the bypass that makes the whole
// mechanism decorative, and zero must be expressible, since "no suppression is permitted" is a
// position the standard names explicitly.
//
// The search tokens are assembled from fragments rather than written whole. This module would otherwise
// report itself, which is the same self-reference the typography rule solves by naming code points.

const DISABLE: string = 'disable'
const IGNORE: string = 'ignore'
const ALLOW: string = 'allow'

// One entry per suppression form. `eslint-enable`, `biome-ignore-end`, and `stylelint-enable` close a
// block that its opener already counted, so counting them would double every block suppression.
//
// `@ts-nocheck` was missing, and it is the broadest suppression available: it turns the type checker off
// for a whole file rather than for one line. `ban-ts-comment` refuses it wherever ESLint reads, so it
// was never free - but a file ESLint's config ignores escaped both, and the ceiling is what makes the
// next suppression cost the removal of an existing one.
//
// The three coverage forms belong here for a sharper reason than the rest. Every other suppression
// silences a finding; a coverage directive deletes the measurement, so the per-file floor is met by
// dropping the line out of the report rather than by writing the test that would cover it. That was the
// cheapest way in a governed repository to make a floor read as satisfied.
const SUPPRESSION_TOKENS: readonly string[] = [
  `eslint-${DISABLE}`,
  `biome-${IGNORE}`,
  `stylelint-${DISABLE}`,
  `@ts-expect-error`,
  `@ts-${IGNORE}`,
  `@ts-nocheck`,
  `v8 ${IGNORE}`,
  `c8 ${IGNORE}`,
  `istanbul ${IGNORE}`,
]

const CLOSING_TOKENS: readonly string[] = [
  `eslint-enable`,
  `biome-${IGNORE}-end`,
  `stylelint-enable`,
  `v8 ${IGNORE} stop`,
  `c8 ${IGNORE} stop`,
]

/** Suppressions permitted before any code is written, so a greenfield project is not born at zero. */
export const BASE_ALLOWANCE: number = 2

/** Source lines that earn one further suppression. */
export const LINES_PER_SUPPRESSION: number = 500

/** One suppression comment, located so an over-budget project is told which ones to reconsider. */
export interface SuppressionSite {
  readonly file: string
  readonly line: number
  readonly token: string
}

/** What the ceiling rule decided, including the numbers every run reports. */
export interface SuppressionReport {
  readonly count: number
  readonly ceiling: number
  readonly remaining: number
  readonly sourceLines: number
  readonly withinCeiling: boolean
  readonly sites: readonly SuppressionSite[]
}

// A suppression token must open the comment that carries it. Prose ABOUT suppressions mentions the same
// words - a config comment reading "every eslint-disable needs a reason" is documentation, not a
// suppression - and counting those would charge a repository for explaining its own policy.
const COMMENT_OPENER: string = String.raw`(?:\/\/|\/\*|^\s*\*|^\s*#)\s*`

const opensWith = (line: string, token: string): boolean =>
  new RegExp(`${COMMENT_OPENER}${token}`).test(line)

// The one suppression form that is not a comment convention. gitleaks reads a line for this literal and
// skips the line that carries it, whatever syntax the surrounding file comments in, so anchoring it to a
// comment opener the way the others are anchored would leave every non-C-style file free. A governed
// repository records a committed fake credential in the declared secret allowlist; this is the way
// around that, and it costs a suppression like any other.
const BARE_TOKENS: readonly string[] = [`gitleaks:${ALLOW}`]

const tokenOnLine = (line: string): string | undefined => {
  if (CLOSING_TOKENS.some((closing: string): boolean => opensWith(line, closing))) {
    return undefined
  }
  return (
    SUPPRESSION_TOKENS.find((token: string): boolean => opensWith(line, token)) ??
    BARE_TOKENS.find((token: string): boolean => line.includes(token))
  )
}

/**
 * Locate every suppression comment in one file.
 * @param file the path reported alongside each site.
 * @param text the file's content.
 * @returns one site per suppression, in line order.
 */
export const findSuppressions = (file: string, text: string): readonly SuppressionSite[] =>
  text.split('\n').flatMap((line: string, index: number): readonly SuppressionSite[] => {
    const token: string | undefined = tokenOnLine(line)
    return token === undefined ? [] : [{ file, line: index + 1, token }]
  })

/**
 * Count the lines that the ceiling is measured against.
 * @param text a source file's content.
 * @returns its non-blank line count.
 */
export const countSourceLines = (text: string): number =>
  text.split('\n').filter((line: string): boolean => line.trim().length > 0).length

/**
 * The permitted suppression count for a body of code.
 * @param sourceLines non-blank lines of first-party source.
 * @param declaredMaximum a project's own stricter cap, or undefined when it declares none.
 * @returns the ceiling, which a declared maximum may lower and can never raise.
 */
export const suppressionCeiling = (
  sourceLines: number,
  declaredMaximum: number | undefined,
): number => {
  const earned: number = BASE_ALLOWANCE + Math.floor(sourceLines / LINES_PER_SUPPRESSION)
  return declaredMaximum === undefined ? earned : Math.min(earned, declaredMaximum)
}

/**
 * Judge a repository's suppressions against its ceiling.
 * @param sites every suppression found.
 * @param sourceLines non-blank lines of first-party source.
 * @param declaredMaximum a project's own stricter cap, or undefined.
 * @returns the verdict and the numbers every verification run reports.
 */
export const judgeSuppressions = (
  sites: readonly SuppressionSite[],
  sourceLines: number,
  declaredMaximum: number | undefined,
): SuppressionReport => {
  const ceiling: number = suppressionCeiling(sourceLines, declaredMaximum)
  return {
    count: sites.length,
    ceiling,
    remaining: Math.max(0, ceiling - sites.length),
    sourceLines,
    withinCeiling: sites.length <= ceiling,
    sites,
  }
}
