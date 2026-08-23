import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  type EditorconfigRules,
  type EditorconfigViolation,
  findEditorconfigViolations,
  MAX_LINE_LENGTH,
  parseEditorconfig,
} from '../src/editorconfig-policy.js'

const rules = (overrides: Partial<EditorconfigRules> = {}): EditorconfigRules => ({
  endOfLine: 'lf',
  insertFinalNewline: true,
  trimTrailingWhitespace: true,
  indentStyle: 'space',
  ...overrides,
})

const reasons = (
  content: string,
  config: EditorconfigRules = rules(),
  isCapEnforced = false,
): string[] =>
  findEditorconfigViolations(content, config, isCapEnforced).map((violation) => violation.reason)

describe('parseEditorconfig', () => {
  // The joint: the shipped `.editorconfig` is what every project is held to, so the parser must
  // actually recognise the properties that file declares. A parser that silently read none of them
  // would make the gate pass everything.
  it('recognises every property the shipped .editorconfig declares', () => {
    const asset: string = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../assets/files/.editorconfig.asset',
    )
    const parsed: EditorconfigRules = parseEditorconfig(readFileSync(asset, 'utf8'))
    expect(parsed).toEqual({
      endOfLine: 'lf',
      insertFinalNewline: true,
      trimTrailingWhitespace: true,
      indentStyle: 'space',
    })
  })

  it('reads only the wildcard section, not a section for one file type', () => {
    const parsed: EditorconfigRules = parseEditorconfig(
      '[*]\nindent_style = space\n\n[*.md]\nindent_style = tab\n',
    )
    expect(parsed.indentStyle).toBe('space')
  })

  it('ignores comments and blank lines', () => {
    expect(parseEditorconfig('[*]\n# a comment\n\nend_of_line = lf\n').endOfLine).toBe('lf')
  })
})

describe('findEditorconfigViolations', () => {
  it('accepts a conforming file', () => {
    expect(reasons('const value = 1\n')).toEqual([])
  })

  it('accepts an empty file, which departs from nothing', () => {
    expect(reasons('')).toEqual([])
  })

  it('reports a carriage return', () => {
    expect(reasons('const value = 1\r\n')[0]).toContain('carriage return')
  })

  it('reports trailing whitespace', () => {
    expect(reasons('const value = 1   \n')[0]).toContain('trailing whitespace')
  })

  it('reports tab indentation', () => {
    expect(reasons('\tconst value = 1\n')[0]).toContain('tab indentation')
  })

  it('reports a missing final newline', () => {
    expect(reasons('const value = 1')[0]).toContain('no final newline')
  })

  it('reports a byte order mark', () => {
    expect(reasons('﻿const value = 1\n')[0]).toContain('byte order mark')
  })

  it('reports the line, so the finding points at a real position', () => {
    const found: readonly EditorconfigViolation[] = findEditorconfigViolations(
      'ok\nbad   \n',
      rules(),
      false,
    )
    expect(found[0]?.line).toBe(2)
  })

  it('honours a property the configuration turns off', () => {
    expect(reasons('const value = 1   \n', rules({ trimTrailingWhitespace: false }))).toEqual([])
  })

  it('reports a line past the cap when the role is code', () => {
    const long: string = `${'x'.repeat(MAX_LINE_LENGTH + 1)}\n`
    expect(reasons(long, rules(), true)[0]).toContain(`the cap is ${String(MAX_LINE_LENGTH)}`)
  })

  it('accepts a line exactly at the cap', () => {
    expect(reasons(`${'x'.repeat(MAX_LINE_LENGTH)}\n`, rules(), true)).toEqual([])
  })

  it('leaves a long prose line alone, because the cap is a Code Rule', () => {
    expect(reasons(`${'x'.repeat(MAX_LINE_LENGTH + 50)}\n`, rules(), false)).toEqual([])
  })
})
