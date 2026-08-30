import { describe, expect, it } from 'vitest'
import { findTypographyViolations, type TypographyViolation } from '../src/banned-typography.js'

// Banned glyphs are built from code points so this spec never trips the typography gate on itself.
const EM_DASH: string = String.fromCodePoint(0x2014)
const EN_DASH: string = String.fromCodePoint(0x2013)
const ELLIPSIS: string = String.fromCodePoint(0x2026)
const LEFT_QUOTE: string = String.fromCodePoint(0x201c)
const RIGHT_QUOTE: string = String.fromCodePoint(0x201d)
const LOW_QUOTE: string = String.fromCodePoint(0x201e)
const LEFT_SINGLE_QUOTE: string = String.fromCodePoint(0x2018)
const RIGHT_SINGLE_QUOTE: string = String.fromCodePoint(0x2019)
const LOW_SINGLE_QUOTE: string = String.fromCodePoint(0x201a)

// The set the STANDARD names, transcribed from its own words rather than from the table under test:
// "the em dash, the en dash, typographic quotation marks, and the single-character ellipsis". The
// quotation marks are all six, which is the whole reason this list is written out here - the scanner
// enforced the three double forms and passed the three single ones for as long as nothing compared the
// two statements. This is the comparison. Deleting a row from BANNED_CHARACTERS fails it, which is what
// makes it a test of the joint rather than of a constant against its own literal.
const DOCUMENTED_SET: readonly string[] = [
  EM_DASH,
  EN_DASH,
  ELLIPSIS,
  LEFT_QUOTE,
  RIGHT_QUOTE,
  LOW_QUOTE,
  LEFT_SINGLE_QUOTE,
  RIGHT_SINGLE_QUOTE,
  LOW_SINGLE_QUOTE,
]

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

// The contract half: what the standard SAYS is banned, against what the table enforces. Separate from
// the positional cases above because it is a different question - those ask where a violation is
// reported, these ask whether it is reported at all.
describe('the documented typography contract', () => {
  it('flags every character the standard documents as banned', () => {
    const unreported: readonly string[] = DOCUMENTED_SET.filter(
      (character: string): boolean => findTypographyViolations(`a${character}b`).length !== 1,
    )
    expect(
      unreported.map((character: string): string => character.codePointAt(0)?.toString(16) ?? ''),
    ).toEqual([])
  })

  it('flags the curly apostrophe, which is what a language model emits by default', () => {
    const result: readonly TypographyViolation[] = findTypographyViolations(
      `it${RIGHT_SINGLE_QUOTE}s`,
    )
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      line: 1,
      column: 3,
      label: 'right single quote (U+2019)',
    })
  })
})
