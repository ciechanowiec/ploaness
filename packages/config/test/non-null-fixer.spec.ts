// The ESLint fixer that writes exactly what Biome forbids, held off in every shipped config.
//
// `@typescript-eslint/non-nullable-type-assertion-style` arrives from `stylisticTypeChecked` and
// rewrites `x as T` into `x!` wherever the cast only strips null or undefined. Biome refuses `!`
// outright: explicitly through `noNonNullAssertion` in `biome-core.json`, and again through
// `noNonNullAssertedOptionalChain` in the recommended preset it enables. The two meet inside one
// `ploaness format`, which runs Biome and then the ESLint fixers, so the fixer authors the character
// the next `verify` fails on, on a line nobody wrote. That is the shape `dom-fixers.spec.ts` and
// `immutable-accumulation.spec.ts` already record: a contradiction the harness walks a project into
// rather than one a person can step around.
//
// Read through `calculateConfigForFile` rather than from the source, for the reason `dom-fixers.spec.ts`
// states: the rule arrives from a preset rather than from a table this package writes, so a source read
// would find no entry and could not tell "off" from "never mentioned".

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ESLint, type Linter } from 'eslint'
import { describe, expect, it } from 'vitest'
import payloadConfig from '../dist/eslint.js'
import libraryConfig from '../dist/eslint-library.js'

const ASSERTION_STYLE: string = '@typescript-eslint/non-nullable-type-assertion-style'
// The ban itself, which this change does not touch: ESLint still refuses a written `!`, and Biome
// refuses it too. Turning the fixer off removes the only thing that PRODUCED one.
const NO_NON_NULL: string = '@typescript-eslint/no-non-null-assertion'
// A neighbour from the same preset that stays on, so the assertion below cannot pass by the preset
// being absent altogether.
const PREFER_INCLUDES: string = '@typescript-eslint/prefer-includes'
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

describe('the assertion-style fixer that Biome then rejects', () => {
  it('leaves a null-stripping cast alone in every config', async () => {
    expect(await onInEveryConfig(ASSERTION_STYLE)).toStrictEqual(everyConfig(false))
  })

  // The trade stated plainly: the ban survives, only the rule that wrote violations of it is gone.
  it('still refuses a non-null assertion that was written by hand', async () => {
    expect(await onInEveryConfig(NO_NON_NULL)).toStrictEqual(everyConfig(true))
  })

  // The preset is still mounted: the rule above is off by decision, not by the preset having gone.
  it('keeps the rest of the preset on, so this is an exception rather than an absence', async () => {
    expect(await onInEveryConfig(PREFER_INCLUDES)).toStrictEqual(everyConfig(true))
  })
})
