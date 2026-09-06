import { describe, expect, it } from 'vitest'
import {
  isOxlintSuppression,
  oxlintSuppressionProblems,
  type SourceComment,
} from '../src/oxlint-suppressions.js'

const NATIVE: string = 'oxlint-disable'
const LEGACY: string = 'eslint-disable'
const comment = (text: string): SourceComment => ({ line: 7, text })

describe('native accessibility suppression policy', () => {
  it.each(['line', 'next-line'])('accepts a named, explained %s directive', (scope) => {
    const source: SourceComment = comment(
      `// ${NATIVE}-${scope} jsx-a11y/alt-text -- supplied by the adapter`,
    )
    expect(isOxlintSuppression(source)).toBe(true)
    expect(oxlintSuppressionProblems([source])).toEqual([])
  })

  it('accepts JSX block-comment syntax for a single-line directive', () => {
    expect(
      oxlintSuppressionProblems([
        comment(`/* ${NATIVE}-next-line jsx-a11y/alt-text -- adapter */`),
      ]),
    ).toEqual([])
  })

  it('requires every named rule to belong to the governed rule set', () => {
    expect(
      oxlintSuppressionProblems([comment(`// ${NATIVE}-line jsx-a11y/typo -- adapter`)]).join(' '),
    ).toContain('exact governed')
  })

  it('allows several explicit rules in the same justified line directive', () => {
    expect(
      oxlintSuppressionProblems([
        comment(`// ${NATIVE}-line jsx-a11y/alt-text, jsx-a11y/anchor-has-content -- adapter`),
      ]),
    ).toEqual([])
  })

  it.each([
    NATIVE,
    `${NATIVE}-line`,
    `${NATIVE} jsx-a11y/alt-text -- adapter`,
    `${NATIVE}-line jsx-a11y/alt-text`,
  ])('refuses blanket, file-wide, or unexplained suppression: %s', (directive) => {
    expect(oxlintSuppressionProblems([comment(`// ${directive}`)])).not.toEqual([])
  })

  it.each([
    LEGACY,
    `${LEGACY}-next-line -- reason`,
    `${LEGACY}-line jsx-a11y/alt-text -- reason`,
    `${LEGACY}-next-line alt-text -- reason`,
    `${LEGACY}-next-line no-console,alt-text -- reason`,
    'eslint jsx-a11y/alt-text: off',
  ])('refuses compatibility syntax that could hide the native rule: %s', (directive) => {
    expect(oxlintSuppressionProblems([comment(`/* ${directive} */`)])).not.toEqual([])
  })

  it('leaves another analyzer narrowly scoped to its own rules', () => {
    const source: SourceComment = comment(
      `// ${LEGACY}-next-line functional/no-let -- parser cursor`,
    )
    expect(isOxlintSuppression(source)).toBe(false)
    expect(oxlintSuppressionProblems([source])).toEqual([])
  })

  it('does not treat ordinary explanatory prose as a directive', () => {
    expect(oxlintSuppressionProblems([comment('// The native checker owns this rule.')])).toEqual(
      [],
    )
  })

  it('refuses a closing directive without creating a second budget entry', () => {
    const source: SourceComment = comment('// oxlint-enable jsx-a11y/alt-text -- end')
    expect(isOxlintSuppression(source)).toBe(false)
    expect(oxlintSuppressionProblems([source])).not.toEqual([])
  })
})
