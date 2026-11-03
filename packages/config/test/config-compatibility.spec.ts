import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ESLint, Linter } from 'eslint'
import unicorn from 'eslint-plugin-unicorn'
import tseslint from 'typescript-eslint'
import { describe, expect, it } from 'vitest'
import appConfig from '../dist/eslint.js'
import libraryConfig from '../dist/eslint-library.js'

const packageRoot: string = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const configurations: Readonly<Record<string, readonly Linter.Config[]>> = {
  application: appConfig,
  library: libraryConfig,
}
const DEFAULT_RULE: string = 'unicorn/prefer-default-parameters'
const SIDE_EFFECT_RULE: string = 'unicorn/no-top-level-side-effects'

const messagesFor = async (
  source: string,
  rule: string,
  config: string,
  filePath: string,
): Promise<readonly Linter.LintMessage[]> => {
  const eslint: ESLint = new ESLint({
    overrideConfigFile: true,
    baseConfig: [...(configurations[config] ?? [])],
    cwd: packageRoot,
  })
  const resolved: unknown = await eslint.calculateConfigForFile(filePath)
  const rules: Partial<Linter.RulesRecord> | undefined = (resolved as Linter.Config | undefined)?.rules
  if (rules === undefined) {
    throw new TypeError('The shipped configuration resolved to no rules')
  }
  return new Linter().verify(source, {
    languageOptions: { parser: tseslint.parser, ecmaVersion: 'latest' },
    plugins: { unicorn },
    rules: { [rule]: rules[rule] ?? 'off' },
  })
}

describe('nullish input normalization', () => {
  it.each(Object.keys(configurations))('preserves null handling in %s modules', async (config: string) => {
    const source: string = 'export const normalize = (value: string | null | undefined): string => value ?? "";'
    expect(await messagesFor(source, DEFAULT_RULE, config, 'src/lib/example.ts')).toEqual([])
  })
})

// The rule reports writes to shared global state, not calls it cannot see into, so Payload's eagerly
// built configuration needs no exemption and its entry module is held to the same write rule.
describe('module evaluation side effects', () => {
  const placements: readonly (readonly [string, string])[] = [
    ['application', 'src/payload.config.ts'],
    ['application', 'src/lib/example.ts'],
    ['library', 'src/payload.config.ts'],
  ]
  const factory: string = 'import { buildConfig } from "payload"; export default buildConfig({ collections: [] });'
  const globalWrite: string = 'globalThis.payloadReady = true; export const ready = true;'

  it.each(placements)('accepts a configuration factory in %s %s', async (config: string, filePath: string) => {
    expect(await messagesFor(factory, SIDE_EFFECT_RULE, config, filePath)).toEqual([])
  })

  it.each(placements)('rejects a global write in %s %s', async (config: string, filePath: string) => {
    expect(await messagesFor(globalWrite, SIDE_EFFECT_RULE, config, filePath)).toEqual([
      expect.objectContaining({ ruleId: SIDE_EFFECT_RULE, severity: 2 }),
    ])
  })
})
