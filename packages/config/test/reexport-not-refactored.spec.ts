// The joint between two rules this harness owns, which contradicted each other.
//
// `wiring` requires `eslint.config.mjs`, `vitest.config.mts` and `playwright.config.ts` to contain an
// import of a ploaness config and its default re-export, and nothing else. `unicorn/prefer-export-from`
// rewrites exactly that shape into `export { default } from '...'` - and it AUTOFIXES, so
// `ploaness format` turned a correctly wired project into one `wiring` then rejected. Every time it
// ran. The formatter is one of the three scripts ploaness REQUIRES a project to declare, so the harness
// was shipping a command that broke its own precondition.
//
// Asserting the joint rather than either half: the shape wiring wants must survive the linter that
// formats it.

import { REEXPORT_CONFIG_FILES } from '@ploaness/governance'
import { Linter } from 'eslint'
import unicorn from 'eslint-plugin-unicorn'
import { describe, expect, it } from 'vitest'
import payloadConfig from '../src/eslint.js'
import libraryConfig from '../src/eslint-library.js'

const WIRED: string = "import ploaness from 'ploaness/eslint'\n\nexport default ploaness\n"

const linter: Linter = new Linter()

const violationsIn = (code: string): readonly string[] =>
  linter
    .verify(code, {
      plugins: { unicorn },
      languageOptions: { ecmaVersion: 2024, sourceType: 'module' },
      rules: { 'unicorn/prefer-export-from': 'error' },
    })
    .map((message): string => message.ruleId ?? '')

// Guard the premise: if this rule ever stops rewriting the shape, the exemptions below are dead weight
// and this spec should say so rather than passing vacuously.
describe('the rule that made the exemption necessary', () => {
  it('still rewrites an import-plus-default-export into an export-from', () => {
    expect(violationsIn(WIRED)).toContain('unicorn/prefer-export-from')
  })
})

const declaresExemptionForEveryFile = (blocks: readonly unknown[]): boolean =>
  blocks.some((entry: unknown): boolean => {
    const block: Record<string, unknown> = (entry ?? {}) as Record<string, unknown>
    const files: readonly string[] = (block['files'] ?? []) as readonly string[]
    const rules: Record<string, unknown> = (block['rules'] ?? {}) as Record<string, unknown>
    return (
      rules['unicorn/prefer-export-from'] === 'off' &&
      REEXPORT_CONFIG_FILES.every((file: string): boolean => files.includes(file))
    )
  })

describe('every shipped config exempts the files wiring dictates the shape of', () => {
  it('the Payload config turns the rule off for all of them', () => {
    expect(declaresExemptionForEveryFile(payloadConfig as readonly unknown[])).toBe(true)
  })

  it('the library config turns the rule off for all of them', () => {
    expect(declaresExemptionForEveryFile(libraryConfig as readonly unknown[])).toBe(true)
  })
})
