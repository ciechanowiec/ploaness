// Two unicorn fixers that assume the browser's DOM, held off in every shipped config.
//
// `prefer-dom-node-append` rewrites `parent.appendChild(child)` to `parent.append(child)` and
// `prefer-dom-node-remove` rewrites `parent.removeChild(child)` to `child.remove()`. Neither is
// type-aware, so both say the same about any object carrying a method of that name - and a Payload
// server has one: the XML parser a project sanitises an uploaded SVG with implements the older methods
// and not the newer ones. The fixer wrote code the `types` gate then rejected, which is the shape
// `immutable-accumulation.spec.ts` records for `prefer-spread`: a contradiction the harness walks a
// project into rather than one a person can step around.
//
// Read through `calculateConfigForFile` rather than from the source, because both rules arrive from the
// unicorn preset rather than from a table this package writes: a source read would find no entry and
// could not tell "off" from "never mentioned".

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ESLint, type Linter } from 'eslint'
import { describe, expect, it } from 'vitest'
import payloadConfig from '../dist/eslint.js'
import libraryConfig from '../dist/eslint-library.js'

const PREFER_APPEND: string = 'unicorn/prefer-dom-node-append'
const PREFER_REMOVE: string = 'unicorn/prefer-dom-node-remove'
// A neighbour from the same preset that stays on, so the assertion below cannot pass by the preset
// being absent altogether.
const CALLBACK_REFERENCE: string = 'unicorn/no-array-callback-reference'
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

describe('the DOM fixers that break a non-browser DOM', () => {
  it('leaves appendChild alone in every config', async () => {
    expect(await onInEveryConfig(PREFER_APPEND)).toStrictEqual(everyConfig(false))
  })

  it('leaves removeChild alone in every config', async () => {
    expect(await onInEveryConfig(PREFER_REMOVE)).toStrictEqual(everyConfig(false))
  })

  // The preset is still mounted: the two above are off by decision, not by the preset having gone.
  it('keeps the rest of the preset on, so the two are exceptions rather than an absence', async () => {
    expect(await onInEveryConfig(CALLBACK_REFERENCE)).toStrictEqual(everyConfig(true))
  })
})
