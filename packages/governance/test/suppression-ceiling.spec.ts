import { describe, expect, it } from 'vitest'
import {
  BASE_ALLOWANCE,
  countSourceLines,
  findSuppressions,
  judgeSuppressions,
  LINES_PER_SUPPRESSION,
  type SuppressionReport,
  type SuppressionSite,
  suppressionCeiling,
} from '../src/suppression-ceiling.js'

// Assembled rather than written whole, for the same reason the module assembles its own tokens: a spec
// containing a literal suppression would be counted by the rule it is testing.
const disable = (tool: string): string => `${tool}-disable`
const ignore = (tool: string): string => `${tool}-ignore`

const sites = (count: number): readonly SuppressionSite[] =>
  Array.from({ length: count }, (_: unknown, index: number) => ({
    file: 'src/a.ts',
    line: index + 1,
    token: 'x',
  }))

describe('findSuppressions', () => {
  it.each([
    ['ESLint', `// ${disable('eslint')}-next-line no-console -- reason`],
    ['Biome', `// ${ignore('biome')} lint/style/useConst: reason`],
    ['Stylelint', `/* ${disable('stylelint')} color-named -- reason */`],
    ['TypeScript expect-error', `// @ts-expect-error reason`],
  ])('counts a %s suppression', (_tool, line) => {
    expect(findSuppressions('src/a.ts', line)).toHaveLength(1)
  })

  it('does not count the comment that closes a block another comment opened', () => {
    expect(findSuppressions('src/a.css', `/* eslint-enable no-console */`)).toEqual([])
  })

  it('does not count a biome block terminator, which its opener already counted', () => {
    expect(findSuppressions('src/a.ts', `// ${ignore('biome')}-end lint/style/useConst`)).toEqual(
      [],
    )
  })

  it('reports the line, so an over-budget project is told which suppression to reconsider', () => {
    const text: string = `const first = 1\n// ${ignore('biome')} lint/style/useConst: reason\nconst second = 2`
    expect(findSuppressions('src/a.ts', text)[0]?.line).toBe(2)
  })

  it('reports the file it was given, so sites from several files stay distinguishable', () => {
    expect(findSuppressions('src/b.ts', `// @ts-expect-error reason`)[0]?.file).toBe('src/b.ts')
  })

  it('finds nothing in a file that suppresses nothing', () => {
    expect(findSuppressions('src/a.ts', 'const value = 1\n// an ordinary comment')).toEqual([])
  })

  // Documentation naming a suppression form is not a suppression. Counting prose would charge a
  // repository for writing down its own policy, and the analyzer configs do exactly that.
  it('does not count prose that merely names a suppression form', () => {
    const prose: string = `// Suppressions must be deliberate: every ${disable('eslint')} needs a reason.`
    expect(findSuppressions('config.js', prose)).toEqual([])
  })

  it('counts a suppression that opens its own comment', () => {
    const real: string = `// ${disable('eslint')}-next-line no-console -- the CLI prints here by design`
    expect(findSuppressions('src/a.ts', real)).toHaveLength(1)
  })
})

describe('countSourceLines', () => {
  it('ignores blank lines, so reformatting cannot buy a suppression', () => {
    expect(countSourceLines('a\n\n\nb\n   \n')).toBe(2)
  })
})

describe('suppressionCeiling', () => {
  it('grants a greenfield project the base allowance, so the ceiling is adoptable', () => {
    expect(suppressionCeiling(0, undefined)).toBe(BASE_ALLOWANCE)
  })

  it('earns one further suppression per block of source lines', () => {
    expect(suppressionCeiling(LINES_PER_SUPPRESSION * 3, undefined)).toBe(BASE_ALLOWANCE + 3)
  })

  it('holds the density constant as the code grows, so a large repository is not looser', () => {
    const small: number = suppressionCeiling(LINES_PER_SUPPRESSION * 4, undefined) / 4
    const large: number = suppressionCeiling(LINES_PER_SUPPRESSION * 400, undefined) / 400
    expect(large).toBeLessThanOrEqual(small)
  })

  it('lets a project declare a stricter ceiling', () => {
    expect(suppressionCeiling(LINES_PER_SUPPRESSION * 10, 3)).toBe(3)
  })

  it('lets a project declare that no suppression is permitted', () => {
    expect(suppressionCeiling(LINES_PER_SUPPRESSION * 10, 0)).toBe(0)
  })

  it('ignores a declared ceiling that would raise the earned one', () => {
    expect(suppressionCeiling(0, 500)).toBe(BASE_ALLOWANCE)
  })
})

describe('judgeSuppressions', () => {
  it('passes a count at the ceiling, which is permitted rather than over', () => {
    const report: SuppressionReport = judgeSuppressions(sites(BASE_ALLOWANCE), 0, undefined)
    expect(report.withinCeiling).toBe(true)
    expect(report.remaining).toBe(0)
  })

  it('fails a count past the ceiling', () => {
    expect(judgeSuppressions(sites(BASE_ALLOWANCE + 1), 0, undefined).withinCeiling).toBe(false)
  })

  it('reports the distance left, so the trend is readable before the ceiling is reached', () => {
    expect(judgeSuppressions(sites(1), LINES_PER_SUPPRESSION * 2, undefined).remaining).toBe(
      BASE_ALLOWANCE + 2 - 1,
    )
  })

  it('never reports a negative distance once the ceiling is passed', () => {
    expect(judgeSuppressions(sites(50), 0, undefined).remaining).toBe(0)
  })

  it('carries the sites through, so the report can name them', () => {
    expect(judgeSuppressions(sites(2), 0, undefined).sites).toHaveLength(2)
  })
})
