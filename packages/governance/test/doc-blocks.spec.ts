import { describe, expect, it } from 'vitest'
import { type DocBlock, findOrphanedDocBlocks } from '../src/doc-blocks.js'

// The scanner reads line beginnings, so a fixture written with literal markers would make this spec a
// counterexample to the rule it tests - the same self-reference banned-typography.spec.ts avoids by
// building its glyphs from code points. The delimiters are assembled here for that reason.
const ASTERISK: string = '*'
const OPEN: string = `/${ASTERISK}${ASTERISK}`
const CLOSE: string = `${ASTERISK}/`

/** One doc block on a single line. */
const doc = (body: string): string => `${OPEN} ${body} ${CLOSE}`

/** One doc block spread over an opening line, a description, and a closing line. */
const multilineDoc = (body: string): string => `${OPEN}\n ${ASTERISK} ${body}\n ${CLOSE}`

const DECLARATION: string = 'export const value: number = 1'

const scan = (...lines: readonly string[]): readonly DocBlock[] =>
  findOrphanedDocBlocks(lines.join('\n'))

describe('findOrphanedDocBlocks, on a block another block follows', () => {
  it('flags a doc block followed immediately by another doc block', () => {
    const result: readonly DocBlock[] = scan(doc('orphan'), doc('the real doc'), DECLARATION)
    expect(result).toEqual([{ line: 1, endLine: 1 }])
  })

  it('flags across a blank line, because whitespace is not a declaration', () => {
    const result: readonly DocBlock[] = scan(doc('orphan'), '', doc('the real doc'), DECLARATION)
    expect(result).toEqual([{ line: 1, endLine: 1 }])
  })

  it('reports the opening and closing lines of a multi-line orphan', () => {
    const result: readonly DocBlock[] = scan(
      multilineDoc('orphan'),
      doc('the real doc'),
      DECLARATION,
    )
    expect(result).toEqual([{ line: 1, endLine: 3 }])
  })

  it('flags every block in a run except the one that reaches the declaration', () => {
    const result: readonly DocBlock[] = scan(
      doc('first orphan'),
      doc('second orphan'),
      doc('the real doc'),
      DECLARATION,
    )
    expect(result).toEqual([
      { line: 1, endLine: 1 },
      { line: 2, endLine: 2 },
    ])
  })

  it('reads CRLF line endings the same as LF', () => {
    const text: string = [doc('orphan'), doc('the real doc'), DECLARATION].join('\r\n')
    expect(findOrphanedDocBlocks(text)).toEqual([{ line: 1, endLine: 1 }])
  })
})

describe('findOrphanedDocBlocks, on the shapes that are not orphans', () => {
  it('finds nothing when every doc block precedes a declaration', () => {
    expect(scan(doc('documents the value'), DECLARATION)).toEqual([])
  })

  it('finds nothing in a file with no doc blocks at all', () => {
    expect(scan(DECLARATION, 'export const other: number = 2')).toEqual([])
  })

  it('does not flag a trailing doc block that nothing follows', () => {
    expect(scan(DECLARATION, doc('trailing'))).toEqual([])
  })

  it('does not flag a doc block separated from the next by a declaration', () => {
    const result: readonly DocBlock[] = scan(
      doc('documents the value'),
      DECLARATION,
      doc('documents the other'),
      'export const other: number = 2',
    )
    expect(result).toEqual([])
  })

  // Deliberately narrow. A line comment carries a reason someone wrote on purpose, and a doc block
  // above one is a shape a person chose rather than the residue of a move. The rule reports the
  // doubled-block signature only, which is the one that is always a mistake.
  it('does not flag a doc block separated from the next by a line comment', () => {
    const result: readonly DocBlock[] = scan(
      doc('documents the value'),
      '// a note about what follows',
      doc('the real doc'),
      DECLARATION,
    )
    expect(result).toEqual([])
  })

  it('does not treat a plain block comment as a doc block', () => {
    const plain: string = `/${ASTERISK} not a doc ${ASTERISK}/`
    expect(scan(plain, doc('the real doc'), DECLARATION)).toEqual([])
  })
})
