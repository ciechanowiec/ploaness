import { describe, expect, it } from 'vitest'
import { type ArbitraryValueViolation, findArbitraryValues } from '../src/tailwind-tokens.js'

const isReported = (line: string): boolean => findArbitraryValues(line).length > 0

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

  it('still reports a calculation over lengths the theme could hold', () => {
    // Arithmetic on two absolute lengths: both belong in the theme, so the calculation does too.
    expect(findArbitraryValues('<div className="w-[calc(100px+2rem)]" />')).toHaveLength(1)
  })

  // This case USED to be the example of a calculation "over only literals" and reported. That reading
  // was wrong on the rule's own stated principle: a percentage is not a literal length, it resolves
  // against whatever contains the element, so the number it produces is not knowable where a token
  // would have to be written - which is exactly why `var(--x)` beside it is excused.
  it('accepts a calculation whose result depends on the container or the viewport', () => {
    expect(findArbitraryValues('<div className="w-[calc(100%-1px)]" />')).toEqual([])
    expect(findArbitraryValues('<div className="h-[calc(50vh-2rem)]" />')).toEqual([])
  })

  it('still reports a bare viewport unit, which is a value and not a calculation', () => {
    expect(findArbitraryValues('<div className="h-[50vh]" />')).toHaveLength(1)
  })
})

// The rule governs colour, size, spacing, radius and motion values, and Tailwind v4 has a theme
// namespace for each. Two shapes have none, so reporting them asked a project for a token that could
// not be written and left a suppression as the only way out - which spends a real allowance on a false
// finding. The line between them and a genuine finding is narrow and worth pinning on both sides.
describe('values no theme namespace could hold', () => {
  it('exempts the flex shorthand, which is a behaviour triple rather than a value', () => {
    expect(isReported('<div className="flex-[1_0_auto]" />')).toBe(false)
    expect(isReported('<div className="flex-[0_0_auto]" />')).toBe(false)
  })

  it('still reports flex-[1], because Tailwind ships flex-1 for it', () => {
    // Not the same defect as the shorthand: here a utility already exists and was written around.
    expect(isReported('<div className="flex-[1]" />')).toBe(true)
  })

  it('exempts a calc() value, which is relative to whatever contains the element', () => {
    expect(isReported('<div className="w-[calc(100%-1px)]" />')).toBe(false)
  })

  it('still reports a fixed size, an aspect ratio and a grid span', () => {
    // The neighbours of the exemptions, so widening one cannot quietly take these with it.
    expect(isReported('<div className="w-[345px]" />')).toBe(true)
    expect(isReported('<div className="aspect-[604/338]" />')).toBe(true)
    expect(isReported('<div className="col-[1/-1]" />')).toBe(true)
  })

  it('does not exempt a flex-shaped value on a utility that is not flex', () => {
    // The test reads the utility before the bracket, so `shadow-[0_0_6px_#000]` - which also carries
    // spaces - stays a finding, because --shadow-* is a namespace it could have come from.
    expect(isReported('<div className="shadow-[0_0_6px_#000]" />')).toBe(true)
  })
})
