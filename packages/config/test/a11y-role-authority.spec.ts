// Which linter decides that an element may carry an interactive ARIA role.
//
// Both shipped linters carry a rule for it, and for one shape they contradict each other outright.
// Biome's `useSemanticElements` requires `role="grid"` to sit on a `<table>` - which is what the ARIA
// pattern documents - and Biome's `noNoninteractiveElementToInteractiveRole` then refuses the table
// carrying it. No markup satisfies both, and the second accepts no options to say otherwise, so every
// consumer building an accessible grid, treegrid, listbox or tab-strip on the correct native element
// spent a suppression on a disagreement between two rules rather than on a hard case.
//
// So the ESLint port decides, because it is the one that gets the case right: its recommended options
// name `table: ['grid']`, `td: ['gridcell']` and `li: ['row']` explicitly. The Biome rule is off.
//
// Both halves are asserted here because either alone is a hazard. The Biome rule turned off while the
// ESLint one was never mounted would be the check silently gone rather than moved, and the ESLint one
// mounted without the allowances would put the contradiction straight back.

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ESLint, type Linter } from 'eslint'
import { describe, expect, it } from 'vitest'
// The build output, not the source, for the reason `vitest-config.spec.ts` states.
import payloadConfig from '../dist/eslint.js'

const specDirectory: string = path.dirname(fileURLToPath(import.meta.url))
const configPackage: string = path.join(specDirectory, '..')

const BIOME_RULE: string = 'noNoninteractiveElementToInteractiveRole'
const ESLINT_RULE: string = 'jsx-a11y/no-noninteractive-element-to-interactive-role'
const MARKUP_FILE: string = 'src/components/example.tsx'
const ERROR: number = 2

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null

// Read as text and searched for the key wherever it sits, rather than at a path in the schema, so moving
// the rule between Biome's groups cannot make this spec quietly stop looking. The same reading the
// `noVoid` and `noAccumulatingSpread` specs use for the core half of the configuration.
const biomeConfigText = (name: string): string =>
  readFileSync(path.join(configPackage, name), 'utf8')

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

const settingOf = async (rule: string): Promise<unknown> => {
  const rules: Readonly<Record<string, unknown>> = await resolveRules(payloadConfig, MARKUP_FILE)
  return rules[rule]
}

// The element-to-role allowances the rule was given, which are the whole reason it is the one deciding.
const allowancesOf = (setting: unknown): Readonly<Record<string, unknown>> => {
  if (!Array.isArray(setting)) {
    throw new TypeError(`${ESLINT_RULE} is unset at ${MARKUP_FILE}`)
  }
  const options: unknown = setting[1]
  if (!isRecord(options)) {
    throw new TypeError(`${ESLINT_RULE} carries no element-to-role allowances`)
  }
  return options
}

describe('the Biome half of the interactive-role check', () => {
  it('is off for an application, where the ESLint port judges the same markup', () => {
    expect(biomeConfigText('biome.json')).toContain(`"${BIOME_RULE}": "off"`)
  })

  // A library extends the core half and receives no jsx-a11y at all, so turning the rule off there would
  // remove the check rather than move it. The two halves are different decisions and stay so.
  it('is left alone in the core half, which a library extends with nothing to replace it', () => {
    expect(biomeConfigText('biome-core.json')).not.toContain(BIOME_RULE)
  })
})

describe('the ESLint half, which now decides alone', () => {
  it('judges markup, so the check moved rather than went', async () => {
    const setting: unknown = await settingOf(ESLINT_RULE)

    expect(Array.isArray(setting) ? setting[0] : setting).toBe(ERROR)
  })

  it('permits a table to carry the grid role, which is the shape Biome refused', async () => {
    const allowances: Readonly<Record<string, unknown>> = allowancesOf(await settingOf(ESLINT_RULE))

    expect(allowances['table']).toStrictEqual(['grid'])
  })

  it('permits a cell to carry the gridcell role, which the same markup needs', async () => {
    const allowances: Readonly<Record<string, unknown>> = allowancesOf(await settingOf(ESLINT_RULE))

    expect(allowances['td']).toStrictEqual(['gridcell'])
  })

  // Load-bearing: the allowances are an exception to a rule that is otherwise doing its job, and a rule
  // that permitted everything would satisfy the two assertions above while checking nothing.
  it('still refuses a role on an element that has no business carrying it', async () => {
    const allowances: Readonly<Record<string, unknown>> = allowancesOf(await settingOf(ESLINT_RULE))

    expect(allowances['ul']).not.toContain('grid')
  })
})
