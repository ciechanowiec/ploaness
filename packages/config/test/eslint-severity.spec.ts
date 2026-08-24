// Two properties of the flat configs that no single rule declaration can hold on its own, because both
// are about what the WHOLE composed array says after every block has had its turn.
//
// A flat-config block that sets a rule REPLACES the earlier setting rather than merging with it. That
// makes the composed result the only thing worth asserting, and it is what let the inheritance ban sit
// disarmed in this repository's own spec block: the ban was declared in the shared layer, and a later
// block named the same key with only the assertion selectors in it.
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

/** The part of a flat-config block these assertions read. */
interface FlatBlock {
  readonly rules?: Readonly<Record<string, unknown>>
}

const RESTRICTED_SYNTAX: string = 'no-restricted-syntax'

const specDirectory: string = path.dirname(fileURLToPath(import.meta.url))
const configPackage: string = path.join(specDirectory, '..')
const workspaceRoot: string = path.join(configPackage, '..', '..')

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined

const importDefault = async (modulePath: string): Promise<unknown> => {
  const loaded: unknown = await import(pathToFileURL(modulePath).href)
  return asRecord(loaded)?.['default']
}

// A shape this does not recognise throws rather than yielding an empty array: a spec that silently
// measured nothing would keep reporting green while proving neither property.
const loadBlocks = async (modulePath: string): Promise<readonly FlatBlock[]> => {
  const exported: unknown = await importDefault(modulePath)
  if (!Array.isArray(exported)) {
    throw new TypeError(`${modulePath} does not default-export a flat config array`)
  }
  return exported as readonly FlatBlock[]
}

const severityOf = (setting: unknown): unknown => (Array.isArray(setting) ? setting[0] : setting)

const isWarning = (setting: unknown): boolean => {
  const severity: unknown = severityOf(setting)
  return severity === 'warn' || severity === 1
}

const isOff = (setting: unknown): boolean => {
  const severity: unknown = severityOf(setting)
  return severity === 'off' || severity === 0
}

const declaredRuleIds = (blocks: readonly FlatBlock[]): readonly string[] => [
  ...new Set(
    blocks.flatMap((block: FlatBlock): readonly string[] => Object.keys(block.rules ?? {})),
  ),
]

// Last block wins, which is how ESLint resolves the array, so a rule raised late must not be reported
// on the strength of an earlier declaration.
const resolvedSetting = (blocks: readonly FlatBlock[], ruleId: string): unknown =>
  blocks.reduce((carried: unknown, block: FlatBlock): unknown => {
    const setting: unknown = block.rules?.[ruleId]
    return setting === undefined ? carried : setting
  }, undefined)

const warningRules = (blocks: readonly FlatBlock[]): readonly string[] =>
  declaredRuleIds(blocks).filter((ruleId: string): boolean =>
    isWarning(resolvedSetting(blocks, ruleId)),
  )

const selectorOf = (entry: unknown): string => {
  const selector: unknown = asRecord(entry)?.['selector']
  return typeof selector === 'string' ? selector : ''
}

const selectorsIn = (setting: unknown): readonly string[] =>
  Array.isArray(setting)
    ? setting
        .slice(1)
        .map((entry: unknown): string => selectorOf(entry))
        .filter((selector: string): boolean => selector.length > 0)
    : []

const restrictedSyntaxSettings = (blocks: readonly FlatBlock[]): readonly unknown[] =>
  blocks
    .map((block: FlatBlock): unknown => block.rules?.[RESTRICTED_SYNTAX])
    .filter((setting: unknown): boolean => setting !== undefined && !isOff(setting))

const shippedConfig = (): Promise<readonly FlatBlock[]> =>
  loadBlocks(path.join(configPackage, 'eslint.js'))

const workspaceConfig = (): Promise<readonly FlatBlock[]> =>
  loadBlocks(path.join(workspaceRoot, 'eslint.config.mjs'))

// `NO_INHERITANCE` already carries its own leading severity, which is why every caller spreads it as
// the whole setting rather than prefixing one. Reading the exported constant rather than restating its
// selectors is what makes this a test of the joint between the two configs and the shared layer.
const inheritanceSelectors = async (): Promise<readonly string[]> => {
  const core: unknown = await import(pathToFileURL(path.join(configPackage, 'eslint-core.js')).href)
  return selectorsIn(asRecord(core)?.['NO_INHERITANCE'])
}

/** How the inheritance ban stands across one config: how many blocks set the key, and what is missing. */
interface BanStatus {
  readonly blocks: number
  readonly missing: readonly string[]
}

// The assertions live in the test rather than in this helper, so a test body that judges nothing reads
// as judging nothing. Returning the finding and asserting on it also names WHICH selector went missing,
// which a loop of per-block assertions does not.
const banStatus = async (blocks: readonly FlatBlock[]): Promise<BanStatus> => {
  const settings: readonly unknown[] = restrictedSyntaxSettings(blocks)
  const expected: readonly string[] = await inheritanceSelectors()
  return {
    blocks: settings.length,
    missing: settings.flatMap((setting: unknown): readonly string[] => {
      const present: readonly string[] = selectorsIn(setting)
      return expected.filter((selector: string): boolean => !present.includes(selector))
    }),
  }
}

describe('flat config severity', () => {
  it('leaves no rule of the shipped config at warning severity', async () => {
    expect(warningRules(await shippedConfig())).toEqual([])
  })

  it('leaves no rule of the workspace config at warning severity', async () => {
    expect(warningRules(await workspaceConfig())).toEqual([])
  })
})

describe('inheritance ban survives every no-restricted-syntax block', () => {
  it('keeps the ban in every such block of the shipped config', async () => {
    const status: BanStatus = await banStatus(await shippedConfig())
    expect(status.blocks).toBeGreaterThan(0)
    expect(status.missing).toEqual([])
  })

  it('keeps the ban in every such block of the workspace config', async () => {
    const status: BanStatus = await banStatus(await workspaceConfig())
    expect(status.blocks).toBeGreaterThan(0)
    expect(status.missing).toEqual([])
  })
})
