// The findings a rule reported that were never defects.
//
// A false positive costs more than the finding it displaces: it teaches a project that the gate is
// wrong, and the next real finding is read the same way. Each case below is one the shipped rules
// produced, grouped here rather than scattered because they share that single cause.
import { describe, expect, it } from 'vitest'
import { findTypographyViolations } from '../src/banned-typography.js'
import { parseMessage, validateMessage } from '../src/commit-message.js'
import { isLicenseAllowed } from '../src/license-allowlist.js'
import { renderGitleaksConfig } from '../src/secret-policy.js'
import { findSkillManifestViolations } from '../src/skill-manifest.js'

// Named by code point rather than written out, which is the same self-reference `banned-typography.ts`
// solves the same way: this file is about the character it bans, and spelling it here would make the
// spec a counterexample to the rule it asserts.
const EM_DASH_CODE_POINT: number = 0x2014
const EM_DASH: string = String.fromCodePoint(EM_DASH_CODE_POINT)

const manifest = (description: string): string =>
  `---\nname: my-skill\ndescription: ${description}\n---\n\n# Body\n`

const violationsOf = (content: string): readonly string[] =>
  findSkillManifestViolations({ content, directoryName: 'my-skill' }).map(
    (violation): string => violation.rule,
  )

const withKey = (line: string): string =>
  `---\nname: my-skill\ndescription: Use when asked.\n${line}\n---\n\n# Body\n`

const rendered = (reason: string): string =>
  renderGitleaksConfig([{ path: 'tests/a.json', reason }])

// Every rule that reads a line was written against `\n`. A repository cloned with `core.autocrlf=true`
// carries `\r\n`, and `.` does not cross a `\r` - so each of these reported a defect whose message
// named something other than the one character that actually differed.
describe('a file whose lines end in CRLF', () => {
  it('does not turn a valid commit header into an invalid one', () => {
    const message: string =
      'feat: add the freshness reader\r\n\r\nA body that explains the why.\r\n'
    expect(validateMessage(parseMessage(message), true)).toEqual([])
  })

  it('still rejects a trailing period through the CRLF', () => {
    const message: string = 'feat: add the freshness reader.\r\n\r\nA body explaining why.\r\n'
    expect(validateMessage(parseMessage(message), true).join(' ')).toContain('period')
  })

  it('does not report a valid skill manifest as having no frontmatter', () => {
    const withCrlf: string = manifest('Use when the user asks.')
    expect(
      findSkillManifestViolations({
        content: withCrlf.replaceAll('\n', '\r\n'),
        directoryName: 'my-skill',
      }),
    ).toEqual([])
  })

  it('reports a banned character on the line it is actually on', () => {
    const text: string = `first\r\nsecond ${EM_DASH} third\r\n`
    expect(findTypographyViolations(text)[0]?.line).toBe(2)
  })
})

describe('a skill description', () => {
  it('accepts a "when" clause', () => {
    expect(violationsOf(manifest('Use when the user asks for a chart.'))).toEqual([])
  })

  // The most common phrasing there is. A trailing word boundary rejected it, which made the rule an
  // instruction to write the description worse.
  it('accepts "whenever", which says the same thing', () => {
    expect(violationsOf(manifest('Use whenever the user asks for a chart.'))).toEqual([])
  })

  it('still reports a description that says nothing about when to reach for the skill', () => {
    expect(violationsOf(manifest('A helper for charts.'))).toEqual(['description'])
  })

  // A description longer than a line is written as a block scalar. Reading only the key's own line
  // yielded ">-" as the whole description, which then failed every check below it.
  it('reads a folded block scalar as its text rather than as its indicator', () => {
    const content: string = [
      '---',
      'name: my-skill',
      'description: >-',
      '  Use when the user asks for a chart, a graph, or any other',
      '  visual summary of tabular data.',
      '---',
      '',
      '# Body',
      '',
    ].join('\n')
    expect(violationsOf(content)).toEqual([])
  })

  it('reads a literal block scalar the same way', () => {
    const content: string = [
      '---',
      'name: my-skill',
      'description: |',
      '  Use when the user asks for a chart.',
      '---',
      '',
      '# Body',
      '',
    ].join('\n')
    expect(violationsOf(content)).toEqual([])
  })
})

// Keys Claude Code accepts. Reporting one as unknown is the rule telling a project to delete something
// that works.
describe('a skill frontmatter key', () => {
  it.each(['model: opus', 'argument-hint: <file>', 'disable-model-invocation: true'])(
    'accepts %j',
    (line: string) => {
      expect(
        findSkillManifestViolations({ content: withKey(line), directoryName: 'my-skill' }),
      ).toEqual([])
    },
  )

  it('still reports a key that is genuinely not part of the contract', () => {
    expect(
      findSkillManifestViolations({ content: withKey('colour: blue'), directoryName: 'my-skill' }),
    ).toEqual([{ rule: 'keys', reason: 'unknown frontmatter key "colour"' }])
  })
})

// SPDX binds AND more tightly than OR. Stripping the parentheses and splitting on AND first inverted
// that, so every mixed expression was judged against operands the author never wrote.
describe('a compound SPDX expression', () => {
  it('accepts a choice between two permitted licences', () => {
    expect(isLicenseAllowed('MIT OR Apache-2.0')).toBe(true)
  })

  it('accepts a parenthesised choice', () => {
    expect(isLicenseAllowed('(MIT OR Apache-2.0)')).toBe(true)
  })

  it('accepts a parenthesised choice combined with a permitted licence', () => {
    expect(isLicenseAllowed('(MIT OR Apache-2.0) AND ISC')).toBe(true)
  })

  it('accepts a conjunction of permitted licences', () => {
    expect(isLicenseAllowed('MIT AND ISC')).toBe(true)
  })

  it('refuses a conjunction that includes a forbidden licence', () => {
    expect(isLicenseAllowed('MIT AND GPL-3.0-only')).toBe(false)
  })

  it('accepts a choice that offers one permitted licence beside a forbidden one', () => {
    expect(isLicenseAllowed('GPL-3.0-only OR MIT')).toBe(true)
  })

  it('refuses a group whose every operand is forbidden', () => {
    expect(isLicenseAllowed('(GPL-3.0-only OR AGPL-3.0-only) AND MIT')).toBe(false)
  })

  it('reads an id whose casing differs from the register', () => {
    expect(isLicenseAllowed('mit')).toBe(true)
  })

  it('reads a licence carrying an exception as that licence', () => {
    expect(isLicenseAllowed('MPL-2.0 WITH Classpath-exception-2.0')).toBe(true)
  })

  it('reads an or-later suffix as the licence it qualifies', () => {
    expect(isLicenseAllowed('Apache-2.0+')).toBe(true)
  })

  it('still refuses a licence that is not on the list', () => {
    expect(isLicenseAllowed('AGPL-3.0-only')).toBe(false)
  })
})

// A reason is prose a project writes, so it arrives with whatever prose contains.
describe('a rendered scanner configuration', () => {
  it('escapes a tab in the reason', () => {
    expect(rendered('first\tsecond')).toContain(String.raw`first\tsecond`)
  })

  it('escapes a control character the document has no named escape for', () => {
    const Bell: number = 0x07
    expect(rendered(`first${String.fromCodePoint(Bell)}second`)).toContain(
      String.raw`first\u0007second`,
    )
  })

  it('keeps the description on one line whatever the reason contains', () => {
    const lines: readonly string[] = rendered('first\nsecond\rthird').split('\n')
    expect(lines.filter((line: string) => line.startsWith('description'))).toHaveLength(1)
  })
})

// `indexOf` reported the first occurrence of each character per line, so clearing a file took as many
// runs as its worst line had repeats.
describe('a line carrying a banned character more than once', () => {
  it('reports every occurrence', () => {
    expect(findTypographyViolations(`a ${EM_DASH} b ${EM_DASH} c`)).toHaveLength(2)
  })

  it('reports each at its own column', () => {
    expect(
      findTypographyViolations(`a ${EM_DASH} b ${EM_DASH} c`).map((violation) => violation.column),
    ).toEqual([3, 7])
  })

  // `indexOf` counts UTF-16 units, so a column after an astral character named a position the editor
  // does not have.
  it('counts a column in characters rather than in code units', () => {
    expect(findTypographyViolations(`\u{1F600} ${EM_DASH}`)[0]?.column).toBe(3)
  })
})
