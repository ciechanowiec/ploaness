import { describe, expect, it } from 'vitest'
import { matchesGlob } from '../src/file-roles.js'
import {
  JSX_ACCESSIBILITY_RULES,
  oxlintAccessibilityConfig,
  replacedBiomeAccessibilityRules,
} from '../src/jsx-accessibility.js'
import {
  isOxlintConfig,
  jsxAccessibilityFiles,
  jsxAnalysisPatterns,
} from '../src/jsx-accessibility-scope.js'

describe('one owner for application JSX accessibility', () => {
  it('maps every native check to exactly one delegated Biome rule', () => {
    const native: unknown = oxlintAccessibilityConfig()['rules']
    expect(Object.keys(native as Record<string, unknown>)).toHaveLength(31)
    expect(Object.keys(replacedBiomeAccessibilityRules())).toHaveLength(31)
    expect(new Set(JSX_ACCESSIBILITY_RULES.map((rule) => rule.oxlint)).size).toBe(31)
    expect(new Set(JSX_ACCESSIBILITY_RULES.map((rule) => rule.biome)).size).toBe(31)
  })

  it('retains grid-cell semantics while rejecting redundant native button roles', () => {
    const rules: Record<string, unknown> = oxlintAccessibilityConfig()['rules'] as Record<
      string,
      unknown
    >
    expect(rules['jsx-a11y/no-redundant-roles']).toEqual(['error', { td: ['gridcell'] }])
    expect(rules['jsx-a11y/alt-text']).toBe('error')
    expect(replacedBiomeAccessibilityRules()['useAltText']).toBe('off')
  })

  it('selects new JSX source, including files outside the conventional src directory', () => {
    expect(
      jsxAccessibilityFiles(
        ['src/New.tsx', 'widgets/Card.jsx', 'src/logic.ts', 'src/New.tsx'],
        [],
        [],
      ),
    ).toEqual(['src/New.tsx', 'widgets/Card.jsx'])
  })

  it('excludes generated code, caches, hidden tooling, and sibling members', () => {
    const files: readonly string[] = [
      '.next/types/View.tsx',
      'node_modules/pkg/View.tsx',
      'coverage/View.tsx',
      'pgadmin/View.tsx',
      '.storybook/Preview.tsx',
      'src/generated/View.tsx',
      'cms/src/Card.tsx',
      'fe/src/Card.tsx',
      'src/Own.tsx',
    ]
    expect(jsxAccessibilityFiles(files, ['src/generated/**'], ['cms', 'fe'])).toEqual([
      'src/Own.tsx',
    ])
  })

  it('leaves HTML and non-JSX source with their existing analyzer', () => {
    const patterns: readonly string[] = jsxAnalysisPatterns()
    const includes: readonly string[] = patterns.filter((pattern) => !pattern.startsWith('!'))
    expect(includes.some((pattern) => matchesGlob(pattern, 'page.html'))).toBe(false)
    expect(includes.some((pattern) => matchesGlob(pattern, 'source.ts'))).toBe(false)
    expect(includes.some((pattern) => matchesGlob(pattern, 'src/Card.tsx'))).toBe(true)
    expect(patterns).toContain('!.*/**')
  })

  it.each([
    '.oxlintrc.json',
    'src/.oxlintrc.jsonc',
    '.oxlintignore',
    'cms/oxlint.config.ts',
    'deep/oxlint.config.mjs',
  ])('refuses consumer analyzer configuration at %s', (file) => {
    expect(isOxlintConfig(file)).toBe(true)
  })

  it.each(['src/oxlint-policy.ts', 'docs/oxlint.md', 'oxlint.json'])(
    'permits ordinary source %s',
    (file) => {
      expect(isOxlintConfig(file)).toBe(false)
    },
  )
})
