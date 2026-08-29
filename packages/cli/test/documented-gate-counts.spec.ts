// The gate counts the two documents state, bound to the registry that decides them.
//
// The numbers had drifted once already: the guide said Default verification runs 31 gates while its own
// table beneath that sentence listed 32 rows, and the registry answered 32. A count written in prose is
// the shape of value this repository refuses everywhere else - two literals that have to stay equal will
// not stay equal - and these are the two places a reader checks before running anything.
//
// Two documents rather than one, because they address different readers and both carry the count.
// `README.adoc` tells a human what the harness does; `.ploaness/agent-guide.md` is materialised into
// every consumer tree and is where the gate tables live, so it is the one that carries the rows. The
// assertion is on the joint rather than on any value: nothing here says what the number is, only that
// every site still agrees about it.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ALL_GATES, type Gate, gatesFor } from '../src/gates.js'

const specDirectory: string = path.dirname(fileURLToPath(import.meta.url))
const workspaceRoot: string = path.join(specDirectory, '..', '..', '..')

const read = (relative: string): string => readFileSync(path.join(workspaceRoot, relative), 'utf8')

const README: string = read('README.adoc')
// The shipped body rather than a consumer's copy: the `.asset` suffix is how npm is stopped from
// rewriting a dotfile path when it packs the package.
const AGENT_GUIDE: string = read('packages/assets/files/.ploaness/agent-guide.md.asset')

// The count is read back out of the sentence that carries it, so a spec cannot pass against a document
// that no longer says anything at all: a pattern matching nothing yields undefined and fails the
// comparison rather than quietly comparing two absences.
const stated = (source: string, pattern: RegExp): string | undefined => pattern.exec(source)?.[1]

const countIn = (source: string, pattern: RegExp): number | undefined => {
  const found: string | undefined = stated(source, pattern)
  return found === undefined ? undefined : Number(found)
}

const DEFAULT_SENTENCE: RegExp = /Default verification runs (\d+) gates/
const EXTENDED_SENTENCE: RegExp = /Extended verification adds (\w+)/

// A row of a gate table: the identifier in backticks in the first cell. The header row and the
// alignment row carry no backticks and are not matched.
const TABLE_ROW: RegExp = /^\| `[a-z0-9-]+` \|/gm

// Everything under a heading until the next one, located by the heading rather than by line number so
// the count survives anything moving above it.
const sectionAfter = (heading: string): string => {
  const start: number = AGENT_GUIDE.indexOf(heading)
  const body: string = AGENT_GUIDE.slice(start + heading.length)
  const end: number = body.search(/^#/m)
  return end === -1 ? body : body.slice(0, end)
}

const rowsIn = (section: string): number => [...section.matchAll(TABLE_ROW)].length

const extendedGateCount = (): number =>
  ALL_GATES.filter((gate: Gate): boolean => gate.isExtended).length

describe('the gate counts the documents state', () => {
  it('matches the number of gates Default verification runs', () => {
    expect(countIn(README, DEFAULT_SENTENCE)).toBe(gatesFor(false).length)
    expect(countIn(AGENT_GUIDE, DEFAULT_SENTENCE)).toBe(gatesFor(false).length)
  })

  it('matches the number of gates Extended verification adds', () => {
    // Spelled as a word in the prose, so the joint is checked through the spelling both documents use.
    expect(stated(README, EXTENDED_SENTENCE)).toBe('six')
    expect(stated(AGENT_GUIDE, EXTENDED_SENTENCE)).toBe('six')
    expect(extendedGateCount()).toBe(6)
  })

  // The sentence and the table beneath it are two statements of one count, and when they disagreed it
  // was the table that was right. Counting its rows holds the guide to itself as well as to the code.
  it('matches the number of rows in each gate table', () => {
    expect(rowsIn(sectionAfter('### Default Verification Gates'))).toBe(gatesFor(false).length)
    expect(rowsIn(sectionAfter('### Extended Verification Gates'))).toBe(extendedGateCount())
  })
})
