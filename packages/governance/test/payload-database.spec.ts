import { describe, expect, it } from 'vitest'
import {
  declaredMigrationDirectoryIn,
  declaresPushingAdapter,
  type FoundRootConfig,
  findMissingMigrations,
  findUnreviewedSchemaPush,
  isMigrationFile,
  type MigrationEvidence,
  migrationDirectoriesFor,
  rootConfigsIn,
} from '../src/payload-database.js'
import type { PayloadViolation } from '../src/payload-source.js'

const configWith = (database: string): string =>
  ['export default buildConfig({', '  collections: [Users],', `  db: ${database},`, '})'].join('\n')

const rulesOf = (source: string): readonly string[] =>
  findUnreviewedSchemaPush(source).map((violation: PayloadViolation): string => violation.rule)

const evidence = (overrides: Partial<MigrationEvidence> = {}): MigrationEvidence => ({
  declaresPushingAdapter: true,
  directories: [{ path: 'src/migrations', names: ['20260101_initial.ts'] }],
  ...overrides,
})

describe('rootConfigsIn', () => {
  it('reads the body of a root configuration call', () => {
    const found: readonly FoundRootConfig[] = rootConfigsIn(
      configWith('postgresAdapter({ push: false })'),
    )
    expect(found).toHaveLength(1)
    expect(found[0]?.body).toContain('collections')
  })

  it('reports the line the call begins on', () => {
    expect(rootConfigsIn(configWith('postgresAdapter({ push: false })'))[0]?.line).toBe(1)
  })

  it('finds nothing in a file that declares no root configuration', () => {
    expect(rootConfigsIn('export const value = 1')).toEqual([])
  })

  it('finds nothing when the call takes something other than an object literal', () => {
    expect(rootConfigsIn('export default buildConfig(shared)')).toEqual([])
  })

  it('finds nothing when the call is never closed', () => {
    expect(rootConfigsIn('export default buildConfig({ collections: [')).toEqual([])
  })
})

describe('findUnreviewedSchemaPush', () => {
  // The repaired shape, which must stay clean: the whole rule exists to be switched off by this.
  it('accepts an adapter that disables push', () => {
    expect(rulesOf(configWith('postgresAdapter({ pool: { url }, push: false })'))).toEqual([])
  })

  it('reports an adapter that enables push', () => {
    expect(rulesOf(configWith('postgresAdapter({ pool: { url }, push: true })'))).toEqual([
      'no-unreviewed-schema-push',
    ])
  })

  // Undeclared is the dangerous spelling: Payload's own guard is `this.push !== false`.
  it('reports an adapter that declares no push at all', () => {
    expect(rulesOf(configWith('postgresAdapter({ pool: { url } })'))).toEqual([
      'no-unreviewed-schema-push',
    ])
  })

  it('does not read a push nested inside the pool as the adapter own setting', () => {
    expect(rulesOf(configWith('postgresAdapter({ pool: { push: false } })'))).toEqual([
      'no-unreviewed-schema-push',
    ])
  })

  it('says nothing about an adapter that carries no push to disable', () => {
    expect(rulesOf(configWith('mongooseAdapter({ url })'))).toEqual([])
  })

  it('says nothing about a configuration that declares no database', () => {
    expect(rulesOf('export default buildConfig({ collections: [Users] })')).toEqual([])
  })

  it('says nothing when the database value is not a call', () => {
    expect(rulesOf(configWith('sharedAdapter'))).toEqual([])
  })

  it('names the declared value in the finding, so the repair is unambiguous', () => {
    const findings: readonly PayloadViolation[] = findUnreviewedSchemaPush(
      configWith('postgresAdapter({ push: true })'),
    )
    expect(findings[0]?.reason).toContain('push: true')
    expect(findings[0]?.reason).toContain('migrate:create')
  })
})

describe('declaresPushingAdapter', () => {
  it('recognises a configuration whose adapter can push', () => {
    expect(declaresPushingAdapter(configWith('postgresAdapter({ push: false })'))).toBe(true)
  })

  it('does not recognise an adapter that cannot', () => {
    expect(declaresPushingAdapter(configWith('mongooseAdapter({ url })'))).toBe(false)
  })
})

describe('declaredMigrationDirectoryIn', () => {
  // Read from the raw options rather than the depth-one slice: the scan jumps a string literal whole,
  // so a quoted value never reaches the slice at all.
  it('reads a directory the adapter names', () => {
    expect(
      declaredMigrationDirectoryIn(
        configWith("postgresAdapter({ push: false, migrationDir: 'db/changes' })"),
      ),
    ).toBe('db/changes')
  })

  it('reads a directory declared as the only option', () => {
    expect(
      declaredMigrationDirectoryIn(configWith('postgresAdapter({ migrationDir: "db/changes" })')),
    ).toBe('db/changes')
  })

  it('is undefined when the adapter leaves the directory to Payload', () => {
    expect(
      declaredMigrationDirectoryIn(configWith('postgresAdapter({ push: false })')),
    ).toBeUndefined()
  })
})

describe('isMigrationFile', () => {
  it.each(['20260101_initial.ts', '20260101_initial.js'])('reads %s as a migration', (name) => {
    expect(isMigrationFile(name)).toBe(true)
  })

  // Payload's own reader skips the barrel, so a directory holding only one records no schema.
  it.each(['index.ts', 'index.js', 'README.md'])('does not read %s as a migration', (name) => {
    expect(isMigrationFile(name)).toBe(false)
  })
})

describe('migrationDirectoriesFor', () => {
  it('puts a declared directory before the ones Payload would try', () => {
    expect(migrationDirectoriesFor('db/changes')[0]).toBe('db/changes')
  })

  it('offers the candidates alone when nothing is declared', () => {
    expect(migrationDirectoriesFor(undefined)).toContain('src/migrations')
  })
})

describe('findMissingMigrations', () => {
  it('accepts a member whose directory holds a migration', () => {
    expect(findMissingMigrations(evidence())).toEqual([])
  })

  it('reports a member whose candidate directories are all absent', () => {
    expect(findMissingMigrations(evidence({ directories: [] }))).toHaveLength(1)
  })

  it('reports a directory that holds only a barrel', () => {
    const only: MigrationEvidence = evidence({
      directories: [{ path: 'src/migrations', names: ['index.ts'] }],
    })
    expect(findMissingMigrations(only)[0]).toContain('migrate:create')
  })

  it('says nothing about a member that declares no pushing adapter', () => {
    expect(
      findMissingMigrations(evidence({ declaresPushingAdapter: false, directories: [] })),
    ).toEqual([])
  })
})
