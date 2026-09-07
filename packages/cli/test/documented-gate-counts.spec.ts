import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readSettings } from '@ploaness/governance'
import { describe, expect, it } from 'vitest'
import { ALL_GATES, type Gate, gatesFor } from '../src/gates.js'

const DIRECTORY: string = path.dirname(fileURLToPath(import.meta.url))
const ROOT: string = path.join(DIRECTORY, '..', '..', '..')
const README: string = readFileSync(path.join(ROOT, 'README.adoc'), 'utf8')
const GUIDE: string = readFileSync(
  path.join(ROOT, 'packages/assets/files/.ploaness/agent-guide.md.asset'),
  'utf8',
)

const sectionAfter = (heading: string): string => {
  const start: number = GUIDE.indexOf(heading)
  if (start === -1) {
    throw new Error(`the agent guide has no ${heading} section`)
  }
  const body: string = GUIDE.slice(start + heading.length)
  const end: number = body.search(/^#/m)
  return end === -1 ? body : body.slice(0, end)
}

const gateRows = (heading: string): readonly (readonly string[])[] =>
  [
    ...sectionAfter(heading).matchAll(/^\| `([a-z0-9-]+)` \| (repository|package|payload) \|/gm),
  ].map((match: RegExpExecArray): readonly string[] => [match[1] ?? '', match[2] ?? ''])

const expectedRows = (gates: readonly Gate[]): readonly (readonly string[])[] =>
  gates.map((gate: Gate): readonly string[] => [gate.id, gate.scope])

const COUNT_WORDS: readonly string[] = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
]

const statedCount = (source: string, pattern: RegExp): number => {
  const value: string = pattern.exec(source)?.[1] ?? ''
  const index: number = COUNT_WORDS.indexOf(value)
  return index === -1 ? Number(value) : index
}
const extended: readonly Gate[] = ALL_GATES.filter((gate: Gate): boolean => gate.isExtended)

describe('the installed gate reference', () => {
  it('states the actual registry counts in both documents', () => {
    for (const source of [README, GUIDE]) {
      expect(statedCount(source, /Default verification runs (\d+) gates/)).toBe(
        gatesFor(false).length,
      )
      expect(statedCount(source, /Extended verification adds (\w+)/)).toBe(extended.length)
    }
  })

  it('lists every default gate in registry order with its actual scope', () => {
    expect(gateRows('### Default Verification Gates')).toEqual(expectedRows(gatesFor(false)))
  })

  it('lists only the extended gates in registry order with their actual scopes', () => {
    expect(gateRows('### Extended Verification Gates')).toEqual(expectedRows(extended))
  })

  it('documents every consumer setting exactly once', () => {
    const documented: readonly string[] = [
      ...sectionAfter('## Consumer Settings').matchAll(/^\| `([a-z]+)` \|/gim),
    ].map((match: RegExpExecArray): string => match[1] ?? '')
    const settings: readonly string[] = Object.keys(readSettings({})).filter(
      (key: string): boolean => key !== 'declaredExclusions',
    )
    expect(
      documented.toSorted((left: string, right: string): number => left.localeCompare(right)),
    ).toEqual(settings.toSorted((left: string, right: string): number => left.localeCompare(right)))
  })
})
