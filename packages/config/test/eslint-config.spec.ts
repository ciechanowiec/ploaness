// The no-inline-config-logic rule is the one ESLint rule with a Payload-specific purpose: a collection
// config must reference its access behaviour by an imported identifier rather than inlining an arrow
// function, so the behaviour is unit-testable on its own. This spec proves both halves: that the rule
// rejects what it should, and that it is still wired into the shipped config for the collection
// directories. Without the second half the rule could be silently rescoped and nothing would notice.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Linter } from 'eslint'
import { describe, expect, it } from 'vitest'

// Taken from the public surface of the linter this spec already imports, rather than reached for
// inside the dependency tree.
type LintMessage = ReturnType<Linter['verify']>[number]

const SELECTOR: string = 'ArrowFunctionExpression, FunctionExpression'

const specDirectory: string = path.dirname(fileURLToPath(import.meta.url))
const linter: Linter = new Linter()

const lintConfigSnippet = (code: string): readonly LintMessage[] =>
  linter.verify(code, {
    languageOptions: { ecmaVersion: 2024, sourceType: 'module' },
    rules: { 'no-restricted-syntax': ['error', { selector: SELECTOR }] },
  })

const shippedConfig = (): string =>
  readFileSync(path.join(specDirectory, '..', 'eslint.js'), 'utf8')

describe('no-inline-config-logic gate', () => {
  it('rejects an arrow function inlined as a config value', () => {
    const messages: readonly LintMessage[] = lintConfigSnippet(
      'const Users = { access: { read: () => true } }',
    )
    expect(messages).toHaveLength(1)
    expect(messages[0]?.ruleId).toBe('no-restricted-syntax')
  })

  it('rejects an inline function expression as a config value', () => {
    const messages: readonly LintMessage[] = lintConfigSnippet(
      'const C = { access: { read: function () { return true } } }',
    )
    expect(messages).toHaveLength(1)
  })

  it('accepts behavior referenced by an imported identifier (the extracted form)', () => {
    const messages: readonly LintMessage[] = lintConfigSnippet(
      'const C = { access: { read: anyone, create: admins } }',
    )
    expect(messages).toHaveLength(0)
  })

  it('stays wired into the shipped ESLint config for the collection-config directories', () => {
    const config: string = shippedConfig()
    expect(config).toContain(SELECTOR)
    expect(config).toContain("'src/collections/**/*.ts'")
  })
})

// The process.env ban is the second rule whose value lies entirely in its scope. Reading the environment
// anywhere but the one validating module defeats the narrowing that module exists to provide, so the
// exemption must stay a single path. This assertion moved here from the consumer, where it had been
// reading the project's own eslint.config.mjs: that file is now a bare re-export, and the rule it was
// really describing lives in ploaness.
describe('process.env access gate', () => {
  it('exempts exactly one module from the process.env ban', () => {
    const config: string = shippedConfig()
    expect(config).toContain("property: 'env'")
    expect(config).toContain("ignores: ['src/lib/environment.ts']")
  })
})
