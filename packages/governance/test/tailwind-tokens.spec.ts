import { describe, expect, it } from 'vitest'
import { type ArbitraryValueViolation, findArbitraryValues } from '../src/tailwind-tokens.js'

const valuesIn = (content: string): readonly string[] =>
  findArbitraryValues(content).map((violation: ArbitraryValueViolation): string => violation.value)

describe('findArbitraryValues', () => {
  it('flags a colour written as a literal instead of a theme token', () => {
    expect(valuesIn('<div className="bg-[#0a7] p-4" />')).toEqual(['-[#0a7]'])
  })

  it('flags a size written as a literal, and says where it is', () => {
    const [violation]: readonly ArbitraryValueViolation[] = findArbitraryValues(
      '\n  className="translate-y-[2px]"',
    )
    expect(violation).toEqual({ line: 2, column: 25, value: '-[2px]' })
  })

  it('reports every literal on a line rather than stopping at the first', () => {
    expect(valuesIn('className="bg-[#0a7] p-[13px] m-[2rem]"')).toEqual([
      '-[#0a7]',
      '-[13px]',
      '-[2rem]',
    ])
  })

  it('accepts markup whose every value comes from the theme', () => {
    expect(valuesIn('<div className="bg-primary p-4 rounded-lg" />')).toEqual([])
  })

  // The two cases the rule must not confuse with a value, and the reason the match is what it is.
  it('leaves an arbitrary variant alone, because a selector prefix is not a value', () => {
    expect(valuesIn('className="data-[state=open]:bg-primary [&>tr]:border-0"')).toEqual([])
  })

  it('leaves TypeScript index access alone, which carries no dash before the bracket', () => {
    expect(valuesIn('const chip: string = medalChip[result.medal]')).toEqual([])
  })

  it('finds nothing in an empty file', () => {
    expect(valuesIn('')).toEqual([])
  })
})
