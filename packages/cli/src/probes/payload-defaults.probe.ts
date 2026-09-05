// The half of the `payload-defaults` gate that runs inside the project: it imports the project's built
// Payload configuration and reports which operations of which entities still carry Payload's own
// `defaultAccess`. It is spawned by the gate through tsx, with the project root as its working directory
// so that `payload` and the configuration's own imports resolve from the project, and it prints one
// marker-prefixed JSON line that the gate parses. What the report MEANS is decided in
// `@ploaness/governance`; this file only reads.
//
// It also asks every drafts-enabled entity's read rule what it answers a caller with no credentials.
// That is the one place the harness CALLS a project's function rather than inspecting it, and it is
// deliberate: the constraint a read returns is the half `/api/access` reports and the anonymous sweep
// never opens, so there is nowhere else to see it. The call is confined to entities that keep drafts,
// it is awaited so a legitimately asynchronous rule is not punished for being one, and a rule that
// throws is reported as undecidable rather than assumed safe. The harness already requires an access
// decision to be a pure function of the values it is handed, which is the shape this relies on.
//
// Two arguments, both absolute: the configuration file, and Payload's `dist/auth/defaultAccess.js`.
// Identity is judged by reference first and by source text second, because a loader can register the
// same module twice under two URLs and a project function cannot be byte-identical to Payload's by
// accident. Nothing here imports `payload` by name: the harness never depends on it, and the copy that
// matters is the one the project installed.
import { pathToFileURL } from 'node:url'
import {
  type AnonymousRead,
  accessOperationsFor,
  type DraftReadEntry,
  INHERITED_ACCESS_REPORT_MARKER,
  type InheritedAccessEntry,
  type InheritedAccessReport,
  isArray,
  isRecord,
  type PayloadSubjectKind,
  QUERY_PRESETS_SLUG,
  readKey,
} from '@ploaness/governance'

// node, the probe, then the two paths.
const ARGUMENT_OFFSET: number = 2
const [configFile, defaultAccessFile] = process.argv.slice(ARGUMENT_OFFSET)
if (configFile === undefined || defaultAccessFile === undefined) {
  throw new Error('usage: payload-defaults.probe.js <payload.config.ts> <defaultAccess.js>')
}

const defaultAccessModule: unknown = await import(pathToFileURL(defaultAccessFile).href)
const defaultAccess: unknown = readKey(defaultAccessModule, 'defaultAccess')
if (typeof defaultAccess !== 'function') {
  throw new TypeError(`Payload's default access could not be established from ${defaultAccessFile}`)
}
const defaultAccessSource: string = String(defaultAccess)

// Undeclared counts as inherited, and not only as a convenience. `executeAccess` runs the rule it is
// given and, handed nothing, falls through to `if (req.user) return true` - so a missing rule is not an
// absent permission but an open one, indistinguishable at runtime from Payload's own default. Payload
// fills every operation but `readVersions` in during sanitisation, which is the one this reaches.
const isInherited = (rule: unknown): boolean =>
  rule === undefined ||
  rule === defaultAccess ||
  (typeof rule === 'function' && String(rule) === defaultAccessSource)

const configModule: unknown = await import(pathToFileURL(configFile).href)
// Awaited either way: `buildConfig` returns a promise, and a configuration handed over as a plain
// object is read the same.
const config: unknown = await readKey(configModule, 'default')
const collections: unknown = readKey(config, 'collections')
const globals: unknown = readKey(config, 'globals')
if (!(isArray(collections) && isArray(globals))) {
  throw new Error(`the default export of ${configFile} is not a built Payload configuration`)
}

// Which operations an entity owes depends on what it is, and sanitisation is what makes that legible:
// `auth` survives as an object on an auth collection and as `false` elsewhere, and `versions` survives
// as an object where it is enabled and is deleted where it is not. Both reads are therefore about the
// built object rather than the source the project wrote.
// The access a project decided, which for one collection is not the access the collection carries.
// Payload builds the query-presets collection's rules itself, wrapping each operation in a closure that
// falls back to its own default, so the wrapper is never the default this probe recognises; the block
// the project wrote sits on the configuration instead. See QUERY_PRESETS_SLUG for what that hides.
const accessOf = (entity: unknown, slug: string): unknown =>
  readKey(slug === QUERY_PRESETS_SLUG ? readKey(config, 'queryPresets') : entity, 'access')

const entryOf = (entity: unknown, kind: PayloadSubjectKind): InheritedAccessEntry => {
  const slug: string = String(readKey(entity, 'slug'))
  const access: unknown = accessOf(entity, slug)
  const operations: readonly string[] = accessOperationsFor({
    kind,
    hasAuth: Boolean(readKey(entity, 'auth')),
    hasVersions: Boolean(readKey(entity, 'versions')),
  })
  return {
    slug,
    inherited: operations.filter((operation: string): boolean =>
      isInherited(readKey(access, operation)),
    ),
  }
}

// What Payload hands an access rule, cut down to the half a read of a stranger's turns on. A rule that
// reaches for anything else throws, and a throw is reported rather than read as a denial.
type AccessRule = (arguments_: { readonly req: { readonly user: null } }) => unknown

const hasDrafts = (entity: unknown): boolean =>
  Boolean(readKey(readKey(entity, 'versions'), 'drafts'))

// A predicate rather than an assertion, for the reason `isArray` is one: calling a value narrowed only
// to `Function` hands back `any`, and an assertion is what type coverage counts against the harness.
const isAccessRule = (value: unknown): value is AccessRule => typeof value === 'function'

const anonymousReadOf = async (entity: unknown): Promise<AnonymousRead> => {
  const rule: unknown = readKey(readKey(entity, 'access'), 'read')
  if (!isAccessRule(rule)) {
    // An undeclared read is Payload's own default, which the inherited half of this report names.
    return { kind: 'denied' }
  }
  try {
    const answer: unknown = await rule({ req: { user: null } })
    if (answer === true) {
      return { kind: 'open' }
    }
    return isRecord(answer) ? { kind: 'filtered', where: answer } : { kind: 'denied' }
  } catch (error: unknown) {
    return {
      kind: 'undecidable',
      reason: error instanceof Error ? error.message : String(error),
    }
  }
}

const draftReadsOf = async (
  entities: readonly unknown[],
  kind: PayloadSubjectKind,
): Promise<readonly DraftReadEntry[]> =>
  await Promise.all(
    entities
      .filter((entity: unknown): boolean => hasDrafts(entity))
      .map(async (entity: unknown): Promise<DraftReadEntry> => {
        const anonymousRead: AnonymousRead = await anonymousReadOf(entity)
        return { kind, slug: String(readKey(entity, 'slug')), anonymousRead }
      }),
  )

const report: InheritedAccessReport = {
  collections: collections.map(
    (collection: unknown): InheritedAccessEntry => entryOf(collection, 'collection'),
  ),
  draftReads: [
    ...(await draftReadsOf(collections, 'collection')),
    ...(await draftReadsOf(globals, 'global')),
  ],
  globals: globals.map((global: unknown): InheritedAccessEntry => entryOf(global, 'global')),
}

process.stdout.write(`${INHERITED_ACCESS_REPORT_MARKER}${JSON.stringify(report)}\n`)
// The exit code rather than `process.exit()`, for the reason bin.ts states: the report is flushed
// before the process ends. A plugin that keeps a handle open after import holds the process until the
// gate's own timeout, which then reports it as a build that did not finish rather than as a pass.
process.exitCode = 0
