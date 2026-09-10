// Whether a project's schema changes are recorded where a reader can review them.
//
// Payload's Postgres adapter can apply a schema by pushing it: at boot, it diffs the configuration
// against the live database and issues whatever closes the gap. Nothing is written down, so there is no
// artefact to review before it runs and none to roll back after. The guard Payload applies is
// `this.push !== false`, which is why an UNDECLARED push is the dangerous spelling rather than a neutral
// one, and why this rule reports it.
//
// Push is also skipped where `NODE_ENV` is production, and a production boot then falls to
// `prodMigrations`. A project that pushes instead of migrating therefore has no mechanism that creates
// its schema in production at all, which is the second rule here.
//
// The value is read from SOURCE rather than from the built configuration. `postgresAdapter()` returns a
// factory whose `init` closure carries `push`, and Payload calls that closure at `payload.init()`, not
// during `buildConfig`. A probe that imports the built configuration reads `undefined` for every project
// and would pass every defect.
import { depthOneValue, type PayloadViolation } from './payload-source.js'
import { balancedArguments, lineOf, occurrences, topLevelSlice } from './source-text.js'

/** One `buildConfig({ ... })` literal: its brace-wrapped body, and the line the call begins on. */
export interface FoundRootConfig {
  readonly body: string
  readonly line: number
}

const BUILD_CONFIG_CALL: string = 'buildConfig('

/**
 * Every root configuration literal the source declares.
 *
 * The collection and global readers key on a type marker, which the root configuration does not carry:
 * it is an argument to a call rather than an annotated declaration. So this reads the call instead.
 * @param code the file's text, with comments already stripped.
 * @returns one entry per `buildConfig` call whose argument is an object literal.
 */
export const rootConfigsIn = (code: string): readonly FoundRootConfig[] =>
  occurrences(code, BUILD_CONFIG_CALL).flatMap((found: number): readonly FoundRootConfig[] => {
    const argumentText: string | undefined = balancedArguments(
      code,
      found + BUILD_CONFIG_CALL.length - 1,
    )
    return argumentText?.trimStart().startsWith('{') === true
      ? [{ body: argumentText, line: lineOf(code, found) }]
      : []
  })

/**
 * The database adapters whose schema Payload can apply by pushing it.
 *
 * Only the adapter whose behaviour is established belongs here. Naming one that does not carry the
 * option would report a project for failing to disable something it never had, and an adapter left out
 * is merely unreported - the safe direction of the two.
 */
export const PUSHING_ADAPTERS: readonly string[] = ['postgresAdapter']

/** The call a `db` value makes: the adapter's name, and its own argument text. */
interface AdapterCall {
  readonly name: string
  readonly options: string
}

const ADAPTER_CALL: RegExp = /^\s*([a-z_$][\w$]*)\s*\(/i

const adapterCallIn = (databaseValue: string): AdapterCall | undefined => {
  const matched: RegExpExecArray | null = ADAPTER_CALL.exec(databaseValue)
  if (matched === null) {
    return undefined
  }
  const options: string | undefined = balancedArguments(databaseValue, matched[0].length - 1)
  return options === undefined ? undefined : { name: matched[1] ?? '', options }
}

// `push` is read from the depth-one text of the adapter's own options, so a key nested inside `pool`
// cannot be mistaken for the adapter's own - the protection `topLevelSlice` exists to give.
//
// `migrationDir` cannot be read the same way, and that is a property of the scan rather than an
// oversight: the walk jumps a string literal whole, so the fold never sees the quoted value and the
// slice a quoted value would land in comes back empty. It is therefore read from the raw options, where
// the key boundary alone separates it from a value nested beneath. `push` is unaffected because `false`
// is not a string literal and survives the slice intact.
const PUSH_PROPERTY: RegExp = /(?:^|,)\s*push\s*:\s*([^,]*)/
const MIGRATION_DIR_PROPERTY: RegExp = /(?:^|[{,])\s*migrationDir\s*:\s*['"]([^'"]*)['"]/

const declaredPushIn = (options: string): string | undefined =>
  PUSH_PROPERTY.exec(topLevelSlice(options))?.[1]?.trim()

/** The rule name a schema-push finding carries. */
export const SCHEMA_PUSH_RULE: string = 'no-unreviewed-schema-push'

const REPAIR: string = 'set push: false and record the schema with `payload migrate:create`'

const pushReason = (adapter: string, declared: string | undefined): string =>
  declared === undefined
    ? `${adapter} declares no push; Payload treats an undeclared push as on, so it rewrites the ` +
      'schema at every boot outside production and no committed artefact records what the schema ' +
      `became - ${REPAIR}`
    : `${adapter} sets push: ${declared}; Payload rewrites the schema at every boot outside ` +
      `production and no committed artefact records what the schema became - ${REPAIR}`

// The adapter a configuration's `db` names, when it is one that can push. Shared by every rule here, so
// the question "does this project push?" is answered in one place.
const pushingAdapterIn = (body: string): AdapterCall | undefined => {
  const databaseValue: string | undefined = depthOneValue(body, 'db')
  if (databaseValue === undefined) {
    return undefined
  }
  const adapter: AdapterCall | undefined = adapterCallIn(databaseValue)
  return adapter !== undefined && PUSHING_ADAPTERS.includes(adapter.name) ? adapter : undefined
}

/**
 * Report a root configuration whose database adapter does not disable schema push.
 * @param code the file's text, with comments already stripped.
 * @returns one violation per configuration that pushes, declared or by omission.
 */
export const findUnreviewedSchemaPush = (code: string): readonly PayloadViolation[] =>
  rootConfigsIn(code).flatMap((config: FoundRootConfig): readonly PayloadViolation[] => {
    const adapter: AdapterCall | undefined = pushingAdapterIn(config.body)
    if (adapter === undefined) {
      return []
    }
    const declared: string | undefined = declaredPushIn(adapter.options)
    return declared === 'false'
      ? []
      : [
          {
            line: config.line,
            rule: SCHEMA_PUSH_RULE,
            reason: pushReason(adapter.name, declared),
          },
        ]
  })

/**
 * Whether a source declares a database adapter whose schema is applied by push.
 * @param code the file's text, with comments already stripped.
 * @returns true when at least one root configuration names such an adapter.
 */
export const declaresPushingAdapter = (code: string): boolean =>
  rootConfigsIn(code).some(
    (config: FoundRootConfig): boolean => pushingAdapterIn(config.body) !== undefined,
  )

/**
 * The migration directory a configuration names, when it names one.
 * @param code the file's text, with comments already stripped.
 * @returns the declared directory, or undefined when the adapter leaves it to Payload's default.
 */
export const declaredMigrationDirectoryIn = (code: string): string | undefined =>
  rootConfigsIn(code)
    .map((config: FoundRootConfig): string | undefined => {
      const adapter: AdapterCall | undefined = pushingAdapterIn(config.body)
      return adapter === undefined ? undefined : MIGRATION_DIR_PROPERTY.exec(adapter.options)?.[1]
    })
    .find((declared: string | undefined): declared is string => declared !== undefined)

/** The directories Payload looks in, in the order its own resolver tries them. */
export const MIGRATION_DIRECTORY_CANDIDATES: readonly string[] = [
  'src/migrations',
  'dist/migrations',
  'migrations',
]

const MIGRATION_EXTENSIONS: readonly string[] = ['.ts', '.js']
const BARRELS: ReadonlySet<string> = new Set(['index.ts', 'index.js'])

/**
 * Whether a file name is one Payload reads as a migration.
 *
 * Taken from Payload's own reader rather than invented here: a `.ts` or `.js` file that is not the
 * barrel. An empty directory, or one holding only a barrel, records no schema - and that is exactly the
 * distinction a project would otherwise satisfy the rule with.
 * @param name the file's base name.
 * @returns true when Payload would read it as a migration.
 */
export const isMigrationFile = (name: string): boolean =>
  MIGRATION_EXTENSIONS.some((extension: string): boolean => name.endsWith(extension)) &&
  !BARRELS.has(name)

/**
 * The directories to read for a member, the declared one first.
 * @param declared the directory the configuration names, when it names one.
 * @returns the candidate paths, relative to the member root.
 */
export const migrationDirectoriesFor = (declared: string | undefined): readonly string[] =>
  declared === undefined
    ? MIGRATION_DIRECTORY_CANDIDATES
    : [declared, ...MIGRATION_DIRECTORY_CANDIDATES]

/** One candidate directory as the gate found it: its path, and the entries it holds. */
export interface MigrationDirectory {
  readonly path: string
  readonly names: readonly string[]
}

/** What the gate read about where a member's schema would come from. */
export interface MigrationEvidence {
  readonly declaresPushingAdapter: boolean
  readonly directories: readonly MigrationDirectory[]
}

/** The rule name a missing-migration finding carries. */
export const RECORDED_MIGRATIONS_RULE: string = 'require-recorded-migrations'

const MISSING_MIGRATIONS: string =
  `[${RECORDED_MIGRATIONS_RULE}] no migration is recorded; this member declares a database adapter ` +
  'whose schema is applied by push, and push is skipped where NODE_ENV is production - so a ' +
  'production boot creates nothing and no file in the repository states what the schema should be. ' +
  'Run `payload migrate:create` and commit the file it writes'

/**
 * Report a member that records no migration for the schema it expects.
 * @param evidence the adapter it declares, and the candidate directories as they were read.
 * @returns one finding when the member pushes and records nothing, or none.
 */
export const findMissingMigrations = (evidence: MigrationEvidence): readonly string[] => {
  if (!evidence.declaresPushingAdapter) {
    return []
  }
  const carriesMigration: boolean = evidence.directories.some(
    (directory: MigrationDirectory): boolean =>
      directory.names.some((name: string): boolean => isMigrationFile(name)),
  )
  return carriesMigration ? [] : [MISSING_MIGRATIONS]
}
