// What counts as an assertion in a Playwright spec.
//
// The Vitest scopes hold every test to `vitest/expect-expect`, which cannot see a Playwright `test`, so
// the end-to-end scope was left to `sonarjs/assertions-in-tests`. That rule follows a call one step into
// the function's body, and the sweep helpers ploaness ships arrive as declarations with no body. A test
// whose one check was `await expectSweptPage(page)` - the form the guide teaches - failed the lint the
// guide's own example was written against.
//
// The wiring is read through `calculateConfigForFile`, and the behaviour is then exercised with the
// option values that resolution returns, so the spec judges the rule a consumer actually gets.

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ESLint, Linter } from 'eslint'
import playwright from 'eslint-plugin-playwright'
import { describe, expect, it } from 'vitest'
import * as a11y from '../dist/a11y.js'
import payloadConfig, { E2E_ASSERTION_HELPERS } from '../dist/eslint.js'

const E2E_FILE: string = 'tests/e2e/example.spec.ts'
const EXPECT_EXPECT: string = 'playwright/expect-expect'
const SONAR_ASSERTIONS: string = 'sonarjs/assertions-in-tests'

const packageRoot: string = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null

const resolveRules = async (): Promise<Readonly<Record<string, unknown>>> => {
  const eslint: ESLint = new ESLint({ overrideConfigFile: true, baseConfig: [...payloadConfig], cwd: packageRoot })
  const resolved: unknown = await eslint.calculateConfigForFile(E2E_FILE)
  if (!(isRecord(resolved) && isRecord(resolved['rules']))) {
    throw new TypeError(`${E2E_FILE} resolved to no rules`)
  }
  return resolved['rules']
}

const severityOf = (setting: unknown): unknown => (Array.isArray(setting) ? setting[0] : setting)

const OFF: ReadonlySet<unknown> = new Set(['off', 0])

/** The rule as a consumer's end-to-end spec receives it, severity and options together. */
const shippedExpectExpect = async (): Promise<Linter.RuleEntry> => {
  const rules: Readonly<Record<string, unknown>> = await resolveRules()
  const setting: unknown = rules[EXPECT_EXPECT]
  if (!Array.isArray(setting)) {
    throw new TypeError(`${EXPECT_EXPECT} is not configured for ${E2E_FILE}`)
  }
  return setting as Linter.RuleEntry
}

/** The rules a spec body breaks, under the shipped assertion rule alone. */
const reportedFor = async (body: string): Promise<readonly string[]> => {
  const source: string = [
    "import { expect, test } from '@playwright/test'",
    "import { expectSweptPage } from 'ploaness/a11y'",
    'const expectAccessible = async (page) => expect(await page.title()).not.toBe("")',
    'const checkPage = async (page) => page.title()',
    `test('the page', async ({ page }) => { await page.goto('/'); ${body} })`,
    '',
  ].join('\n')
  const linter: Linter = new Linter({ configType: 'flat' })
  return linter
    .verify(source, [
      {
        languageOptions: { ecmaVersion: 2024, sourceType: 'module' },
        plugins: { playwright },
        rules: { [EXPECT_EXPECT]: await shippedExpectExpect() },
      },
    ])
    .map((message: Linter.LintMessage): string => message.ruleId ?? message.message)
}

describe('the assertion rule an end-to-end spec is held to', () => {
  it('is the Playwright rule, with the body-reading rule off in this scope', async () => {
    const rules: Readonly<Record<string, unknown>> = await resolveRules()
    expect([OFF.has(severityOf(rules[SONAR_ASSERTIONS])), OFF.has(severityOf(rules[EXPECT_EXPECT]))]).toEqual([
      true,
      false,
    ])
  })

  it('names only helpers ploaness/a11y really exports as functions', () => {
    const exported: Readonly<Record<string, unknown>> = a11y
    expect(E2E_ASSERTION_HELPERS.filter((name: string): boolean => typeof exported[name] !== 'function')).toEqual([])
  })
})

describe('which tests count as asserting', () => {
  it('accepts a test whose one check is the sweep the guide teaches', async () => {
    expect(await reportedFor('await expectSweptPage(page)')).toEqual([])
  })

  it('accepts a test that asserts with expect', async () => {
    expect(await reportedFor("await expect(page).toHaveURL('/')")).toEqual([])
  })

  it('accepts a project helper that follows the expect naming convention', async () => {
    expect(await reportedFor('await expectAccessible(page)')).toEqual([])
  })

  it('rejects a test that only drives the page', async () => {
    expect(await reportedFor('await checkPage(page)')).toEqual([EXPECT_EXPECT])
  })
})
