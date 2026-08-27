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
})
