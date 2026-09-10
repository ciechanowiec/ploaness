import { describe, expect, it } from 'vitest'
import type { SpecSource } from '../src/axe-coverage.js'
import {
  type BootstrapHook,
  bootstrapHooksIn,
  candidatePathsFor,
  exportedBodyIn,
  findBootstrapWrites,
  LOCAL_API_MUTATIONS,
  moduleOfImport,
} from '../src/payload-bootstrap.js'
import type { LocatedViolation } from '../src/relationship-cleanup.js'

const CONFIG_PATH: string = 'src/payload.config.ts'

const configWith = (hook: string): string =>
  ['export default buildConfig({', '  collections: [Users],', `  onInit: ${hook},`, '})'].join('\n')

const file = (path: string, source: string): SpecSource => ({ path, source })

const rulesOf = (files: readonly SpecSource[]): readonly string[] =>
  findBootstrapWrites(files).map((located: LocatedViolation): string => located.violation.rule)

describe('LOCAL_API_MUTATIONS', () => {
  it('holds the operations that change stored state', () => {
    expect(LOCAL_API_MUTATIONS).toContain('.updateGlobal(')
    expect(LOCAL_API_MUTATIONS).toContain('.create(')
  })

  // A read at boot is legitimate, so the derived subset must not carry one.
  it('holds none of the operations that only read', () => {
    expect(LOCAL_API_MUTATIONS).not.toContain('.find(')
    expect(LOCAL_API_MUTATIONS).not.toContain('.findGlobal(')
  })
})

describe('bootstrapHooksIn', () => {
  it('reads the body of an arrow hook', () => {
    const found: readonly BootstrapHook[] = bootstrapHooksIn(
      configWith('async (payload) => { await warm(payload) }'),
    )
    expect(found).toHaveLength(1)
    expect(found[0]?.body).toContain('warm')
  })

  // A destructured parameter opens a brace before the body does, so the body cannot be the first one.
  it('reads the body of a hook whose parameter is destructured', () => {
    const found: readonly BootstrapHook[] = bootstrapHooksIn(
      configWith('async ({ payload }) => { await warm(payload) }'),
    )
    expect(found[0]?.body).toContain('warm')
  })

  it('finds nothing in a configuration that declares no hook', () => {
    expect(bootstrapHooksIn('export default buildConfig({ collections: [Users] })')).toEqual([])
  })

  // A hook written as a function expression opens no arrow, so the body is the first brace after it.
  it('reads the body of a hook written as a function expression', () => {
    const found: readonly BootstrapHook[] = bootstrapHooksIn(
      configWith('async function (payload) { await warm(payload) }'),
    )
    expect(found[0]?.body).toContain('warm')
  })

  it('finds nothing when the hook value opens no body', () => {
    expect(bootstrapHooksIn(configWith('seedEverything'))).toEqual([])
  })
})

describe('moduleOfImport', () => {
  it('reads the specifier a name is imported from', () => {
    expect(moduleOfImport("import { seedContent } from './seed/seed'", 'seedContent')).toBe(
      './seed/seed',
    )
  })

  it('reads a renamed binding by the name the file uses', () => {
    expect(moduleOfImport("import { seed as seedContent } from '@/seed'", 'seedContent')).toBe(
      '@/seed',
    )
  })

  it('is undefined for a name the file never imports', () => {
    expect(moduleOfImport("import { other } from '@/seed'", 'seedContent')).toBeUndefined()
  })
})

describe('candidatePathsFor', () => {
  it('resolves the alias against the source root', () => {
    expect(candidatePathsFor('@/seed/seed', CONFIG_PATH)).toContain('src/seed/seed.ts')
  })

  // The real defect imported its seed relatively, so this form has to resolve or the rule misses it.
  it('resolves a relative specifier against the importing file', () => {
    expect(candidatePathsFor('./seed/seed', CONFIG_PATH)).toContain('src/seed/seed.ts')
  })

  it('climbs out of a directory for a parent-relative specifier', () => {
    expect(candidatePathsFor('../seed', 'src/config/payload.config.ts')).toContain('src/seed.ts')
  })

  it('offers the barrel as a candidate', () => {
    expect(candidatePathsFor('@/seed', CONFIG_PATH)).toContain('src/seed/index.ts')
  })

  it('names nothing for a package specifier', () => {
    expect(candidatePathsFor('payload', CONFIG_PATH)).toEqual([])
  })

  // A configuration at the member root has no directory to resolve against.
  it('resolves a relative specifier from a file that sits at the root', () => {
    expect(candidatePathsFor('./seed', 'payload.config.ts')).toContain('seed.ts')
  })

  it('collapses a redundant current-directory segment', () => {
    expect(candidatePathsFor('././seed', CONFIG_PATH)).toContain('src/seed.ts')
  })
})

describe('exportedBodyIn', () => {
  it('reads the body of an exported function declaration', () => {
    const source: string = 'export async function seed(payload) { await payload.create({}) }'
    expect(exportedBodyIn(source, 'seed')).toContain('create')
  })

  it('reads the body of an exported arrow constant', () => {
    const source: string = 'export const seed = async (payload) => { await payload.create({}) }'
    expect(exportedBodyIn(source, 'seed')).toContain('create')
  })

  it('is undefined for a binding the module does not export', () => {
    expect(exportedBodyIn('export const other = 1', 'seed')).toBeUndefined()
  })

  // An export that opens no body at all: the declaration matches, and there is nothing to read.
  it('is undefined for an export that opens no body', () => {
    expect(exportedBodyIn('export const seed = 1', 'seed')).toBeUndefined()
  })
})

describe('findBootstrapWrites', () => {
  // The repaired shape: a hook may repair what is missing, and a read is how it finds out.
  it('accepts a hook that only reads', () => {
    const config: string = configWith(
      'async (payload) => { await payload.find({ collection: "users", depth: 0, limit: 1 }) }',
    )
    expect(rulesOf([file(CONFIG_PATH, config)])).toEqual([])
  })

  it('accepts a configuration that declares no hook', () => {
    expect(rulesOf([file(CONFIG_PATH, 'export default buildConfig({ collections: [] })')])).toEqual(
      [],
    )
  })

  it('reports a write the hook performs itself', () => {
    const config: string = configWith('async (payload) => { await payload.updateGlobal({}) }')
    expect(rulesOf([file(CONFIG_PATH, config)])).toEqual(['no-boot-time-writes'])
  })

  // The shape a real project shipped: the hook calls an imported function that writes in its own body.
  it('reports a write the hook reaches in one call', () => {
    const config: string = [
      "import { seedContent } from './seed/seed'",
      configWith('async (payload) => { await seedContent(payload) }'),
    ].join('\n')
    const seed: string =
      'export async function seedContent(payload) { await payload.updateGlobal({}) }'
    expect(rulesOf([file(CONFIG_PATH, config), file('src/seed/seed.ts', seed)])).toEqual([
      'no-boot-time-writes',
    ])
  })

  it('names the reached function and its module, so the finding is actionable', () => {
    const config: string = [
      "import { seedContent } from './seed/seed'",
      configWith('async (payload) => { await seedContent(payload) }'),
    ].join('\n')
    const seed: string =
      'export async function seedContent(payload) { await payload.updateGlobal({}) }'
    const found: readonly LocatedViolation[] = findBootstrapWrites([
      file(CONFIG_PATH, config),
      file('src/seed/seed.ts', seed),
    ])
    expect(found[0]?.violation.reason).toContain('seedContent')
    expect(found[0]?.violation.reason).toContain('./seed/seed')
  })

  it('reports against the configuration that schedules the write, not the module that performs it', () => {
    const config: string = [
      "import { seedContent } from './seed/seed'",
      configWith('async (payload) => { await seedContent(payload) }'),
    ].join('\n')
    const seed: string =
      'export async function seedContent(payload) { await payload.updateGlobal({}) }'
    const found: readonly LocatedViolation[] = findBootstrapWrites([
      file(CONFIG_PATH, config),
      file('src/seed/seed.ts', seed),
    ])
    expect(found[0]?.path).toBe(CONFIG_PATH)
  })

  // A seed that writes two globals performs one operation twice. The repair is one change, so the
  // finding is one line - the real configuration this rule was written for writes exactly this way.
  it('reports one finding for a body that performs the same operation twice', () => {
    const config: string = [
      "import { seedContent } from './seed/seed'",
      configWith('async (payload) => { await seedContent(payload) }'),
    ].join('\n')
    const seed: string = [
      'export async function seedContent(payload) {',
      '  await payload.updateGlobal({ slug: "navigation" })',
      '  await payload.updateGlobal({ slug: "configuration" })',
      '}',
    ].join('\n')
    expect(rulesOf([file(CONFIG_PATH, config), file('src/seed/seed.ts', seed)])).toEqual([
      'no-boot-time-writes',
    ])
  })

  it('accepts a reached function whose body only reads', () => {
    const config: string = [
      "import { warm } from './seed/seed'",
      configWith('async (payload) => { await warm(payload) }'),
    ].join('\n')
    const seed: string = 'export async function warm(payload) { await payload.find({}) }'
    expect(rulesOf([file(CONFIG_PATH, config), file('src/seed/seed.ts', seed)])).toEqual([])
  })

  // A module may hold a writer the hook never calls; only the export it reaches is judged.
  it('does not report an unrelated writer the hook never calls', () => {
    const config: string = [
      "import { warm } from './seed/seed'",
      configWith('async (payload) => { await warm(payload) }'),
    ].join('\n')
    const seed: string = [
      'export async function warm(payload) { await payload.find({}) }',
      'export async function reset(payload) { await payload.updateGlobal({}) }',
    ].join('\n')
    expect(rulesOf([file(CONFIG_PATH, config), file('src/seed/seed.ts', seed)])).toEqual([])
  })

  it('says nothing when the imported module is not one of this member files', () => {
    const config: string = [
      "import { seedContent } from 'some-plugin'",
      configWith('async (payload) => { await seedContent(payload) }'),
    ].join('\n')
    expect(rulesOf([file(CONFIG_PATH, config)])).toEqual([])
  })

  it('ignores a hook written inside a comment', () => {
    const config: string = '// onInit: async (payload) => { await payload.updateGlobal({}) }'
    expect(rulesOf([file(CONFIG_PATH, config)])).toEqual([])
  })
})
