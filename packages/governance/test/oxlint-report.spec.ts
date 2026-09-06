import { describe, expect, it } from 'vitest'
import { oxlintArguments, oxlintReportProblems } from '../src/oxlint-report.js'

const report = (changes: Readonly<Record<string, unknown>> = {}): string =>
  JSON.stringify({ number_of_files: 2, number_of_rules: 31, diagnostics: [], ...changes })

describe('the native accessibility verdict', () => {
  it('accepts only the expected completed analysis without findings', () => {
    expect(oxlintReportProblems(report(), 2, 31)).toEqual([])
  })

  it.each(['', 'not JSON', 'null', '[]', '{}', '{"diagnostics":false}', '/* comment */ {}'])(
    'refuses a malformed or missing report: %s',
    (output) => {
      expect(oxlintReportProblems(output, 2, 31)).not.toEqual([])
    },
  )

  it.each([0, 1, 3, '2', undefined])('refuses an unexpected file count: %s', (count) => {
    expect(oxlintReportProblems(report({ number_of_files: count }), 2, 31)).toContain(
      'Oxlint did not analyze the expected 2 JSX file(s)',
    )
  })

  it.each([0, 30, 32, '31', undefined])('refuses an unexpected rule count: %s', (count) => {
    expect(oxlintReportProblems(report({ number_of_rules: count }), 2, 31)).toContain(
      'Oxlint did not enable the expected 31 accessibility rule(s)',
    )
  })

  it('reports warnings as findings even if an analyzer would exit zero', () => {
    const output: string = report({
      diagnostics: [
        {
          filename: 'src/Card.tsx',
          code: 'jsx-a11y(alt-text)',
          message: 'missing alt',
          severity: 'warning',
        },
      ],
    })
    expect(oxlintReportProblems(output, 2, 31)).toEqual([
      'src/Card.tsx jsx-a11y(alt-text): missing alt',
    ])
  })

  it.each([null, {}, { message: 1 }])('refuses an unreadable diagnostic: %s', (diagnostic) => {
    expect(oxlintReportProblems(report({ diagnostics: [diagnostic] }), 2, 31).join(' ')).toContain(
      'malformed Oxlint diagnostic',
    )
  })

  it('retains a legitimate empty scope only when the expected scope is empty', () => {
    expect(oxlintReportProblems(report({ number_of_files: 0 }), 0, 31)).toEqual([])
  })
})

describe('the owned invocation', () => {
  it('keeps file arguments intact behind the end-of-options marker', () => {
    const files: readonly string[] = ['src/with spaces.tsx', 'src/--config=other.tsx']
    const arguments_: readonly string[] = oxlintArguments('/owned config/oxlint.json', files)
    expect(arguments_.slice(arguments_.indexOf('--') + 1)).toEqual(files)
    expect(arguments_).toContain('/owned config/oxlint.json')
    expect(arguments_).toContain('--disable-nested-config')
    expect(arguments_).toContain('--no-ignore')
    expect(arguments_).toContain('--deny-warnings')
    expect(arguments_).not.toContain('--fix')
  })
})
