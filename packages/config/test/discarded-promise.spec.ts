// The one spelling a governed project has for a promise it deliberately does not await.
//
// `@typescript-eslint/no-floating-promises` accepts four, and in the shape that most often needs one -
// an async function handed to a SYNCHRONOUS Node callback, which is every `net`/`http` connection
// listener, every `process.on`, every `setInterval` - three of them are unavailable:
//
//   - `await`, impossible in a callback that is not async;
//   - `.catch(fn)`, reported by `unicorn/prefer-await`, which arrives on by preset;
//   - `.then(undefined, fn)`, reported by the same rule;
//   - `void promise()`, which the first rule NAMES in its own error text as the marker to use.
//
// Biome's `noVoid` banned the fourth, so the set was empty and `ploaness format` walked a project into
// it: ESLint's autofix inserts `void`, and the Biome pass immediately after rejected what it had just
// written. That is the `unicorn/prefer-export-from` shape `eslint-library.ts` already documents - two
// rules this harness owns, contradicting each other, with the formatter casting the deciding vote.
//
// Four properties are asserted, and only the four together mean anything. The exemption is load-bearing
// only while the rule that MANDATES the marker is on and the rules that close the other three doors are
// on; it is an exemption rather than a relaxation only while `void` stays banned as an expression; and
// it holds at all only while the other tool stays out of it. Any one of those read alone would pass
// through the state this file exists to prevent.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ESLint, Linter } from 'eslint'
import { describe, expect, it } from 'vitest'
import payloadConfig from '../dist/eslint.js'
import libraryConfig from '../dist/eslint-library.js'

const NO_VOID: string = 'no-void'
const FLOATING: string = '@typescript-eslint/no-floating-promises'
const PREFER_AWAIT: string = 'unicorn/prefer-await'
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

// Read through `calculateConfigForFile` rather than from the blocks, because two of these rules arrive
// from a preset rather than from a table this package writes. A source read would find them absent and
// conclude they were off, which is the opposite of the truth.
const resolveRules = async (
  config: readonly Linter.Config[],
): Promise<Readonly<Record<string, unknown>>> => {
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
        async ([name, config]: [string, readonly Linter.Config[]]): Promise<
          readonly [string, boolean]
        > => {
          const rules: Readonly<Record<string, unknown>> = await resolveRules(config)
          return [name, isOn(rules[rule])]
        },
      ),
    ),
  )

const everyConfig = <Value>(value: Value): Readonly<Record<string, Value>> =>
  Object.fromEntries(
    Object.keys(shippedConfigs).map((name: string): readonly [string, Value] => [name, value]),
  )

// What one snippet reports under the SHIPPED setting, keyed by config. The setting is read back out of
// each config rather than written here, because a literal repeated in a spec asserts only that it equals
// itself; fed to the linter, it asserts what a consumer's own file will be told.
const voidFindingsInEveryConfig = async (
  code: string,
): Promise<Readonly<Record<string, readonly string[]>>> =>
  Object.fromEntries(
    await Promise.all(
      Object.entries(shippedConfigs).map(
        async ([name, config]: [string, readonly Linter.Config[]]): Promise<
          readonly [string, readonly string[]]
        > => {
          const rules: Readonly<Record<string, unknown>> = await resolveRules(config)
          const setting: unknown = rules[NO_VOID]
          if (!Array.isArray(setting)) {
            throw new TypeError(`${NO_VOID} is unset in the ${name} config`)
          }
          const linter: Linter = new Linter()
          const messages: readonly Linter.LintMessage[] = linter.verify(code, {
            rules: { [NO_VOID]: setting as Linter.RuleEntry },
          })
          return [name, messages.map((message: Linter.LintMessage): string => message.ruleId ?? '')]
        },
      ),
    ),
  )

// Searched for the KEY wherever it sits rather than at a path in the schema, so moving the rule between
// Biome's groups cannot make this spec quietly stop looking. A ban re-added anywhere fails it.
const containsVoidBan = (value: unknown): boolean => {
  if (Array.isArray(value)) {
    return value.some((entry: unknown): boolean => containsVoidBan(entry))
  }
  if (!isRecord(value)) {
    return false
  }
  return Object.entries(value).some(([key, nested]: [string, unknown]): boolean =>
    key === 'noVoid' ? isOn(nested) : containsVoidBan(nested),
  )
}

describe('a promise a synchronous callback cannot await', () => {
  // Without this the carve-out is a hole rather than a resolution: if nothing required a marker, `void`
  // would simply be permitted, which is the relaxation this is deliberately not.
  it('is still REQUIRED to carry a marker, in every shipped config', async () => {
    expect(await onInEveryConfig(FLOATING)).toStrictEqual(everyConfig(true))
  })

  // And the three doors that stay shut are what makes it the ONLY marker. Were this rule off,
  // `.catch()` would be legal again and the exemption below would be a convenience.
  it('has its other three spellings closed by the rule that closed them', async () => {
    expect(await onInEveryConfig(PREFER_AWAIT)).toStrictEqual(everyConfig(true))
  })

  it('is banned by ESLint rather than by nobody, once Biome stopped banning it', async () => {
    expect(await onInEveryConfig(NO_VOID)).toStrictEqual(everyConfig(true))
  })
})

describe('the shape of the exemption, which is a position rather than a rule', () => {
  // The behaviour the option name only claims. Asserted by linting rather than by reading the setting,
  // because what matters is which POSITION is admitted, and no amount of reading the options says that.
  it('admits the marker where a discarded promise stands alone', async () => {
    expect(await voidFindingsInEveryConfig('void Promise.resolve()')).toStrictEqual(everyConfig([]))
  })

  it('keeps it banned where it is an expression, which is the obfuscation both tools meant', async () => {
    const reported: Readonly<Record<string, readonly string[]>> = everyConfig([NO_VOID])
    expect(await voidFindingsInEveryConfig('const nothing = void 0')).toStrictEqual(reported)
    expect(await voidFindingsInEveryConfig('const value = void compute()')).toStrictEqual(reported)
  })
})

describe('the formatter that runs beside the linter', () => {
  // The cross-tool joint, and the only assertion here that could catch the contradiction coming back.
  // Biome cannot see the ESLint config and ESLint cannot see Biome's, so nothing but a spec spanning
  // both can notice that one tool has re-banned what the other now requires.
  it('does not re-ban the marker anywhere in the shared Biome configuration', () => {
    const shared: unknown = JSON.parse(
      readFileSync(path.join(packageRoot, 'biome-core.json'), 'utf8'),
    )
    expect(containsVoidBan(shared)).toBe(false)
  })
})
