// Whether every collection and global in a BUILT Payload configuration decides its own access.
//
// The static rule in payload-access.ts reads the access block a project wrote, and it can only read what
// the project wrote. Payload builds collections the project never writes: the folder tree behind
// `folders`, the job queue behind `jobs`, the saved filters behind `queryPresets`, and whatever a plugin
// adds. Each arrives with the access Payload gives an undeclared operation, `defaultAccess`, which admits
// every signed-in user to every operation. The anonymous sweep cannot see that either, because a
// signed-in stakeholder is not anonymous. So a probe imports the built configuration and reports, per
// entity, which operations still carry that function; this module decides what the report means.
//
// Payload's own bookkeeping keeps the default on purpose, and those entities are exempt by name here,
// with the reason each. No project setting widens the list: a rule a project can edit is not a rule, and
// the repair is always available - write the access explicitly, through the override the framework
// offers for the entity it built.
import { asRecord, asText, isArray, isRecord, readKey } from './json-shapes.js'

/** The operations a collection must decide; the static rule holds a written config to the same list. */
export const COLLECTION_OPERATIONS: readonly string[] = ['create', 'read', 'update', 'delete']

/** The operations a global must decide. */
export const GLOBAL_OPERATIONS: readonly string[] = ['read', 'update']

/**
 * The prefix the probe prints its report behind. A plugin may log on import, and a line the parser can
 * name is what separates the report from that chatter.
 */
export const INHERITED_ACCESS_REPORT_MARKER: string = 'ploaness-inherited-access:'

/** One entity of the built configuration and the operations it left to Payload's default. */
export interface InheritedAccessEntry {
  readonly slug: string
  readonly inherited: readonly string[]
}

/** What the probe reports: every collection and every global, decided ones included. */
export interface InheritedAccessReport {
  readonly collections: readonly InheritedAccessEntry[]
  readonly globals: readonly InheritedAccessEntry[]
}

/** The two kinds of entity a Payload configuration holds. */
export type PayloadSubjectKind = 'collection' | 'global'

/** One entity Payload builds for its own bookkeeping, which keeps the default access by design. */
export interface ExemptPayloadSubject {
  readonly kind: PayloadSubjectKind
  readonly slug: string
  readonly reason: string
}

/** The entities exempt from the rule, each with the reason. Nothing a project declares extends this. */
export const EXEMPT_PAYLOAD_SUBJECTS: readonly ExemptPayloadSubject[] = [
  {
    kind: 'collection',
    slug: 'payload-locked-documents',
    reason:
      'the document-lock ledger, which declares the default deliberately so that any signed-in editor ' +
      'can hold and release a lock',
  },
  {
    kind: 'collection',
    slug: 'payload-preferences',
    reason:
      'per-user admin preferences; Payload scopes read and delete to the owner, and leaves create and ' +
      'update to the default on purpose',
  },
  {
    kind: 'collection',
    slug: 'payload-migrations',
    reason:
      'the migration ledger, with no endpoint and no GraphQL surface; only the framework writes it',
  },
  {
    kind: 'global',
    slug: 'payload-jobs-stats',
    reason:
      'the scheduling counters Payload keeps beside the job queue; the framework offers no override ' +
      'for it, so no explicit access can be written, and the queue it counts is judged',
  },
]

// Where the framework lets a project decide the access of an entity it built. Anything else is either
// the project's own collection, which has an access block, or a plugin's, which has an override option.
const FRAMEWORK_REPAIRS: Readonly<Record<string, string>> = {
  'payload-folders': 'folders.collectionOverrides',
  'payload-jobs': 'jobs.jobsCollectionOverrides',
}

const isExempt = (kind: PayloadSubjectKind, slug: string): boolean =>
  EXEMPT_PAYLOAD_SUBJECTS.some(
    (subject: ExemptPayloadSubject): boolean => subject.kind === kind && subject.slug === slug,
  )

const repairFor = (slug: string, pronoun: string): string => {
  const framework: string | undefined = FRAMEWORK_REPAIRS[slug]
  return framework === undefined
    ? `decide ${pronoun} in its access block, or in the override its plugin offers`
    : `decide ${pronoun} in ${framework}`
}

const describeInherited = (kind: PayloadSubjectKind, entry: InheritedAccessEntry): string => {
  const pronoun: string = entry.inherited.length === 1 ? 'it' : 'them'
  return (
    `${kind} "${entry.slug}" leaves ${entry.inherited.join(', ')} to Payload's default access, ` +
    `which admits every signed-in user; ${repairFor(entry.slug, pronoun)}`
  )
}

const judge = (
  kind: PayloadSubjectKind,
  entries: readonly InheritedAccessEntry[],
): readonly string[] =>
  entries
    .filter(
      (entry: InheritedAccessEntry): boolean =>
        entry.inherited.length > 0 && !isExempt(kind, entry.slug),
    )
    .map((entry: InheritedAccessEntry): string => describeInherited(kind, entry))

/**
 * Every entity of the built configuration that still carries Payload's default access on a judged
 * operation, in configuration order, each naming where the project decides it.
 * @param report what the probe read from the built configuration.
 * @returns one finding per entity, or nothing when every entity decides its access.
 */
export const findInheritedAccess = (report: InheritedAccessReport): readonly string[] => [
  ...judge('collection', report.collections),
  ...judge('global', report.globals),
]

const asEntry = (raw: unknown): InheritedAccessEntry | undefined => {
  if (!isRecord(raw)) {
    return undefined
  }
  const slug: unknown = raw['slug']
  const inherited: unknown = raw['inherited']
  if (typeof slug !== 'string' || !isArray(inherited)) {
    return undefined
  }
  return inherited.every((operation: unknown): boolean => typeof operation === 'string')
    ? { slug, inherited: inherited.map((operation: unknown): string => asText(operation)) }
    : undefined
}

const asEntries = (raw: unknown): readonly InheritedAccessEntry[] | undefined => {
  if (!isArray(raw)) {
    return undefined
  }
  const entries: readonly (InheritedAccessEntry | undefined)[] = raw.map((entry: unknown) =>
    asEntry(entry),
  )
  return entries.every(
    (entry: InheritedAccessEntry | undefined): entry is InheritedAccessEntry => entry !== undefined,
  )
    ? entries
    : undefined
}

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/**
 * Read the probe's report out of everything the probe wrote to standard output.
 *
 * The LAST marker line is the report, so a plugin that logs during import cannot hide it, and a report
 * that fails to parse or has the wrong shape is undefined rather than empty: a probe that printed a
 * stack trace must fail the gate, never pass it as "no findings".
 * @param text the probe's standard output.
 * @returns the report, or undefined when no well-formed report was printed.
 */
export const parseInheritedAccessReport = (text: string): InheritedAccessReport | undefined => {
  const line: string | undefined = text
    .split('\n')
    .map((candidate: string): string => candidate.trim())
    .findLast((candidate: string): boolean => candidate.startsWith(INHERITED_ACCESS_REPORT_MARKER))
  if (line === undefined) {
    return undefined
  }
  const parsed: unknown = parseJson(line.slice(INHERITED_ACCESS_REPORT_MARKER.length))
  const collections: readonly InheritedAccessEntry[] | undefined = asEntries(
    readKey(parsed, 'collections'),
  )
  const globals: readonly InheritedAccessEntry[] | undefined = asEntries(readKey(parsed, 'globals'))
  return collections === undefined || globals === undefined ? undefined : { collections, globals }
}

/** Where a Payload member keeps its configuration when its tsconfig says nothing else. */
export const DEFAULT_PAYLOAD_CONFIG_PATH: string = 'src/payload.config.ts'

const CURRENT_DIRECTORY_PREFIX: string = './'

/**
 * The path of the Payload configuration a member's tsconfig aliases as `@payload-config`, which is the
 * alias `ploaness init` writes and Payload's own CLI resolves through.
 * @param tsconfig the parsed tsconfig, or anything when it could not be read.
 * @returns the configured path relative to the member root, or the default path.
 */
export const payloadConfigPathOf = (tsconfig: unknown): string => {
  const paths: Record<string, unknown> = asRecord(
    readKey(readKey(tsconfig, 'compilerOptions'), 'paths'),
  )
  const alias: unknown = paths['@payload-config']
  const first: unknown = isArray(alias) ? alias[0] : undefined
  if (typeof first !== 'string' || first.length === 0) {
    return DEFAULT_PAYLOAD_CONFIG_PATH
  }
  return first.startsWith(CURRENT_DIRECTORY_PREFIX)
    ? first.slice(CURRENT_DIRECTORY_PREFIX.length)
    : first
}
