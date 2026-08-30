// A documenting comment that documents nothing.
//
// `jsdoc/require-jsdoc` asks only whether a block is PRESENT, so `/**\n *\n */` satisfied it while
// saying nothing at all - a check that could not fail, sitting under the one rule whose whole purpose
// is a documenting comment. A consuming project shipped exactly that stub above a Payload hook, and it
// passed every gate for two sessions until the file was rewritten for unrelated reasons.
//
// Both halves are proven here, for the reason `eslint-config.spec.ts` gives about the rule beside it:
// that the rule rejects what it should, and that it is still wired into the config a consumer receives.
// Without the second half the rule could be rescoped to nothing and this spec would keep passing.
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Linter } from 'eslint'
import jsdoc from 'eslint-plugin-jsdoc'
import { describe, expect, it } from 'vitest'

type LintMessage = ReturnType<Linter['verify']>[number]

/** The part of a flat-config block these assertions read. */
interface FlatBlock {
  readonly rules?: Readonly<Record<string, unknown>>
}

const RULE: string = 'jsdoc/require-description'

const specDirectory: string = path.dirname(fileURLToPath(import.meta.url))
// The build output, because these blocks are loaded and composed rather than read as text. It is also
// what a consumer receives, so the wiring is proven against the artefact rather than its source.
const configPackage: string = path.join(specDirectory, '..', 'dist')
const linter: Linter = new Linter()

// Plain JavaScript snippets, read by the default parser. What is under test is a comment rule, and a
// type annotation would add a TypeScript parser to the assertion for nothing.
const messagesFor = (code: string): readonly LintMessage[] =>
  linter.verify(code, {
    plugins: { jsdoc },
    languageOptions: { ecmaVersion: 2024, sourceType: 'module' },
    rules: { [RULE]: 'error' },
  })

const ruleIds = (code: string): readonly string[] =>
  messagesFor(code).map((message: LintMessage): string => message.ruleId ?? '')

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined

// A shape this does not recognise throws rather than yielding an empty array: a spec that silently
// measured nothing would keep reporting green while proving neither property.
const loadBlocks = async (entryPoint: string): Promise<readonly FlatBlock[]> => {
  const loaded: unknown = await import(pathToFileURL(path.join(configPackage, entryPoint)).href)
  const exported: unknown = asRecord(loaded)?.['default']
  if (!Array.isArray(exported)) {
    throw new TypeError(`${entryPoint} does not default-export a flat config array`)
  }
  return exported as readonly FlatBlock[]
}

// Last block wins, which is how ESLint resolves the array.
const resolvedSetting = (blocks: readonly FlatBlock[], ruleId: string): unknown =>
  blocks.reduce((carried: unknown, block: FlatBlock): unknown => {
    const setting: unknown = block.rules?.[ruleId]
    return setting === undefined ? carried : setting
  }, undefined)

describe('a documenting comment must say something', () => {
  it('rejects a block that carries no description', () => {
    expect(ruleIds('/**\n *\n */\nexport const one = () => 1')).toEqual([RULE])
  })

  it('rejects a block that carries only tags', () => {
    expect(ruleIds('/**\n * @returns nothing much\n */\nexport const one = () => 1')).toEqual([
      RULE,
    ])
  })

  it('accepts a block that describes what the symbol is', () => {
    expect(ruleIds('/** The number one. */\nexport const one = () => 1')).toEqual([])
  })

  // The rule visits blocks that already exist. It must not become a second, wider `require-jsdoc`:
  // which symbols need documenting is decided there, with `publicOnly` and a context list, and a rule
  // that also demanded blocks would silently hold every internal helper to the public contract.
  it('says nothing about a symbol carrying no block at all', () => {
    expect(ruleIds('export const one = () => 1')).toEqual([])
  })
})

describe('the rule is wired into the configs a consumer receives', () => {
  it('is an error in the Payload config', async () => {
    const blocks: readonly FlatBlock[] = await loadBlocks('eslint.js')
    expect(resolvedSetting(blocks, RULE)).toBe('error')
  })

  it('is an error in the library config, because a doc block is not a framework question', async () => {
    const blocks: readonly FlatBlock[] = await loadBlocks('eslint-library.js')
    expect(resolvedSetting(blocks, RULE)).toBe('error')
  })
})
