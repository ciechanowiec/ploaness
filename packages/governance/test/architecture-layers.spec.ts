import { describe, expect, it } from 'vitest'
import { pureLogicRule } from '../src/architecture-layers.js'

const ruleFor = (roots: readonly string[]): Record<string, unknown> | undefined =>
  pureLogicRule(roots)

// The rule is rendered as opaque analyzer data, so a spec reads it back by asserting the shape it
// declares. Asserting is what a spec may do that production code may not.
const clauseValue = (
  rule: Record<string, unknown> | undefined,
  side: 'from' | 'to',
  key: string,
): string => {
  const clause: Record<string, string | undefined> = (rule?.[side] ?? {}) as Record<
    string,
    string | undefined
  >
  return clause[key] ?? ''
}

const pathOf = (rule: Record<string, unknown> | undefined, side: 'from' | 'to'): string =>
  clauseValue(rule, side, 'path')

const pathNotOf = (rule: Record<string, unknown> | undefined): string =>
  clauseValue(rule, 'to', 'pathNot')

describe('pureLogicRule', () => {
  it('keeps the shipped Payload floor when a project declares nothing extra', () => {
    expect(pathOf(ruleFor(['src/access', 'src/lib']), 'from')).toBe('^(src/access/|src/lib/)')
  })

  it('admits a directory the project declares as pure logic', () => {
    // The case a governed project could not express: its own configuration layer is pure logic, and
    // the analyzer's config file is one it may not own.
    expect(pathOf(ruleFor(['src/lib', 'src/config']), 'from')).toBe('^(src/lib/|src/config/)')
  })

  it('lets the floor depend on itself', () => {
    expect(pathNotOf(ruleFor(['src/lib']))).toContain('src/lib/')
  })

  it('lets the floor depend on generated types, which carry no behaviour', () => {
    expect(pathNotOf(ruleFor(['src/lib']))).toContain('payload-types')
  })

  it('still forbids reaching anything else under the source root', () => {
    expect(pathOf(ruleFor(['src/lib']), 'to')).toBe('^src/')
  })

  it('renders no rule for a project with no declared floor', () => {
    expect(ruleFor([])).toBeUndefined()
  })

  // A root is spliced into a regular expression, so what it renders to has to be a legal one whatever
  // the project wrote. It was not: a glob-shaped root took the analyzer down with no finding attached,
  // and a route-group directory silently matched a different path than the one declared.
  it('renders a valid expression for every root a project could declare', () => {
    for (const root of [
      'src/config',
      'src/config/**',
      'src/app/(payload)',
      'src/a+b',
      'src/x[1]',
    ]) {
      expect(() => new RegExp(pathOf(ruleFor([root]), 'from'))).not.toThrow()
    }
  })

  it('matches a route-group directory literally rather than as a capture group', () => {
    const matcher: RegExp = new RegExp(pathOf(ruleFor(['src/app/(payload)']), 'from'))
    expect(matcher.test('src/app/(payload)/admin/page.tsx')).toBe(true)
    // Without escaping the parentheses this was the path that matched, and the declared one that did not.
    expect(matcher.test('src/app/payload/admin/page.tsx')).toBe(false)
  })
})
