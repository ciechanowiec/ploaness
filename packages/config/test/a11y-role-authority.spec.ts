import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  asRecord,
  isArray,
  JSX_ACCESSIBILITY_RULES,
  type JsxAccessibilityRule,
  jsxAnalysisPatterns,
} from '@ploaness/governance'
import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'
import payloadConfig from '../dist/eslint.js'

const configRoot: string = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const metaRoot: string = path.join(configRoot, '..', 'ploaness')
const json = (file: string): Record<string, unknown> =>
  asRecord(JSON.parse(readFileSync(file, 'utf8')))

// These are the artifacts consumers load, after the shared configs have been flattened by the build.
describe('accessibility ownership across the shipped configurations', () => {
  it('removes the legacy plugin from the effective application ESLint configuration', async () => {
    const eslint: ESLint = new ESLint({
      overrideConfigFile: true,
      baseConfig: [...payloadConfig],
      cwd: configRoot,
    })
    const resolved: unknown = await eslint.calculateConfigForFile('src/components/example.tsx')
    const rules: Record<string, unknown> = asRecord(asRecord(resolved)['rules'])
    expect(Object.keys(rules).some((rule: string): boolean => rule.startsWith('jsx-a11y/'))).toBe(
      false,
    )
  })

  it('delegates the native rule set only through the matching JSX override', () => {
    const appConfig: Record<string, unknown> = json(path.join(metaRoot, 'biome.json'))
    const overrides: unknown = appConfig['overrides']
    expect(isArray(overrides)).toBe(true)
    const override: Record<string, unknown> = asRecord(
      isArray(overrides) ? overrides[0] : undefined,
    )
    expect(override['includes']).toEqual(jsxAnalysisPatterns())
    const rules: Record<string, unknown> = asRecord(
      asRecord(asRecord(override['linter'])['rules'])['a11y'],
    )
    for (const rule of JSX_ACCESSIBILITY_RULES) {
      expect(rules[rule.biome]).toBe('off')
    }
  })

  it('preserves the core policy for library members and non-JSX formats', () => {
    const library: Record<string, unknown> = json(path.join(metaRoot, 'biome-core.json'))
    expect(library['overrides']).toBeUndefined()
    const appConfig: Record<string, unknown> = json(path.join(metaRoot, 'biome.json'))
    const broad: Record<string, unknown> = asRecord(
      asRecord(asRecord(appConfig['linter'])['rules'])['a11y'],
    )
    expect(
      JSX_ACCESSIBILITY_RULES.some(
        (rule: JsxAccessibilityRule): boolean => broad[rule.biome] === 'off',
      ),
    ).toBe(false)
  })
})
