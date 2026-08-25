// The gate counts README.adoc states, bound to the registry that decides them.
//
// The two numbers had drifted: the guide said Default verification runs 31 gates while its own table
// beneath that sentence listed 32 rows, and the registry answered 32. A count written in prose is the
// shape of value this repository refuses everywhere else - two literals that have to stay equal will
// not stay equal - and the guide is the one place a reader checks before running anything.
//
// The assertion is on the joint rather than on either value: nothing here says what the number is, only
// that the sentence and the registry still agree about it. Adding or removing a gate therefore fails
// here until the guide is updated, which is the failure that was missing.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ALL_GATES, type Gate, gatesFor } from '../src/gates.js'

const specDirectory: string = path.dirname(fileURLToPath(import.meta.url))
const GUIDE: string = readFileSync(
  path.join(specDirectory, '..', '..', '..', 'README.adoc'),
  'utf8',
)

// The count is read back out of the sentence that carries it, so a spec cannot pass against a guide
// that no longer says anything at all: a pattern matching nothing yields undefined and fails the
// comparison rather than quietly comparing two absences.
const countIn = (pattern: RegExp): number | undefined => {
  const found: string | undefined = pattern.exec(GUIDE)?.[1]
  return found === undefined ? undefined : Number(found)
}

const DEFAULT_SENTENCE: RegExp = /runs the following (\d+) gates\./
const EXTENDED_SENTENCE: RegExp = /adds the following (\w+) gates/
const DEFAULT_LINK: RegExp = /xref:#default-gates\[(\d+) default verification gates\]/
const EXTENDED_LINK: RegExp = /xref:#extended-gates\[(\d+) extended verification gates\]/

// A row of a gate table: the gate identifier in backticks, behind the cross-reference anchor the first
// few rows carry. The behaviour cell that follows is a second row in the source and is not matched.
const TABLE_ROW: RegExp = /^\| (?:\[\[[a-z0-9-]+(?:,[^\]]*)?\]\])?`[a-z0-9-]+`$/gm
const TABLE_DELIMITER: string = '|==='

// The table that follows a named anchor, located by the anchor rather than by line number so the count
// survives anything moving above it. AsciiDoc brackets a table with a delimiter line at each end.
const tableAfter = (anchor: string): string => {
  const section: string = GUIDE.slice(GUIDE.indexOf(anchor))
  const open: number = section.indexOf(TABLE_DELIMITER)
  const close: number = section.indexOf(TABLE_DELIMITER, open + TABLE_DELIMITER.length)
  return section.slice(open, close)
}

const rowsIn = (table: string): number => [...table.matchAll(TABLE_ROW)].length

const extendedGateCount = (): number =>
  ALL_GATES.filter((gate: Gate): boolean => gate.isExtended).length

describe('the gate counts the guide states', () => {
  it('matches the number of gates Default verification runs', () => {
    expect(countIn(DEFAULT_SENTENCE)).toBe(gatesFor(false).length)
    expect(countIn(DEFAULT_LINK)).toBe(gatesFor(false).length)
  })

  it('matches the number of gates Extended verification adds', () => {
    expect(countIn(EXTENDED_LINK)).toBe(extendedGateCount())
    // Spelled as a word in the prose, so the joint is checked through the spelling the guide uses.
    expect(EXTENDED_SENTENCE.exec(GUIDE)?.[1]).toBe('six')
    expect(extendedGateCount()).toBe(6)
  })

  // The sentence and the table beneath it are two statements of one count, and when they disagreed it
  // was the table that was right. Counting its rows holds the guide to itself as well as to the code.
  it('matches the number of rows in each gate table', () => {
    expect(rowsIn(tableAfter('[[default-gates]]'))).toBe(gatesFor(false).length)
    expect(rowsIn(tableAfter('[[extended-gates]]'))).toBe(extendedGateCount())
  })
})
