import { describe, expect, it } from 'vitest'
import { findTypographyViolations, type TypographyViolation } from '../src/banned-typography.js'

// Banned glyphs are built from code points so this spec never trips the typography gate on itself.
const EM_DASH: string = String.fromCodePoint(0x2014)
const EN_DASH: string = String.fromCodePoint(0x2013)
const ELLIPSIS: string = String.fromCodePoint(0x2026)
const LEFT_QUOTE: string = String.fromCodePoint(0x201c)
const RIGHT_QUOTE: string = String.fromCodePoint(0x201d)
const LOW_QUOTE: string = String.fromCodePoint(0x201e)

describe('findTypographyViolations', () => {
  it('returns no violations for clean ASCII text', () => {
    expect(findTypographyViolations('plain - text with "quotes" and ... dots')).toEqual([])
  })

  it('flags an em dash with a hyphen replacement at a 1-based position', () => {
    const result: readonly TypographyViolation[] = findTypographyViolations(`ab${EM_DASH}cd`)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      line: 1,
      column: 3,
      label: 'em dash (U+2014)',
      replacement: 'a hyphen "-"',
    })
  })

  it('maps each banned glyph to its intended replacement and label', () => {
    expect(findTypographyViolations(EN_DASH)[0]?.replacement).toBe('a hyphen "-"')
    expect(findTypographyViolations(ELLIPSIS)[0]?.replacement).toBe('three dots "..."')
    expect(findTypographyViolations(LEFT_QUOTE)[0]?.replacement).toBe('a straight double quote')
    expect(findTypographyViolations(RIGHT_QUOTE)[0]?.label).toBe('right double quote (U+201D)')
    expect(findTypographyViolations(LOW_QUOTE)[0]?.label).toBe('low double quote (U+201E)')
  })

  it('reports the correct line and column across multiple lines', () => {
    const result: readonly TypographyViolation[] = findTypographyViolations(
      `clean\nbad${ELLIPSIS}here`,
    )
    expect(result[0]).toMatchObject({ line: 2, column: 4 })
  })

  it('reports multiple violations in banned-character order', () => {
    const result: readonly TypographyViolation[] = findTypographyViolations(`${EM_DASH}${EN_DASH}`)
    expect(result.map((violation) => violation.label)).toEqual([
      'em dash (U+2014)',
      'en dash (U+2013)',
    ])
  })
})
