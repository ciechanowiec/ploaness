// Exercise additions to the shared preset through the rules each shipped configuration resolves.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ESLint, Linter } from 'eslint'
import unicorn from 'eslint-plugin-unicorn'
import tseslint from 'typescript-eslint'
import { describe, expect, it } from 'vitest'
import payloadConfig from '../dist/eslint.js'
import libraryConfig from '../dist/eslint-library.js'

interface Example {
  readonly rule: string
  readonly invalid: string
  readonly valid: string
}

const examples: readonly Example[] = [
  {
    rule: 'unicorn/no-async-iterator-callback',
    invalid: 'const result = Iterator.from([1]).filter(async value => value > 0);',
    valid: 'const result = Iterator.from([1]).filter(value => value > 0);',
  },
  {
    rule: 'unicorn/no-unused-iterator-helper',
    invalid: 'Iterator.from([1]).map(value => value);',
    valid: 'const result = Iterator.from([1]).map(value => value);',
  },
  {
    rule: 'unicorn/no-useless-set-construction',
    invalid: 'const result = new Set(new Set([1]).union(new Set([2])));',
    valid: 'const result = new Set([1]).union(new Set([2]));',
  },
  {
    rule: 'unicorn/no-using-resource-escape',
    invalid: 'function acquire() { using handle = open(); return handle; }',
    valid: 'function acquire() { using handle = open(); consume(handle); }',
  },
  {
    rule: 'unicorn/prefer-combined-guards',
    invalid:
      'function check(first, second) { if (first) { return; } if (second) { return; } consume(); }',
    valid: 'function check(first, second) { if (first || second) { return; } consume(); }',
  },
  {
    rule: 'unicorn/prefer-temporal-conversion',
    invalid:
      'const value = Temporal.PlainDateTime.from("2026-10-01T10:00"); const result = Temporal.PlainDate.from(value);',
    valid:
      'const value = Temporal.PlainDateTime.from("2026-10-01T10:00"); const result = value.toPlainDate();',
  },
]

const packageRoot: string = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const configurations: Readonly<Record<string, readonly Linter.Config[]>> = {
  payload: payloadConfig,
  library: libraryConfig,
}

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
  return rules
}

const rulesByConfig: Readonly<Record<string, Partial<Linter.RulesRecord>>> = Object.fromEntries(
  await Promise.all(
    Object.entries(configurations).map(
      async ([name, config]: [string, readonly Linter.Config[]]): Promise<
        readonly [string, Partial<Linter.RulesRecord>]
      > => [name, await rulesFor(config)],
    ),
  ),
)

const messagesFor = (
  code: string,
  rule: string,
  rules: Partial<Linter.RulesRecord>,
): readonly Linter.LintMessage[] =>
  new Linter().verify(code, {
    languageOptions: { parser: tseslint.parser, ecmaVersion: 'latest' },
    plugins: { unicorn },
    rules: { [rule]: rules[rule] ?? 'off' },
  })

for (const [name, rules] of Object.entries(rulesByConfig)) {
  describe(`${name} preset additions`, () => {
    it.each(examples)(
      'rejects the defect covered by $rule at error severity',
      (example: Example) => {
        expect(
          messagesFor(example.invalid, example.rule, rules).map(
            (message: Linter.LintMessage): readonly [string | null, number] => [
              message.ruleId,
              message.severity,
            ],
          ),
        ).toEqual([[example.rule, 2]])
      },
    )

    it.each(examples)('accepts valid code beside $rule', (example: Example) => {
      expect(messagesFor(example.valid, example.rule, rules)).toEqual([])
    })

    it.each(examples)('honors a narrow source suppression for $rule', (example: Example) => {
      const suppressed: string =
        '// eslint-disable-next-line ' +
        example.rule +
        ' -- Exercises the narrow source exception.\n' +
        example.invalid
      expect(messagesFor(suppressed, example.rule, rules)).toEqual([])
    })
  })
}

const ZIP_RULE: string = 'unicorn/prefer-iterator-zip'
const PARALLEL_ARRAYS: string =
  'const left = [1]; const right = [1]; ' +
  'for (let index = 0; index < Math.min(left.length, right.length); index++) ' +
  '{ consume(left[index], right[index]); }'

describe('parallel iteration on the supported platform', () => {
  it('establishes that the upstream rule requires the unavailable Iterator.zip method', () => {
    expect(
      messagesFor(PARALLEL_ARRAYS, ZIP_RULE, { [ZIP_RULE]: 'error' }).map(
        (message: Linter.LintMessage): string | null => message.ruleId,
      ),
    ).toEqual([ZIP_RULE])
  })

  it.each(Object.keys(configurations))('keeps parallel indexing legal in %s', (name: string) => {
    const rules: Partial<Linter.RulesRecord> = rulesByConfig[name] ?? {}
    expect(messagesFor(PARALLEL_ARRAYS, ZIP_RULE, rules)).toEqual([])
  })
})
