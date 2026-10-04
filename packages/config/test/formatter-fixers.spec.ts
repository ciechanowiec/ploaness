// Two unicorn fixers whose output another gate rejects, held off in every shipped config.
//
// `ploaness format` runs Biome, then every ESLint fixer, then Biome again, and promises a tree the gates
// accept. `prefer-ternary` rewrote a guard clause into the `x ? true : y` form that
// `prefer-logical-operator-over-ternary` reports and cannot fix, and `no-useless-concat` joined a string
// split across two lines into one the line cap rejects. Both were the harness walking a project into a
// failure it had just written, which is the shape `dom-fixers.spec.ts` records for the DOM fixers.
//
// The contradiction itself is shown here with the plugin's own rules rather than taken on trust, so a
// unicorn release that resolves it fails this spec and says the rule may come back.

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ESLint, Linter } from 'eslint'
import unicorn from 'eslint-plugin-unicorn'
import { describe, expect, it } from 'vitest'
import payloadConfig from '../dist/eslint.js'
import libraryConfig from '../dist/eslint-library.js'

const PREFER_TERNARY: string = 'unicorn/prefer-ternary'
const LOGICAL_OVER_TERNARY: string = 'unicorn/prefer-logical-operator-over-ternary'
const USELESS_CONCAT: string = 'unicorn/no-useless-concat'
const SOURCE_FILE: string = 'src/lib/example.ts'

const packageRoot: string = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

const shippedConfigs: Readonly<Record<string, readonly Linter.Config[]>> = {
  payload: payloadConfig,
  library: libraryConfig,
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null

const severityOf = (setting: unknown): unknown => (Array.isArray(setting) ? setting[0] : setting)

/** Both spellings of both live severities, because `calculateConfigForFile` normalises to the numbers. */
const ENABLED: ReadonlySet<unknown> = new Set(['error', 2, 'warn', 1])

const isOn = (setting: unknown): boolean => ENABLED.has(severityOf(setting))

const resolveRules = async (config: readonly Linter.Config[]): Promise<Readonly<Record<string, unknown>>> => {
  const eslint: ESLint = new ESLint({
    overrideConfigFile: true,
    baseConfig: [...config],
    cwd: packageRoot,
  })
  const resolved: unknown = await eslint.calculateConfigForFile(SOURCE_FILE)
  if (!(isRecord(resolved) && isRecord(resolved['rules']))) {
    throw new TypeError(`${SOURCE_FILE} resolved to no rules`)
  }
  return resolved['rules']
}

/** Whether one rule is on, keyed by config so a failure names which one drifted. */
const onInEveryConfig = async (rule: string): Promise<Readonly<Record<string, boolean>>> =>
  Object.fromEntries(
    await Promise.all(
      Object.entries(shippedConfigs).map(
        async ([name, config]: [string, readonly Linter.Config[]]): Promise<readonly [string, boolean]> => {
          const rules: Readonly<Record<string, unknown>> = await resolveRules(config)
          return [name, isOn(rules[rule])]
        },
      ),
    ),
  )

const everyConfig = <Value>(value: Value): Readonly<Record<string, Value>> =>
  Object.fromEntries(Object.keys(shippedConfigs).map((name: string): readonly [string, Value] => [name, value]))

// The condition is a comparison so that it is boolean without type information: the logical-operator
// rule only rewrites a ternary whose test is known to be boolean, which a consumer's typed lint supplies.
const GUARD_CLAUSE: string = [
  'export const decide = (user) => {',
  '  if (user.level > 2) {',
  '    return true',
  '  }',
  '  return user.isEditor || user.ownsDraft',
  '}',
  '',
].join('\n')

/** The guard clause after one fixing pass of the ternary rule, and what the logical rule then reports. */
const fixThenReport = (): { readonly fixed: string; readonly reported: readonly string[] } => {
  const linter: Linter = new Linter({ configType: 'flat' })
  const plugins: Linter.Config['plugins'] = { unicorn }
  const fixed: string = linter.verifyAndFix(GUARD_CLAUSE, [
    { plugins, rules: { [PREFER_TERNARY]: ['error', 'always'] } },
  ]).output
  const reported: readonly string[] = linter
    .verify(fixed, [{ plugins, rules: { [LOGICAL_OVER_TERNARY]: 'error' } }])
    .map((message: Linter.LintMessage): string => message.ruleId ?? '')
  return { fixed, reported }
}

describe('the ternary fixer, which writes what the logical-operator rule rejects', () => {
  it('still rewrites a guard clause into the form the other rule reports', () => {
    expect(fixThenReport().reported).toEqual([LOGICAL_OVER_TERNARY])
  })

  it('is off in every config', async () => {
    expect(await onInEveryConfig(PREFER_TERNARY)).toStrictEqual(everyConfig(false))
  })

  it('leaves the logical-operator rule on, so a hand-written `x ? true : y` is still reported', async () => {
    expect(await onInEveryConfig(LOGICAL_OVER_TERNARY)).toStrictEqual(everyConfig(true))
  })
})

describe('the concatenation fixer, which joins a split string past the line cap', () => {
  it('is off in every config', async () => {
    expect(await onInEveryConfig(USELESS_CONCAT)).toStrictEqual(everyConfig(false))
  })
})
