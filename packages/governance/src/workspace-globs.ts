// Workspace patterns have pnpm semantics; coverage and role patterns retain their separate dialect.
import path from 'node:path'
import micromatch from 'micromatch'

/** A normalized workspace inclusion or exclusion compiled before discovery begins. */
export interface WorkspacePattern {
  readonly isExcluded: boolean
  readonly expression: RegExp
}

const hasUnsupportedSyntax = (pattern: string): boolean =>
  /[^\p{L}\p{M}\p{N}_./*?{},!@ -]|\{,|,,|,\}/u.test(pattern) ||
  pattern.match(/\{[^,{}/]*\}/g)?.some((group: string): boolean => group.includes('..')) === true

const normalisedPattern = (pattern: string): string => path.posix.normalize(pattern).replace(/\/$/, '')

const expressionFor = (expanded: string): RegExp => {
  const normalised: string = normalisedPattern(expanded)
  if (/[{}]/.test(expanded)) {
    throw new TypeError('singleton or literal brace groups are unsupported; remove the group or list alternatives')
  }
  if (normalised.includes('**/**')) {
    throw new TypeError('adjacent globstar segments are unsupported; use one ** segment')
  }
  const expression: RegExp = micromatch.makeRe(`${normalised}/package.json`, {
    strictBrackets: true,
    nonegate: true,
    literalBrackets: false,
  })
  return new RegExp(expression.source, 'u')
}

const invalidPattern = (pattern: string, cause: unknown): TypeError => {
  const reason: string = cause instanceof Error ? cause.message : String(cause)
  return new TypeError(`pnpm-workspace.yaml packages: invalid or unsupported pattern ${pattern}: ${reason}`, { cause })
}

/** Compile every pattern or reject it explicitly, even when there are no member candidates. */
export const compileWorkspacePatterns = (patterns: readonly string[]): readonly WorkspacePattern[] =>
  patterns.flatMap((pattern: string): readonly WorkspacePattern[] => {
    try {
      if (hasUnsupportedSyntax(pattern)) {
        throw new TypeError(
          'use plain directory names, wildcards, and nonempty brace alternatives; special syntax is unsupported',
        )
      }
      const isExcluded: boolean = pattern.startsWith('!')
      const body: string = isExcluded ? pattern.slice(1) : pattern
      // Validate before expansion: an unmatched brace is not an empty set of selected projects.
      micromatch.makeRe(body, { strictBrackets: true, nonegate: true })
      return micromatch.braces(body, { expand: true }).map(
        (expanded: string): WorkspacePattern => ({
          isExcluded,
          expression: expressionFor(expanded),
        }),
      )
    } catch (error: unknown) {
      throw invalidPattern(pattern, error)
    }
  })
