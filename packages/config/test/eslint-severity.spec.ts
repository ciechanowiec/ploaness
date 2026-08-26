// Two properties of the flat configs that no single rule declaration can hold on its own, because both
// are about what the WHOLE composed array says after every block has had its turn.
//
// A flat-config block that sets a rule REPLACES the earlier setting rather than merging with it. That
// makes the composed result the only thing worth asserting, and it is what let the inheritance ban sit
// disarmed in this repository's own spec block: the ban was declared in the shared layer, and a later
// block named the same key with only the assertion selectors in it.
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Linter } from 'eslint'
import { describe, expect, it } from 'vitest'

type LintMessage = ReturnType<Linter['verify']>[number]

/** The part of a flat-config block these assertions read. */
interface FlatBlock {
  readonly rules?: Readonly<Record<string, unknown>>
}

const RESTRICTED_SYNTAX: string = 'no-restricted-syntax'
const RESTRICTED_PROPERTIES: string = 'no-restricted-properties'

const specDirectory: string = path.dirname(fileURLToPath(import.meta.url))
// The build output, because these blocks are loaded and composed rather than read as text. It is also
// what a consumer receives, so the properties are proven against the artefact rather than its source.
const configPackage: string = path.join(specDirectory, '..', 'dist')
const workspaceRoot: string = path.join(specDirectory, '..', '..', '..')

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

const settingsFor = (blocks: readonly FlatBlock[], rule: string): readonly unknown[] =>
  blocks
    .map((block: FlatBlock): unknown => block.rules?.[rule])
    .filter((setting: unknown): boolean => setting !== undefined && !isOff(setting))

const restrictedSyntaxSettings = (blocks: readonly FlatBlock[]): readonly unknown[] =>
  settingsFor(blocks, RESTRICTED_SYNTAX)

// `no-restricted-properties` entries are objects rather than selector strings, so the mock ban is read
// by the pair it actually bans: `vi.fn`, `vi.mock`, and the rest.
const mockedMemberIn = (entry: unknown): string => {
  const record: Record<string, unknown> | undefined = asRecord(entry)
  const object: unknown = record?.['object']
  const property: unknown = record?.['property']
  return typeof object === 'string' && typeof property === 'string' ? `${object}.${property}` : ''
}

const mockedMembersIn = (setting: unknown): readonly string[] =>
  Array.isArray(setting)
    ? setting
        .slice(1)
        .map((entry: unknown): string => mockedMemberIn(entry))
        .filter((member: string): boolean => member.length > 0)
    : []

/** How the mock ban stands across one config: how many blocks set the key, and what is missing. */
const mockBanStatus = async (blocks: readonly FlatBlock[]): Promise<BanStatus> => {
  const settings: readonly unknown[] = settingsFor(blocks, RESTRICTED_PROPERTIES)
  const core: unknown = await import(pathToFileURL(path.join(configPackage, 'eslint-core.js')).href)
  const exported: unknown = asRecord(core)?.['NO_MOCK_PROPERTIES']
  const entries: readonly unknown[] = Array.isArray(exported)
    ? (exported as readonly unknown[])
    : []
  // A placeholder severity in front, so this reads the same shape `mockedMembersIn` sees in a rule
  // setting - where the severity is the first element and the entries follow it.
  const expected: readonly string[] = mockedMembersIn(['error', ...entries])
  return {
    blocks: settings.length,
    missing: settings.flatMap((setting: unknown): readonly string[] => {
      const present: readonly string[] = mockedMembersIn(setting)
      return expected.filter((member: string): boolean => !present.includes(member))
    }),
  }
}

const shippedConfig = (): Promise<readonly FlatBlock[]> =>
  loadBlocks(path.join(configPackage, 'eslint.js'))

const workspaceConfig = (): Promise<readonly FlatBlock[]> =>
  loadBlocks(path.join(workspaceRoot, 'eslint.config.mjs'))

// `NO_INHERITANCE` already carries its own leading severity, which is why every caller spreads it as
// the whole setting rather than prefixing one. Reading the exported constant rather than restating its
// selectors is what makes this a test of the joint between the two configs and the shared layer.
const sharedSelectors = async (exportName: string): Promise<readonly string[]> => {
  const core: unknown = await import(pathToFileURL(path.join(configPackage, 'eslint-core.js')).href)
  const exported: unknown = asRecord(core)?.[exportName]
  const entries: readonly unknown[] = Array.isArray(exported)
    ? (exported as readonly unknown[])
    : []
  // `selectorsIn` drops the leading severity, which `NO_INHERITANCE` carries and the newer groups do
  // not. A placeholder in front of both makes the two shapes read the same way here.
  return selectorsIn(['error', ...entries])
}

const inheritanceSelectors = (): Promise<readonly string[]> => sharedSelectors('NO_INHERITANCE')

const lintRestrictedSyntax = (code: string, selectors: readonly string[]): readonly LintMessage[] =>
  new Linter().verify(code, {
    languageOptions: { ecmaVersion: 2024, sourceType: 'module' },
    rules: {
      'no-restricted-syntax': [
        'error',
        ...selectors.map((selector: string): Readonly<Record<string, string>> => ({ selector })),
      ],
    },
  })

// The determinism groups differ from the inheritance ban in where they belong: they govern specs, so
// they are spread into the block that lints the suite rather than into every block. What would drift is
// the spread going missing on a later edit, which is what this reads.
const carriedSomewhere = (
  blocks: readonly FlatBlock[],
  selectors: readonly string[],
): readonly string[] => {
  const present: ReadonlySet<string> = new Set(
    restrictedSyntaxSettings(blocks).flatMap((setting: unknown): readonly string[] =>
      selectorsIn(setting),
    ),
  )
  return selectors.filter((selector: string): boolean => !present.has(selector))
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

// Every test in this file loads a flat config, and loading one resolves the whole toolchain that config
// declares - typescript-eslint and nine plugins. The cost is paid once per file, by whichever test
// imports first, and the suite is shuffled: which test pays is decided by the seed rather than by what
// the test does. Under Vitest's five-second default three of them timed out on a busy machine and
// passed on the next run of the same tree, which is the one thing a check may not do.
//
// Declared here rather than raised in the shipped Vitest config. That default is a threshold ploaness
// owns for a consumer's suite, and no consumer spec loads an analyzer in order to assert about it. The
// limit is still a limit: a genuine hang fails here as it did before.
const CONFIG_LOAD: { readonly timeout: number } = { timeout: 30_000 }

describe('flat config severity', CONFIG_LOAD, () => {
  it('leaves no rule of the shipped config at warning severity', async () => {
    expect(warningRules(await shippedConfig())).toEqual([])
  })

  it('leaves no rule of the workspace config at warning severity', async () => {
    expect(warningRules(await workspaceConfig())).toEqual([])
  })
})

describe('inheritance ban survives every no-restricted-syntax block', CONFIG_LOAD, () => {
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

// The same trap as the inheritance ban, in a different key. `eslint.js` scoped
// `no-restricted-properties` to `src/**` for the process.env rule and, by naming the key at all,
// replaced the build-wide mock ban across a project's entire source tree.
describe('mock ban survives every no-restricted-properties block', CONFIG_LOAD, () => {
  it('keeps the ban in every such block of the shipped config', async () => {
    const status: BanStatus = await mockBanStatus(await shippedConfig())
    expect(status.blocks).toBeGreaterThan(0)
    expect(status.missing).toEqual([])
  })

  it('keeps the ban in every such block of the workspace config', async () => {
    const status: BanStatus = await mockBanStatus(await workspaceConfig())
    expect(status.missing).toEqual([])
  })
})

describe('the determinism selectors reach the block that lints the suite', CONFIG_LOAD, () => {
  it.each(['NO_TEST_ORDER_ESCAPE', 'NO_NETWORK_GUARD_ESCAPE'])(
    'carries %s into the shipped config',
    async (exportName: string) => {
      const selectors: readonly string[] = await sharedSelectors(exportName)
      expect(selectors.length).toBeGreaterThan(0)
      expect(carriedSomewhere(await shippedConfig(), selectors)).toEqual([])
    },
  )

  it.each(['NO_TEST_ORDER_ESCAPE', 'NO_NETWORK_GUARD_ESCAPE'])(
    'carries %s into the workspace config',
    async (exportName: string) => {
      const selectors: readonly string[] = await sharedSelectors(exportName)
      expect(selectors.length).toBeGreaterThan(0)
      expect(carriedSomewhere(await workspaceConfig(), selectors)).toEqual([])
    },
  )

  it.each([
    ['a raw datagram import', "import dgram from 'node:dgram'"],
    ['a dynamic child-process import', "const child = await import('node:child_process')"],
    ['a CommonJS worker import', "const threads = require('node:worker_threads')"],
    [
      'a cluster loaded through process',
      "const cluster = process.getBuiltinModule('node:cluster')",
    ],
    ['a global worker', "const worker = new Worker('worker.js')"],
  ])('rejects %s', async (_what: string, code: string) => {
    const selectors: readonly string[] = await sharedSelectors('NO_NETWORK_GUARD_ESCAPE')
    expect(lintRestrictedSyntax(code, selectors)).toHaveLength(1)
  })
})
