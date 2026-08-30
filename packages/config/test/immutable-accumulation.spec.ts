// The spellings a governed project has for a list built by a sequential scan.
//
// A scan is the shape where each entry decides what it becomes from what the previous ones did:
// first-fit packing, run-length grouping, a fold that carries more than a number. There are four ways
// to write one, and this harness closed three of them on purpose:
//
//   - `accumulator.concat([one])`, reported by `unicorn/prefer-spread`, which does not merely permit
//     the spread form but MANDATES it over `concat`;
//   - `collected.push(one)`, reported by `functional/immutable-data`;
//   - the mutable binding a `for` loop needs, reported by `functional/no-let`;
//   - `[...accumulator, one]` inside a `reduce`, which is what the other three leave.
//
// Biome's `noAccumulatingSpread` closed the fourth, and the set was then empty of anything a reader
// would call obvious: what survived was recursion, which trades the copying that rule objects to for a
// hard stack-depth limit. A performance rule was being answered with a correctness cliff, and
// `unicorn/no-array-reduce` is off in this same config precisely because `reduce` is the idiom the
// immutability rules leave.
//
// Four properties, and only the four together mean anything. The fourth door is open only while the
// three that make it the only one are shut - were `prefer-spread` off, `concat` would be legal again
// and this would be a convenience rather than a resolution - and it is open at all only while the
// other tool stays out of it. Any one of these read alone would pass through the state this file
// exists to prevent.

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ESLint, type Linter } from 'eslint'
import { describe, expect, it } from 'vitest'
import payloadConfig from '../dist/eslint.js'
import libraryConfig from '../dist/eslint-library.js'

const PREFER_SPREAD: string = 'unicorn/prefer-spread'
const NO_LET: string = 'functional/no-let'
const IMMUTABLE_DATA: string = 'functional/immutable-data'
const NO_ARRAY_REDUCE: string = 'unicorn/no-array-reduce'
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

// Read through `calculateConfigForFile` rather than from the blocks, because `prefer-spread` arrives
// from the unicorn preset rather than from a table this package writes. A source read would find it
// absent and conclude it was off, which is the opposite of the truth.
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

// Searched for the KEY wherever it sits rather than at a path in the schema, so moving the rule between
// Biome's groups cannot make this spec quietly stop looking. A ban re-added anywhere fails it.
const containsAccumulatingSpreadBan = (value: unknown): boolean => {
  if (Array.isArray(value)) {
    return value.some((entry: unknown): boolean => containsAccumulatingSpreadBan(entry))
  }
  if (!isRecord(value)) {
    return false
  }
  return Object.entries(value).some(([key, nested]: [string, unknown]): boolean =>
    key === 'noAccumulatingSpread' ? isOn(nested) : containsAccumulatingSpreadBan(nested),
  )
}

describe('the three spellings a scan does not have', () => {
  // Without this the carve-out is a relaxation rather than a resolution: were `prefer-spread` off,
  // `concat` would be legal and the spread form would be one choice among two rather than the only one.
  it('cannot reach for concat, because the spread is mandated over it', async () => {
    expect(await onInEveryConfig(PREFER_SPREAD)).toStrictEqual(everyConfig(true))
  })

  it('cannot reach for a mutable binding', async () => {
    expect(await onInEveryConfig(NO_LET)).toStrictEqual(everyConfig(true))
  })

  it('cannot reach for a mutating method', async () => {
    expect(await onInEveryConfig(IMMUTABLE_DATA)).toStrictEqual(everyConfig(true))
  })
})

describe('the one spelling it does have', () => {
  // The cross-tool joint, and the only assertion here that could catch the contradiction coming back.
  // Biome cannot see the ESLint config and ESLint cannot see Biome's, so nothing but a spec spanning
  // both can notice that one tool has re-banned what the others leave as the only way through.
  it('is not re-banned anywhere in the shared Biome configuration', () => {
    const shared: unknown = JSON.parse(
      readFileSync(path.join(packageRoot, 'biome-core.json'), 'utf8'),
    )
    expect(containsAccumulatingSpreadBan(shared)).toBe(false)
  })

  // And the fold itself has to stay permitted, or the spelling left open is one nothing may use.
  it('is a fold, which this config deliberately does not discourage', async () => {
    expect(await onInEveryConfig(NO_ARRAY_REDUCE)).toStrictEqual(everyConfig(false))
  })
})
