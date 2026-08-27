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

describe('utilities whose bracket takes a property rather than a value', () => {
  it('accepts a transition naming the properties that animate', () => {
    // Not a colour, size, spacing, radius or motion VALUE - there is no theme namespace it could come
    // from, so reporting it asked for a token that cannot exist.
    expect(findArbitraryValues('<div className="transition-[color,box-shadow]" />')).toEqual([])
  })

  it('accepts will-change naming the property about to change', () => {
    expect(findArbitraryValues('<div className="will-change-[margin-top]" />')).toEqual([])
  })

  it('still reports a value on a utility that has a theme namespace', () => {
    expect(findArbitraryValues('<div className="bg-[#0a7]" />')).toHaveLength(1)
  })

  it('still reports a duration, which motion tokens do cover', () => {
    expect(findArbitraryValues('<div className="duration-[400ms]" />')).toHaveLength(1)
  })
})

describe('a bracketed value that reads a custom property', () => {
  it('accepts a margin taken from a runtime custom property', () => {
    // The value is computed at render, so no static theme token could hold it.
    expect(findArbitraryValues('<div className="mb-[var(--section-gap)]" />')).toEqual([])
  })

  it('accepts a calculation over a custom property', () => {
    expect(
      findArbitraryValues('<div className="basis-[calc(var(--tile-basis)_-_2rem)]" />'),
    ).toEqual([])
  })

  it('still reports a calculation over only literals', () => {
    expect(findArbitraryValues('<div className="w-[calc(100%-1px)]" />')).toHaveLength(1)
  })
})
