// The joint between the two shipped ESLint configs and the shared statement of what a spec is.
//
// A library member and a Payload member differ in what they CONTAIN - a generated mount under
// `src/app/(payload)`, a collection directory, a centralised environment module - and in nothing else. A
// spec is a spec in both, so the two configs have to reach the same verdict about one. For as long as
// each config stated the test rules itself they did not: a library consumer's specs were held to the
// bare-number ban a Payload consumer's specs are exempt from, and guarded by two of the nineteen
// selectors rather than by all of them. Neither config was wrong read on its own, which is why nothing
// found it.
//
// The question is put to ESLint rather than to the source text, because a block that sets
// `no-restricted-syntax` REPLACES the setting rather than merging into it. Finding five selector lists
// spliced together in a file says nothing about how many survive the cascade; `calculateConfigForFile`
// runs the cascade and answers with what the rule will actually be.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ESLint, type Linter } from 'eslint'
import { describe, expect, it } from 'vitest'
import payloadConfig from '../dist/eslint.js'
import { testIdiomRules, testSuiteSyntaxRules } from '../dist/eslint-core.js'
// The build output, for the reason `vitest-config.spec.ts` states: `dist` is what a consumer loads, and
// the shared tables have to be the ones the shipped configs were compiled against.
import libraryConfig from '../dist/eslint-library.js'

/** A path under the Vitest suite, which both configs claim, and one under the code it tests. */
const SPEC_FILE: string = 'tests/unit/example.spec.ts'
const PRODUCTION_FILE: string = 'src/lib/example.ts'

const configPackage: string = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

/** ESLint reports a numeric severity; the tables state a named one. Compared as the name. */
const NAMED_SEVERITY: readonly string[] = ['off', 'warn', 'error']

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null

// A shape this does not recognise throws rather than comparing as `undefined`. Two rules that were both
// absent would agree with each other, which is the one way this spec could pass having measured nothing.
const severityOf = (rules: Readonly<Record<string, unknown>>, rule: string): string => {
  const entry: unknown = rules[rule]
  const head: unknown = Array.isArray(entry) ? entry[0] : entry
  if (typeof head === 'string') {
    return head
  }
  const named: string | undefined = typeof head === 'number' ? NAMED_SEVERITY[head] : undefined
  if (named === undefined) {
    throw new TypeError(`${rule} carries no severity this spec recognises`)
  }
  return named
}

const byName = (left: string, right: string): number => left.localeCompare(right)

const selectorsOf = (rules: Readonly<Record<string, unknown>>): readonly string[] => {
  const entry: unknown = rules['no-restricted-syntax']
  if (!Array.isArray(entry)) {
    throw new TypeError('no-restricted-syntax carries no selectors')
  }
  const shapes: readonly unknown[] = entry.slice(1)
  return shapes
    .map((shape: unknown): string => {
      const selector: unknown = isRecord(shape) ? shape['selector'] : undefined
      if (typeof selector !== 'string') {
        throw new TypeError('a no-restricted-syntax entry names no selector')
      }
      return selector
    })
    .sort(byName)
}

// The awaited value lands in `unknown` rather than in an annotation, because `calculateConfigForFile` is
// declared to return `any` and an annotation would let that `any` through under a name that looks typed.
const resolveRules = async (
  config: readonly Linter.Config[],
  filePath: string,
): Promise<Readonly<Record<string, unknown>>> => {
  const eslint: ESLint = new ESLint({
    overrideConfigFile: true,
    baseConfig: [...config],
    cwd: configPackage,
  })
  const resolved: unknown = await eslint.calculateConfigForFile(filePath)
  const rules: unknown = isRecord(resolved) ? resolved['rules'] : undefined
  if (!isRecord(rules)) {
    throw new TypeError(`ESLint resolved no rules for ${filePath}`)
  }
  return rules
}

const shippedConfigs: Readonly<Record<string, readonly Linter.Config[]>> = {
  payload: payloadConfig,
  library: libraryConfig,
}

describe('what the shipped configs make of a spec file', () => {
  it('exempts it from the same rules, so a member kind cannot change what a test may say', async () => {
    const exempted: readonly string[] = Object.keys(testIdiomRules)
    expect(exempted.length).toBeGreaterThan(0)
    for (const [name, config] of Object.entries(shippedConfigs)) {
      const rules: Readonly<Record<string, unknown>> = await resolveRules(config, SPEC_FILE)
      for (const rule of exempted) {
        expect(severityOf(rules, rule), `${rule} in the ${name} config`).toBe('off')
      }
    }
  })

  it('guards it with the same selectors, every one the shared table states', async () => {
    const stated: readonly string[] = selectorsOf(testSuiteSyntaxRules)
    expect(stated.length).toBeGreaterThan(0)
    for (const [name, config] of Object.entries(shippedConfigs)) {
      const rules: Readonly<Record<string, unknown>> = await resolveRules(config, SPEC_FILE)
      expect(selectorsOf(rules), `the selectors reaching a spec in the ${name} config`).toEqual(
        stated,
      )
    }
  })

  // Without this, both halves above are satisfied by turning the rule off for everything, which is the
  // cheapest way to make two configs agree and the one way that must not count as agreement.
  it('still holds the code that spec tests to the ban the spec is exempt from', async () => {
    for (const [name, config] of Object.entries(shippedConfigs)) {
      const rules: Readonly<Record<string, unknown>> = await resolveRules(config, PRODUCTION_FILE)
      expect(
        severityOf(rules, '@typescript-eslint/no-magic-numbers'),
        `the bare-number ban on production code in the ${name} config`,
      ).toBe('error')
    }
  })
})
