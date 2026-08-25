import { describe, expect, it } from 'vitest'
import { renderGitleaksConfig, type SecretException } from '../src/secret-policy.js'

const exception = (overrides: Partial<SecretException> = {}): SecretException => ({
  path: 'tests/fixtures/stripe-webhook.json',
  reason: 'fake Stripe test key; the checkout fixture asserts on its shape',
  ...overrides,
})

// What the scanner ends up holding, which is what these rules are actually about. The rendered document
// is TOML, so a backslash reaches the tool halved; asserting on the raw text instead would pin the
// escaping rather than the pattern, and would pass just as happily on a document TOML cannot parse.
const decodedPath = (rendered: string): string =>
  (/^paths = \["(.*)"\]$/m.exec(rendered)?.[1] ?? '')
    .replaceAll(String.raw`\"`, '"')
    .replaceAll('\\\\', '\\')

describe('renderGitleaksConfig', () => {
  // The load-bearing property: a declared entry may add a named exception and may never replace the
  // scanner's own rules. Without this line the allowlist would become a way to disable the scan.
  it('always extends the scanner default rules', () => {
    expect(renderGitleaksConfig([])).toContain('useDefault = true')
  })

  it('extends them even when the project declares exceptions', () => {
    expect(renderGitleaksConfig([exception()])).toContain('useDefault = true')
  })

  it('renders one allowlist per declared exception', () => {
    const rendered: string = renderGitleaksConfig([
      exception(),
      exception({ path: 'tests/other.json' }),
    ])
    expect(rendered.match(/\[\[allowlists\]\]/g)).toHaveLength(2)
  })

  it('carries the reason into the description, so the config explains itself', () => {
    expect(renderGitleaksConfig([exception()])).toContain('fake Stripe test key')
  })

  it('anchors the path, so an exception cannot excuse a longer path that merely starts the same', () => {
    const rendered: string = renderGitleaksConfig([exception({ path: 'tests/a.json' })])
    expect(decodedPath(rendered)).toBe(String.raw`^tests/a\.json$`)
  })

  it('escapes a regex metacharacter in the path rather than honouring it', () => {
    const rendered: string = renderGitleaksConfig([exception({ path: 'tests/a.b.json' })])
    expect(decodedPath(rendered)).toContain(String.raw`a\.b\.json`)
  })

  it('escapes a quotation mark in the reason rather than breaking the document', () => {
    const rendered: string = renderGitleaksConfig([exception({ reason: 'the "fake" key' })])
    expect(rendered).toContain(String.raw`\"fake\"`)
  })

  // A multi-line literal string escapes nothing, so a path carrying its delimiter used to close the
  // string early and leave the rest of the entry as syntax.
  it('renders a path containing the literal-string delimiter without breaking the document', () => {
    const rendered: string = renderGitleaksConfig([exception({ path: "tests/a'''b.json" })])
    expect(decodedPath(rendered)).toBe(String.raw`^tests/a'''b\.json$`)
  })

  // A reason is prose a project writes, and prose arrives with newlines in it. A basic TOML string may
  // not carry one literally, so the document the scanner reads would not parse at all.
  it('escapes a newline in the reason rather than rendering a document TOML cannot parse', () => {
    const rendered: string = renderGitleaksConfig([exception({ reason: 'first\nsecond' })])
    expect(rendered).toContain(String.raw`first\nsecond`)
    expect(
      rendered.split('\n').filter((line: string) => line.startsWith('description')),
    ).toHaveLength(1)
  })

  it('renders a valid config when the project declares nothing', () => {
    expect(renderGitleaksConfig([])).not.toContain('[[allowlists]]')
  })
})

// A reason is prose a project writes, so it arrives carrying whatever prose carries - and a basic TOML
// string may hold none of it literally. A document the scanner cannot parse would be reported as the
// gate failing rather than as the entry that caused it.
describe('renderGitleaksConfig escaping', () => {
  // The unicode-escape branch: a control character the document has no named escape for.
  it('escapes a control character with a unicode escape', () => {
    const Bell: number = 0x07
    const rendered: string = renderGitleaksConfig([
      exception({ reason: `first${String.fromCodePoint(Bell)}second` }),
    ])
    expect(rendered).toContain(String.raw`first\u0007second`)
  })

  // The named-escape branch, for each escape the renderer knows.
  it.each([
    ['\n', String.raw`\n`],
    ['\r', String.raw`\r`],
    ['\t', String.raw`\t`],
  ])('escapes %j as its named form', (character: string, escaped: string) => {
    const rendered: string = renderGitleaksConfig([
      exception({ reason: `first${character}second` }),
    ])
    expect(rendered).toContain(`first${escaped}second`)
  })

  it('escapes a backslash in the reason', () => {
    expect(renderGitleaksConfig([exception({ reason: String.raw`a\b` })])).toContain(
      String.raw`a\\b`,
    )
  })
})
