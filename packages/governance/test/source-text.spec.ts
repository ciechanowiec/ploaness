// The reader three layers now stand on: the Payload rules, the JSONC parser the wiring rule uses, and
// the config-body lookup. Its edge cases used to be exercised only incidentally, through whichever rule
// happened to call it, so a defect here would have been reported as a defect in that rule.
import { describe, expect, it } from 'vitest'
import {
  balancedArguments,
  enclosingLiteral,
  lineOf,
  maskLiterals,
  occurrences,
  stripComments,
  topLevelKeys,
  topLevelSlice,
} from '../src/source-text.js'

// Blanked to spaces of equal length rather than deleted, so a column reported after a comment still
// points where the editor puts it. Every case below asserts both halves: the text is gone, and the
// offsets did not move.
const blanked = (source: string): { readonly text: string; readonly sameLength: boolean } => {
  const text: string = stripComments(source)
  return { text, sameLength: text.length === source.length }
}

describe('stripComments: comments', () => {
  it('blanks a line comment', () => {
    const { text, sameLength } = blanked('const a = 1 // why')
    expect(text.trimEnd()).toBe('const a = 1')
    expect(sameLength).toBe(true)
  })

  it('blanks a block comment', () => {
    const { text, sameLength } = blanked('const /* why */ a = 1')
    expect(text).not.toContain('why')
    expect(text.replaceAll(' ', '')).toBe('consta=1')
    expect(sameLength).toBe(true)
  })

  it('preserves the line count so a reported position still points at real source', () => {
    expect(stripComments('/* one\ntwo */\nconst a = 1').split('\n')).toHaveLength(3)
  })

  // A string's contents are the only place a banned construct can legitimately appear as data.
  it('leaves a string literal untouched', () => {
    expect(stripComments(`const a = '// not a comment'`)).toBe(`const a = '// not a comment'`)
  })

  it.each(["'", '"', '`'])('treats %s as a string delimiter', (quote: string) => {
    expect(stripComments(`const a = ${quote}//x${quote}`)).toContain('//x')
  })

  it('reads past an escaped quote rather than ending the literal on it', () => {
    const { text, sameLength } = blanked(String.raw`const a = 'it\'s' // why`)
    expect(text.trimEnd()).toBe(String.raw`const a = 'it\'s'`)
    expect(sameLength).toBe(true)
  })
})

// A `/` opens a regex only where a value may start, which is what stops a division from being read as
// one. Split from the block above so neither runs past the size cap the caps rule applies to a spec.
describe('stripComments: regex literals and unterminated constructs', () => {
  it('blanks a regex literal, escaped slashes and all', () => {
    const { text, sameLength } = blanked(String.raw`const a = /https:\/\//`)
    expect(text.trimEnd()).toBe('const a =')
    expect(sameLength).toBe(true)
  })

  it('does not read a division as a regex literal', () => {
    expect(stripComments('const a = b / c')).toBe('const a = b / c')
  })

  it('does not end a regex literal on a slash inside a character class', () => {
    const { text, sameLength } = blanked('const a = /[/]/ + 1')
    expect(text.replaceAll(' ', '')).toBe('consta=+1')
    expect(sameLength).toBe(true)
  })

  it('stops a regex literal at a newline rather than running to the end of the file', () => {
    expect(stripComments('const a = /x\nconst b = 1').split('\n')).toHaveLength(2)
  })

  it('reads an unterminated block comment to the end rather than looping', () => {
    const { text, sameLength } = blanked('const a = 1 /* never closed')
    expect(text.trimEnd()).toBe('const a = 1')
    expect(sameLength).toBe(true)
  })

  it('reads an unterminated string to the end rather than looping', () => {
    expect(stripComments("const a = 'never closed")).toBe("const a = 'never closed")
  })

  it('returns empty text unchanged', () => {
    expect(stripComments('')).toBe('')
  })
})

describe('balancedArguments', () => {
  it('reads the text between a parenthesis and its match', () => {
    expect(balancedArguments('f(a, b)', 1)).toBe('a, b')
  })

  it('reads past a nested pair', () => {
    expect(balancedArguments('f(g(a), b)', 1)).toBe('g(a), b')
  })

  it('does not let a bracket inside a string unbalance the scan', () => {
    expect(balancedArguments("f('(', b)", 1)).toBe("'(', b")
  })

  it('returns undefined for an unterminated call, which another gate reports as a parse error', () => {
    expect(balancedArguments('f(a, b', 1)).toBeUndefined()
  })
})

describe('topLevelSlice', () => {
  it('keeps depth-one keys and elides nested ones', () => {
    const argumentText: string = "{ collection: 'posts', where: { depth: 9 } }"
    expect(topLevelSlice(argumentText)).toContain('collection')
    expect(topLevelSlice(argumentText)).not.toContain('depth')
  })

  it('ignores braces inside string literals', () => {
    expect(topLevelSlice("{ slug: '{not-a-brace}', limit: 5 }")).toContain('limit')
  })
})

describe('topLevelKeys', () => {
  it('names the keys of the literal that opens at the offset', () => {
    expect(topLevelKeys('{ a: 1, b: 2 }', 0)).toEqual(['a', 'b'])
  })

  it('does not name a key of a nested literal', () => {
    expect(topLevelKeys('{ a: 1, b: { c: 2 } }', 0)).toEqual(['a', 'b'])
  })

  it('yields nothing when there is no literal to read', () => {
    expect(topLevelKeys('const a = 1', 0)).toEqual([])
  })

  it('yields nothing when the literal is unterminated', () => {
    expect(topLevelKeys('{ a: 1', 0)).toEqual([])
  })
})

describe('lineOf and occurrences', () => {
  it('counts lines from one', () => {
    expect(lineOf('a\nb\nc', 4)).toBe(3)
  })

  it('finds every offset a literal occurs at', () => {
    expect(occurrences('a.b a.b', 'a.b')).toEqual([0, 4])
  })

  // The needle is a call expression such as `payload.find(`, so its punctuation must not be read as
  // pattern syntax.
  it('does not read the needle punctuation as a pattern', () => {
    expect(occurrences('axb', 'a.b')).toEqual([])
  })
})

// The same walk as `stripComments`, differing only in what it does with a string. Its whole value is
// that a caller can locate syntax by offset without reading inside a literal, so both halves are
// asserted: the string is gone, and nothing moved.
describe('maskLiterals', () => {
  it('blanks a string literal as well as a comment', () => {
    const source: string = 'const a = "one, two" // why'
    const masked: string = maskLiterals(source)
    expect(masked.includes('one')).toBe(false)
    expect(masked.includes('why')).toBe(false)
    expect(masked).toHaveLength(source.length)
    expect(masked.startsWith('const a = ')).toBe(true)
  })

  it('keeps the punctuation outside a string where it stood', () => {
    const source: string = '{ "a": "x,]" , }'
    const masked: string = maskLiterals(source)
    // The comma the document declares is still at its own offset; the one inside the string is gone,
    // so the first comma the mask carries is the last comma the source carries.
    expect(masked.indexOf(',')).toBe(source.lastIndexOf(','))
    expect(masked).toHaveLength(source.length)
  })

  // The property `parseJsonc` stands on, and the one a mask of spaces silently broke: a separator
  // between two strings must not read as a trailing comma once the strings are gone.
  it('does not turn a separator between two strings into a trailing comma', () => {
    const trailingComma: RegExp = /,(?=\s*[\]}])/
    expect(trailingComma.test(maskLiterals('["a", "b"]'))).toBe(false)
    expect(trailingComma.test(maskLiterals('["a", ]'))).toBe(true)
  })

  it('leaves newlines intact so a masked offset still names its line', () => {
    const source: string = 'const a = "one\ntwo"\nconst b = 1'
    expect(maskLiterals(source).split('\n')).toHaveLength(source.split('\n').length)
  })
})

// The reader that starts from something found INSIDE a literal and recovers the object it belongs to.
// A rule uses it to take a marker key back to its own field, so the cases that matter are the ones where
// "the nearest brace" and "the enclosing brace" are different answers.
describe('enclosingLiteral', () => {
  it('recovers the object literal an offset sits in', () => {
    const source: string = "{ fields: [{ name: 'a', type: 'relationship' }] }"
    const at: number = source.indexOf("'relationship'")
    expect(enclosingLiteral(source, at)).toBe("{ name: 'a', type: 'relationship' }")
  })

  it('recovers the innermost one when literals are nested', () => {
    const source: string = '{ outer: true, inner: { deep: { mark: 1 } } }'
    const at: number = source.indexOf('mark')
    expect(enclosingLiteral(source, at)).toBe('{ mark: 1 }')
  })

  it('picks the literal the offset is in rather than the one before it', () => {
    const source: string = "[{ name: 'first' }, { name: 'second' }]"
    const at: number = source.indexOf("'second'")
    expect(enclosingLiteral(source, at)).toBe("{ name: 'second' }")
  })

  // Walking backwards from the offset would be the obvious implementation, and a brace inside a quoted
  // value would close a literal that was never open.
  it('is not fooled by a brace inside a string literal', () => {
    const source: string = "{ pattern: '}{', mark: 1 }"
    const at: number = source.indexOf('mark')
    expect(enclosingLiteral(source, at)).toBe(source)
  })

  it('reports nothing for an offset inside no literal at all', () => {
    expect(enclosingLiteral('const value = 1', 6)).toBeUndefined()
  })

  // The walk jumps a string literal whole, so an offset pointing at one is never visited. This is the
  // case every caller actually has - a marker is found by searching for its quoted value - and an
  // equality test on the offset reported nothing for all of them.
  it('recovers the literal from an offset pointing at a quoted value', () => {
    const source: string = "{ fields: [{ name: 'a', type: 'relationship' }] }"
    expect(enclosingLiteral(source, source.indexOf("'relationship'"))).toBe(
      "{ name: 'a', type: 'relationship' }",
    )
  })
})
