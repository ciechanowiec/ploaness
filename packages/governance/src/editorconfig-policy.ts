// Conformance to the committed `.editorconfig`, plus the standard's line cap.
//
// The `.editorconfig` is a pinned managed file, so every project holds the same one - and until now
// nothing checked a single file against it. The formatter covers only the globs it owns, which leaves
// Markdown, YAML, shell scripts, and Dockerfiles free to carry a CRLF, a tab, a trailing space, or a
// missing final newline.
//
// The expectations are read from the `.editorconfig` itself rather than restated here, so editing the
// pinned file moves the gate with it and the gate cannot contradict the file it checks against. The one
// value that does NOT come from there is the line cap: `max_line_length` is an editor hint that tells a
// ruler where to sit, while the standard's 120 characters is a cap that binds as an error. A project's
// formatter may aim shorter, and frequently does.

/** The standard's line cap. Not configurable: a cap is never raised. */
export const MAX_LINE_LENGTH: number = 120

/** The properties this rule reads out of an `.editorconfig`. */
export interface EditorconfigRules {
  readonly endOfLine: string | undefined
  readonly insertFinalNewline: boolean
  readonly trimTrailingWhitespace: boolean
  readonly indentStyle: string | undefined
}

/** One place a file departs from the committed configuration. */
export interface EditorconfigViolation {
  readonly line: number
  readonly reason: string
}

const FIRST_LINE: number = 1
const BOM: string = '﻿'

/**
 * Read the `[*]` section of an `.editorconfig`.
 * @param text the file's content.
 * @returns the properties the conformance rule binds.
 */
// The `[*]` section is the span between that header and the next one, so it can be sliced out before
// any property is read rather than tracked with a flag while reading.
const wildcardSection = (text: string): readonly string[] => {
  const lines: readonly string[] = text.split('\n').map((raw: string): string => raw.trim())
  const start: number = lines.indexOf('[*]')
  if (start === -1) {
    return []
  }
  const rest: readonly string[] = lines.slice(start + 1)
  const end: number = rest.findIndex((line: string): boolean => line.startsWith('['))
  return end === -1 ? rest : rest.slice(0, end)
}

const isProperty = (line: string): boolean =>
  line.length > 0 && !line.startsWith('#') && !line.startsWith(';') && line.includes('=')

export const parseEditorconfig = (text: string): EditorconfigRules => {
  const properties: Record<string, string> = Object.fromEntries(
    wildcardSection(text)
      .filter((line: string): boolean => isProperty(line))
      .map((line: string): readonly [string, string] => {
        const separator: number = line.indexOf('=')
        return [
          line.slice(0, separator).trim().toLowerCase(),
          line
            .slice(separator + 1)
            .trim()
            .toLowerCase(),
        ]
      }),
  )
  return {
    endOfLine: properties['end_of_line'],
    insertFinalNewline: properties['insert_final_newline'] === 'true',
    trimTrailingWhitespace: properties['trim_trailing_whitespace'] === 'true',
    indentStyle: properties['indent_style'],
  }
}

// One predicate per property, so the per-line walk stays flat. Each returns the reason it found, or
// undefined, and the walk is then a filter rather than a chain of branches.
type LineRule = (body: string, raw: string) => string | undefined

const lineRules = (
  rules: EditorconfigRules,
  isLineLengthEnforced: boolean,
): readonly LineRule[] => [
  (_body: string, raw: string): string | undefined =>
    rules.endOfLine === 'lf' && raw.endsWith('\r')
      ? 'carriage return; end_of_line is lf'
      : undefined,
  (body: string): string | undefined =>
    rules.trimTrailingWhitespace && /[ \t]$/.test(body) ? 'trailing whitespace' : undefined,
  (body: string): string | undefined =>
    rules.indentStyle === 'space' && body.startsWith('\t')
      ? 'tab indentation; indent_style is space'
      : undefined,
  (body: string): string | undefined =>
    isLineLengthEnforced && body.length > MAX_LINE_LENGTH
      ? `line is ${String(body.length)} characters; the cap is ${String(MAX_LINE_LENGTH)}`
      : undefined,
]

const lineViolations = (
  content: string,
  rules: EditorconfigRules,
  isLineLengthEnforced: boolean,
): readonly EditorconfigViolation[] => {
  const checks: readonly LineRule[] = lineRules(rules, isLineLengthEnforced)
  return content
    .split('\n')
    .flatMap((raw: string, index: number): readonly EditorconfigViolation[] => {
      const body: string = raw.replace(/\r$/, '')
      return checks.flatMap((check: LineRule): readonly EditorconfigViolation[] => {
        const reason: string | undefined = check(body, raw)
        return reason === undefined ? [] : [{ line: index + 1, reason }]
      })
    })
}

/**
 * Check one file against the committed configuration.
 * @param content the file's decoded content.
 * @param rules the properties read from the `.editorconfig`.
 * @param isLineLengthEnforced whether the standard's line cap applies to this file's role.
 * @returns one violation per departure, in line order.
 */
export const findEditorconfigViolations = (
  content: string,
  rules: EditorconfigRules,
  isLineLengthEnforced: boolean,
): readonly EditorconfigViolation[] => {
  if (content.length === 0) {
    return []
  }
  const byteOrderMark: readonly EditorconfigViolation[] = content.startsWith(BOM)
    ? [{ line: FIRST_LINE, reason: 'byte order mark; charset is utf-8' }]
    : []
  const finalNewline: readonly EditorconfigViolation[] =
    rules.insertFinalNewline && !content.endsWith('\n')
      ? [{ line: content.split('\n').length, reason: 'no final newline' }]
      : []
  return [
    ...byteOrderMark,
    ...lineViolations(content, rules, isLineLengthEnforced),
    ...finalNewline,
  ]
}
