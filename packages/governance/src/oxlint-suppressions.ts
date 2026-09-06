import { JSX_ACCESSIBILITY_RULES, type JsxAccessibilityRule } from './jsx-accessibility.js'

/** An actual parser-recognized comment, rather than comment-like text in a string or JSX text. */
export interface SourceComment {
  readonly line: number
  readonly text: string
}

const NATIVE: string = 'oxlint'
const LEGACY: string = 'eslint'
const DISABLE: string = 'disable'
const CLAUSE_COUNT: number = 2
const RULES: ReadonlySet<string> = new Set(
  JSX_ACCESSIBILITY_RULES.map((rule: JsxAccessibilityRule): string => rule.oxlint),
)

const LEGACY_RULES: ReadonlySet<string> = new Set(
  [...RULES].flatMap((rule: string): readonly string[] => [rule, rule.replace('jsx-a11y/', '')]),
)

const commentBody = (text: string): string =>
  text
    .replace(/^\/\/?\*?/u, '')
    .replace(/\*\/$/u, '')
    .trim()

/** Whether a native directive opens a suppression and therefore spends the existing budget. */
export const isOxlintSuppression = (comment: SourceComment): boolean =>
  commentBody(comment.text).startsWith(`${NATIVE}-${DISABLE}`)

const directiveProblems = (body: string): readonly string[] => {
  const [declaration = '', explanation = '']: readonly string[] = body.split(' -- ', CLAUSE_COUNT)
  const [form = '', ...names]: readonly string[] = declaration.split(/\s+/u)
  const rules: readonly string[] = names
    .join(' ')
    .split(/[\s,]+/u)
    .filter(Boolean)
  return [
    ...([`${NATIVE}-${DISABLE}-next-line`, `${NATIVE}-${DISABLE}-line`].includes(form)
      ? []
      : ['use a line or next-line Oxlint suppression, never a file-wide directive']),
    ...(rules.length > 0 && rules.every((rule: string): boolean => RULES.has(rule))
      ? []
      : ['name the exact governed JSX accessibility rule(s)']),
    ...(explanation.trim().length > 0 ? [] : ['provide a suppression reason after --']),
  ]
}

const isLegacySuppression = (body: string): boolean => {
  const isLegacy: boolean = body.startsWith(`${LEGACY}-${DISABLE}`)
  const declaration: string = (body.split('--', CLAUSE_COUNT)[0] ?? '').trim()
  const isBlanket: boolean = [
    `${LEGACY}-${DISABLE}`,
    `${LEGACY}-${DISABLE}-next-line`,
    `${LEGACY}-${DISABLE}-line`,
  ].includes(declaration)
  const hasNativeRule: boolean = declaration
    .split(/[\s,:]+/u)
    .some((name: string): boolean => LEGACY_RULES.has(name))
  const isInline: boolean = body.startsWith(`${LEGACY} `) && hasNativeRule
  return isInline || (isLegacy && (isBlanket || hasNativeRule))
}

/**
 * Validate suppressions before the tool can obey them.
 * @param comments parser-recognized source comments.
 * @returns line-numbered findings for broad, stale-namespace, or unexplained directives.
 */
export const oxlintSuppressionProblems = (comments: readonly SourceComment[]): readonly string[] =>
  comments.flatMap((comment: SourceComment): readonly string[] => {
    const body: string = commentBody(comment.text)
    if (body.startsWith(`${NATIVE}-`)) {
      return directiveProblems(body).map(
        (problem: string): string => `line ${String(comment.line)}: ${problem}`,
      )
    }
    return isLegacySuppression(body)
      ? [
          `line ${String(comment.line)}: use a named, explained Oxlint line suppression for JSX accessibility`,
        ]
      : []
  })
