import { describe, expect, it } from 'vitest'
import { selectProjects } from '../src/workspace-policy.js'

const DIRECTORIES: readonly string[] = ['.', 'apps/cms', 'packages/ui', 'packages/shared', 'packages/.hidden']
const PUBLIC_PACKAGES: readonly string[] = ['.', 'packages/ui', 'packages/shared']

describe('workspace glob selection', () => {
  it.each([
    'packages/{ui,shared}',
    './packages/*',
    'packages/*/',
    'packages//*',
    'packages/../packages/*',
    '{packages/ui/../shared,packages/ui}',
  ])('selects the same public packages for %s', (pattern: string) => {
    expect(selectProjects([pattern], DIRECTORIES)).toEqual(PUBLIC_PACKAGES)
  })

  it('applies brace exclusions independently of declaration order', () => {
    expect(selectProjects(['!packages/{ui,shared}', 'packages/*'], DIRECTORIES)).toEqual(['.'])
  })

  it('does not select hidden package names through a wildcard', () => {
    expect(selectProjects(['packages/*'], DIRECTORIES)).toEqual(PUBLIC_PACKAGES)
  })

  it('selects an explicitly named hidden package', () => {
    expect(selectProjects(['packages/.hidden'], DIRECTORIES)).toEqual(['.', 'packages/.hidden'])
  })

  it('selects an explicitly dotted directory through a trailing globstar', () => {
    expect(selectProjects(['packages/.*/**'], DIRECTORIES)).toEqual(['.', 'packages/.hidden'])
  })

  it('allows a valid pattern with no current matches', () => {
    expect(selectProjects(['future/*'], DIRECTORIES)).toEqual(['.'])
  })

  it.each([
    { pattern: 'packages/?', expected: ['.', 'packages/𠮷'] },
    { pattern: 'packages/??', expected: ['.', 'packages/ui'] },
  ])('counts Unicode code points for $pattern', ({ pattern, expected }) => {
    expect(selectProjects([pattern], ['.', 'packages/𠮷', 'packages/ui'])).toEqual(expected)
  })

  it.each([
    'packages/{ui,shared',
    'packages/[ui',
    'packages/[ui]',
    'packages/[!u]*',
    'packages/[^u]*',
    'packages/@(ui|shared)',
    'packages/(ui|shared)',
    'packages/ui|shared',
    'packages/ui$',
    'packages/"ui"',
    String.raw`packages/\ui`,
    'packages/**/**',
    'packages/**//**',
    'packages/{1..3}',
    'packages/{ui}',
    'packages/{{ui,shared}}',
    'packages/{ui,{shared}}',
    'packages/{,ui}',
    'packages/{ui,}',
  ])('refuses unsupported or malformed syntax before selecting anything: %s', (pattern: string) => {
    expect(() => selectProjects([pattern], ['.'])).toThrow('pnpm-workspace.yaml packages')
  })
})
