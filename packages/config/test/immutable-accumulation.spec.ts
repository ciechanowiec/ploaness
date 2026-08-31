// The spellings a governed project has for a list built by a sequential scan.
//
// A scan is the shape where each entry decides what it becomes from what the previous ones did:
// first-fit packing, run-length grouping, a fold that carries more than a number. There are four ways
// to write one:
//
//   - `collected.push(one)`, reported by `functional/immutable-data`;
//   - the mutable binding a `for` loop needs, reported by `functional/no-let`;
//   - `[...accumulator, one]` inside a `reduce`, which is what those two leave;
//   - `accumulator.concat([one])`, which is permitted.
//
// Biome's `noAccumulatingSpread` closed the third, and the set was then empty of anything a reader
// would call obvious: what survived was recursion, which trades the copying that rule objects to for a
// hard stack-depth limit. A performance rule was being answered with a correctness cliff, and
// `unicorn/no-array-reduce` is off in this same config precisely because `reduce` is the idiom the
// immutability rules leave.
//
// THE FOURTH DOOR USED TO BE SHUT, and this spec asserted it. `unicorn/prefer-spread` does not merely
// permit the spread form over `concat`, it mandates it, which made the fold the ONLY obvious spelling
// rather than the best of two. That rule is now off, so `concat` is legal again and the fold is a
// preference. The reason is in `eslint-core.ts` beside the rule and is not about accumulation at all:
// the same rule mandates `[...text]` over `Array.from(text)` for a STRING, which
// `@typescript-eslint/no-misused-spread` bans - and because `prefer-spread` autofixes, a single
// `eslint --fix` rewrote a file into a violation it then reported. A style guarantee was traded for a
// correctness one, and this file records the loss rather than hiding it.
//
// What still holds is asserted below, and the last describe pins the trade so it cannot be quietly
// undone: turning `prefer-spread` back on would restore the mandate AND the fixer contradiction with
// it, so the two are asserted together.

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ESLint, type Linter } from 'eslint'
import { describe, expect, it } from 'vitest'
import payloadConfig from '../dist/eslint.js'
import libraryConfig from '../dist/eslint-library.js'

const PREFER_SPREAD: string = 'unicorn/prefer-spread'
const NO_MISUSED_SPREAD: string = '@typescript-eslint/no-misused-spread'
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

// Read through `calculateConfigForFile` rather than from the blocks, because a rule can arrive from a
// preset rather than from a table this package writes - `no-misused-spread` comes in with
// `strictTypeChecked`. A source read would find it absent and conclude it was off, which is the
// opposite of the truth.
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

describe('the two spellings a scan does not have', () => {
  it('cannot reach for a mutable binding', async () => {
    expect(await onInEveryConfig(NO_LET)).toStrictEqual(everyConfig(true))
  })

  it('cannot reach for a mutating method', async () => {
    expect(await onInEveryConfig(IMMUTABLE_DATA)).toStrictEqual(everyConfig(true))
  })
})

describe('the fold it is left with', () => {
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

// The two rules meet on one expression - `Array.from(text)` where `text` is a string - and only one of
// them can be right about it. Asserted as a pair rather than one at a time, because either alone reads
// as an ordinary rule setting somebody could flip back on a tidying pass, and flipping the first one
// back does not merely restore a style mandate: it restores a fixer that rewrites a source file into a
// violation of the same run.
describe('the two spread rules, which cannot both decide the string case', () => {
  it('leaves the untyped mandate off, because its fixer writes what the typed rule rejects', async () => {
    expect(await onInEveryConfig(PREFER_SPREAD)).toStrictEqual(everyConfig(false))
  })

  it('keeps the type-aware ban on, because it is the one making a correctness claim', async () => {
    expect(await onInEveryConfig(NO_MISUSED_SPREAD)).toStrictEqual(everyConfig(true))
  })
})
