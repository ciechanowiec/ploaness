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

describe('Payload configuration evaluation', () => {
  const source: string = 'import { buildConfig } from "payload"; export default buildConfig({ collections: [] });'

  it('accepts the framework configuration factory in the application configuration entry', async () => {
    expect(await messagesFor(source, SIDE_EFFECT_RULE, 'application', 'src/payload.config.ts')).toEqual([])
  })

  it('keeps eager side effects forbidden in ordinary application modules', async () => {
    expect(await messagesFor(source, SIDE_EFFECT_RULE, 'application', 'src/lib/example.ts')).toEqual([
      expect.objectContaining({ ruleId: SIDE_EFFECT_RULE, severity: 2 }),
    ])
  })

  it('does not grant a Payload configuration exception to a library', async () => {
    expect(await messagesFor(source, SIDE_EFFECT_RULE, 'library', 'src/payload.config.ts')).toEqual([
      expect.objectContaining({ ruleId: SIDE_EFFECT_RULE, severity: 2 }),
    ])
  })
})
