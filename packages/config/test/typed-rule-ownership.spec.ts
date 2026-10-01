// Resolve the shipped rules, then exercise their shared ownership against real TypeScript files.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ESLint, Linter } from 'eslint'
import sonarjs from 'eslint-plugin-sonarjs'
import unicorn from 'eslint-plugin-unicorn'
import ts from 'typescript'
import tseslint from 'typescript-eslint'
import { describe, expect, it } from 'vitest'
import payloadConfig from '../dist/eslint.js'
import libraryConfig from '../dist/eslint-library.js'

const packageRoot: string = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const configurations: Readonly<Record<string, readonly Linter.Config[]>> = {
  payload: payloadConfig,
  library: libraryConfig,
}
const IGNORED_RETURN: string = 'sonarjs/no-ignored-return'
const DUPLICATE_RETURN: string = 'unicorn/no-unused-builtin-method-return'
const ENUM_ASSIGNMENT: string = '@typescript-eslint/no-unsafe-enum-assignment'

const rulesFor = async (config: readonly Linter.Config[]): Promise<Partial<Linter.RulesRecord>> => {
  const eslint: ESLint = new ESLint({
    overrideConfigFile: true,
    baseConfig: [...config],
    cwd: packageRoot,
  })
  const resolved: unknown = await eslint.calculateConfigForFile('src/lib/example.ts')
  const rules: Partial<Linter.RulesRecord> | undefined = (resolved as Linter.Config | undefined)
    ?.rules
  if (rules === undefined) {
    throw new TypeError('The shipped source configuration resolved to no rules')
  }
  return Object.fromEntries(
    [IGNORED_RETURN, DUPLICATE_RETURN, ENUM_ASSIGNMENT].map(
      (rule: string): readonly [string, Linter.RuleEntry] => [rule, rules[rule] ?? 'off'],
    ),
  )
}

const configurationsWithRules: readonly (readonly [string, Partial<Linter.RulesRecord>])[] =
  await Promise.all(
    Object.entries(configurations).map(
      async ([name, config]: [string, readonly Linter.Config[]]): Promise<
        readonly [string, Partial<Linter.RulesRecord>]
      > => [name, await rulesFor(config)],
    ),
  )

const messagesFor = (code: string, rules: Partial<Linter.RulesRecord>): readonly string[] => {
  const directory: string = mkdtempSync(path.join(tmpdir(), 'ploaness-typed-ownership-'))
  const file: string = path.join(directory, 'example.ts')
  try {
    writeFileSync(file, code)
    const program: ts.Program = ts.createProgram([file], {
      noEmit: true,
      target: ts.ScriptTarget.ES2022,
      strict: true,
      types: [],
    })
    return new Linter({ cwd: directory })
      .verify(
        code,
        {
          files: ['**/*.ts'],
          languageOptions: { parser: tseslint.parser, parserOptions: { programs: [program] } },
          plugins: { sonarjs, unicorn, '@typescript-eslint': tseslint.plugin },
          rules,
        },
        { filename: file },
      )
      .map((message: Linter.LintMessage): string => message.ruleId ?? message.message)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

const ARRAY: string = 'const values: number[] = [1]; '
const ENUMS: string = 'enum First { Value = 1 } enum Second { Value = 1 } '

describe.each(configurationsWithRules)(
  '%s typed rule ownership',
  (_name: string, rules: Partial<Linter.RulesRecord>) => {
    it('reports a discarded array result exactly once through its existing owner', () => {
      expect(messagesFor(`${ARRAY}values.slice(0);`, rules)).toEqual([IGNORED_RETURN])
    })

    it('accepts a used array result', () => {
      expect(messagesFor(`${ARRAY}export const result = values.slice(0);`, rules)).toEqual([])
    })

    it('rejects an assignment between distinct enum domains', () => {
      expect(messagesFor(`${ENUMS}const result: First = Second.Value;`, rules)).toEqual([
        ENUM_ASSIGNMENT,
      ])
    })

    it('accepts an assignment from the declared enum domain', () => {
      expect(messagesFor(`${ENUMS}const result: First = First.Value;`, rules)).toEqual([])
    })
  },
)
