// The no-inline-config-logic rule is the one ESLint rule with a Payload-specific purpose: a collection
// config must reference its access behaviour by an imported identifier rather than inlining an arrow
// function, so the behaviour is unit-testable on its own. This spec proves both halves: that the rule
// rejects what it should, and that it is still wired into the shipped config for the collection
// directories. Without the second half the rule could be silently rescoped and nothing would notice.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ENVIRONMENT_READ_EXEMPTIONS, VALIDATED_ENVIRONMENT_MODULE } from '@ploaness/governance'
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

// The source rather than the build output. Both carry these strings, and the assertion is about the
// config this repository authors; `dist` is derived from it by a compiler that does not rewrite literals.
const shippedConfig = (): string =>
  readFileSync(path.join(specDirectory, '..', 'src', 'eslint.ts'), 'utf8')

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
// This asserted ONE exemption, and now asserts two. The second is not a widening of convenience:
// `src/proxy.ts` is a file Next mandates by name and runs in the EDGE runtime, where the environment
// module - which validates a Node-shaped environment at module scope - cannot be imported. It reads
// `NODE_ENV`, which Next sets itself rather than project configuration anybody could have validated.
//
// The list is pinned rather than counted so a THIRD entry has to be argued for here, in a spec somebody
// reads, rather than appearing in a config nobody diffs.
//
// The list now lives in `@ploaness/governance`, because the `environment` gate reads variable names out
// of the very module this rule exempts: written twice, one copy would drift and the gate would read a
// file no rule protects. So the config is asserted to CONSUME the shared list and the list itself is
// pinned here, which keeps the argument where it was - a third entry still has to be made in this spec.
describe('process.env access gate', () => {
  it('exempts the environment module and the Next proxy, and nothing else', () => {
    const config: string = shippedConfig()
    expect(config).toContain("property: 'env'")
    expect(config).toContain('ignores: [...ENVIRONMENT_READ_EXEMPTIONS]')
    expect(ENVIRONMENT_READ_EXEMPTIONS).toEqual(['src/lib/environment.ts', 'src/proxy.ts'])
  })

  // The other half of the same joint: the gate reads only the validated module, so the name it reads
  // has to be the name the lint rule exempts rather than a second spelling of it.
  it('reads variable names out of a module the lint rule exempts', () => {
    expect(ENVIRONMENT_READ_EXEMPTIONS).toContain(VALIDATED_ENVIRONMENT_MODULE)
  })
})
