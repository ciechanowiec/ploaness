// The static half of Web Vitals, and where it is held.
//
// A vitals score is not a gate: it moves between two runs of an unchanged tree, and against `next dev`
// it would measure the compiler. The causes of a bad score are static, and Next publishes them as the
// core-web-vitals preset of its own lint plugin. That preset ships most of its rules at `warn`, which
// is not a verdict in a governed repository, so the application config mounts it through the same
// escalation the base layers pass through.
//
// Three joints are asserted rather than one literal. The rule list is read out of the plugin itself,
// because a hand copy of it here would agree with the config today and say nothing about the next Next.
// The scope is proven from both sides - a page is held and a component test is not - because a glob
// that reached nothing would leave every rule assertion vacuously true. And the library config is shown
// to carry none of it, for the reason it carries no jsx-a11y: a library serves no page.

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import nextPlugin from '@next/eslint-plugin-next'
import { ESLint, type Linter } from 'eslint'
import { describe, expect, it } from 'vitest'
// The build output, not the source, for the reason `vitest-config.spec.ts` states.
import payloadConfig from '../dist/eslint.js'
import libraryConfig from '../dist/eslint-library.js'

const specDirectory: string = path.dirname(fileURLToPath(import.meta.url))
const configPackage: string = path.join(specDirectory, '..')

const PLUGIN_PREFIX: string = '@next/next/'
const MODULE_VARIABLE_RULE: string = `${PLUGIN_PREFIX}no-assign-module-variable`
const PAGE_FILE: string = 'src/app/(frontend)/page.tsx'
const MODULE_FILE: string = 'src/lib/example.ts'
const COMPONENT_SPEC_FILE: string = 'tests/component/example.spec.tsx'
const ERROR: number = 2

// Loading a flat config resolves the whole toolchain it declares, for the reason
// `eslint-severity.spec.ts` records beside the same constant.
const CONFIG_LOAD: { readonly timeout: number } = { timeout: 30_000 }

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null

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
  if (!(isRecord(resolved) && isRecord(resolved['rules']))) {
    throw new TypeError(`${filePath} resolved to no rules`)
  }
  return resolved['rules']
}

const severityOf = (setting: unknown): unknown => (Array.isArray(setting) ? setting[0] : setting)

// Sorted on a copy, because the order ESLint or the plugin keeps is not part of what is asserted.
const sorted = (ids: readonly string[]): readonly string[] =>
  [...ids].sort((left: string, right: string): number => left.localeCompare(right))

const mountedRules = (rules: Readonly<Record<string, unknown>>): readonly string[] =>
  sorted(Object.keys(rules).filter((id: string): boolean => id.startsWith(PLUGIN_PREFIX)))

// What the plugin declares, under the id ESLint reports it by. Read once, at module scope, because it
// is the reference every assertion below measures the config against.
const shippedRules: readonly string[] = sorted(
  Object.keys(nextPlugin.rules).map((id: string): string => `${PLUGIN_PREFIX}${id}`),
)

describe('the Core Web Vitals preset in the application config', CONFIG_LOAD, () => {
  // Load-bearing for the two below: each of them compares against this list, and an empty one would
  // leave both satisfied by a config that mounted nothing.
  it('reads a rule table out of the plugin, so the comparisons below measure something', () => {
    expect(shippedRules.length).toBeGreaterThan(0)
  })

  it('mounts every rule the plugin ships, so the list is read rather than copied', async () => {
    const rules: Readonly<Record<string, unknown>> = await resolveRules(payloadConfig, PAGE_FILE)

    expect(mountedRules(rules)).toStrictEqual(shippedRules)
  })

  it('raises every one of them to error, because the preset leaves most at warn', async () => {
    const rules: Readonly<Record<string, unknown>> = await resolveRules(payloadConfig, PAGE_FILE)
    const belowError: readonly string[] = shippedRules.filter(
      (id: string): boolean => severityOf(rules[id]) !== ERROR,
    )

    expect(belowError).toStrictEqual([])
  })

  it('reaches a plain module, where the rules that are not about JSX apply', async () => {
    const rules: Readonly<Record<string, unknown>> = await resolveRules(payloadConfig, MODULE_FILE)

    expect(severityOf(rules[MODULE_VARIABLE_RULE])).toBe(ERROR)
  })

  it('leaves a component test alone, whose markup is rendered but never served', async () => {
    const rules: Readonly<Record<string, unknown>> = await resolveRules(
      payloadConfig,
      COMPONENT_SPEC_FILE,
    )

    expect(mountedRules(rules)).toStrictEqual([])
  })
})

describe('the Core Web Vitals preset and the library config', CONFIG_LOAD, () => {
  it('is not mounted there, because a library serves no page', async () => {
    const rules: Readonly<Record<string, unknown>> = await resolveRules(libraryConfig, MODULE_FILE)

    expect(mountedRules(rules)).toStrictEqual([])
  })
})
