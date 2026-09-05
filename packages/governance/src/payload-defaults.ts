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

/** The operation an auth collection decides on top of the four: who may clear a locked account. */
export const UNLOCK_OPERATION: string = 'unlock'

/** The operation a versioned collection or global decides: who may read a stored version. */
export const READ_VERSIONS_OPERATION: string = 'readVersions'

/** What an entity of the built configuration is, as far as the operations it owes depend on it. */
export interface PayloadSubjectTraits {
  readonly kind: PayloadSubjectKind
  readonly hasAuth: boolean
  readonly hasVersions: boolean
}

/**
 * The access operations one entity owes a decision on. Two of them are conditional, and neither may be
 * added to the lists above: Payload writes `unlock` onto EVERY collection during sanitisation, auth or
 * not, so demanding it unconditionally would report the whole configuration, and `readVersions` means
 * nothing on an entity that keeps no versions.
 * @param traits what the entity is: its kind, and whether it authenticates or keeps versions.
 * @returns the operations that entity must decide, in the order they are reported.
 */
export const accessOperationsFor = (traits: PayloadSubjectTraits): readonly string[] => [
  ...(traits.kind === 'collection' ? COLLECTION_OPERATIONS : GLOBAL_OPERATIONS),
  ...(traits.kind === 'collection' && traits.hasAuth ? [UNLOCK_OPERATION] : []),
  ...(traits.hasVersions ? [READ_VERSIONS_OPERATION] : []),
]

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

/**
 * What a read rule answered an anonymous caller, as the probe observed it. `filtered` carries the
 * query constraint the rule returned, which is the half `/api/access` reports and the anonymous sweep
 * never opens; `undecidable` is a rule that threw when asked, which is reported rather than assumed
 * safe.
 */
export type AnonymousRead =
  | { readonly kind: 'denied' }
  | { readonly kind: 'filtered'; readonly where: unknown }
  | { readonly kind: 'open' }
  | { readonly kind: 'undecidable'; readonly reason: string }

/** One entity that keeps drafts, and what its read rule answers a caller with no credentials. */
export interface DraftReadEntry {
  readonly kind: PayloadSubjectKind
  readonly slug: string
  readonly anonymousRead: AnonymousRead
}

/** What the probe reports: every collection and every global, decided ones included. */
export interface InheritedAccessReport {
  readonly collections: readonly InheritedAccessEntry[]
  readonly draftReads: readonly DraftReadEntry[]
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

// The read a drafts-enabled entity grants a stranger.
//
// A draft is a document nobody has approved. Payload writes an unpublished save to the versions table
// and leaves the main row alone, so a document that has never been published carries `_status: 'draft'`
// in the row a plain list reads - which means an unconstrained read serves unapproved content through
// the ordinary endpoint, not only through `?draft=true`.
//
// The static rule in payload-access.ts can only catch the inline spelling `read: (): boolean => true`,
// and the shipped ESLint config forbids exactly that spelling in a config file, so a conforming project
// writes `read: someHelper` and the static rule is blind to it. The anonymous sweep is blind too: it
// separates a grant that carries a query constraint from one that does not, and never opens the
// constraint to see what it constrains. Between the two, a read filtered by audience but not by status
// passed everything. This is the rule that reads the constraint.

/** The status Payload stamps on the version that is live. */
const PUBLISHED_STATUS: string = 'published'

/** The field Payload adds to an entity that keeps drafts. */
const STATUS_FIELD: string = '_status'

const declaresPublished = (where: Record<string, unknown>): boolean => {
  const status: unknown = where[STATUS_FIELD]
  return isRecord(status) && status['equals'] === PUBLISHED_STATUS
}

/**
 * Whether a read filter admits published documents alone.
 *
 * A clause under `and` is enough on its own, because every conjunct holds. A clause under `or` counts
 * only when EVERY branch carries one, because a single branch without it is a way in - which is the
 * shape of the defect this rule exists for.
 * @param where the query constraint the read rule returned.
 * @returns whether every document the filter admits is a published one.
 */
export const requiresPublishedStatus = (where: unknown): boolean => {
  if (!isRecord(where)) {
    return false
  }
  if (declaresPublished(where)) {
    return true
  }
  const conjuncts: unknown = where['and']
  if (
    isArray(conjuncts) &&
    conjuncts.some((one: unknown): boolean => requiresPublishedStatus(one))
  ) {
    return true
  }
  const disjuncts: unknown = where['or']
  return (
    isArray(disjuncts) &&
    disjuncts.length > 0 &&
    disjuncts.every((one: unknown): boolean => requiresPublishedStatus(one))
  )
}

const DRAFT_READ_REPAIR: string =
  'a read that keeps unapproved work from a stranger either refuses them outright or filters on ' +
  `${STATUS_FIELD} equals ${PUBLISHED_STATUS}`

const describeDraftRead = (entry: DraftReadEntry): string | undefined => {
  const subject: string = `${entry.kind} "${entry.slug}" keeps drafts and`
  const read: AnonymousRead = entry.anonymousRead
  if (read.kind === 'open') {
    return (
      `${subject} grants an unconditional anonymous read, so every unapproved document in it is ` +
      `served to anyone; ${DRAFT_READ_REPAIR}`
    )
  }
  if (read.kind === 'undecidable') {
    return (
      `${subject} its read rule could not be decided from the request alone (${read.reason}); an ` +
      'access rule is a pure decision over the caller it is handed, so the harness can read it'
    )
  }
  if (read.kind === 'filtered' && !requiresPublishedStatus(read.where)) {
    return (
      `${subject} filters its anonymous read without constraining ${STATUS_FIELD}, so an ` +
      `unapproved document is served to anyone the filter admits; ${DRAFT_READ_REPAIR}`
    )
  }
  return undefined
}

/**
 * Every entity that keeps drafts and lets a stranger read something that was never approved, in
 * configuration order.
 * @param report what the probe read from the built configuration.
 * @returns one finding per entity, or nothing when no drafts read admits an unapproved document.
 */
export const findUnconstrainedDraftReads = (report: InheritedAccessReport): readonly string[] =>
  report.draftReads.flatMap((entry: DraftReadEntry): readonly string[] => {
    const finding: string | undefined = describeDraftRead(entry)
    return finding === undefined ? [] : [finding]
  })

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

const asAnonymousRead = (raw: unknown): AnonymousRead | undefined => {
  const kind: unknown = readKey(raw, 'kind')
  if (kind === 'denied') {
    return { kind }
  }
  if (kind === 'open') {
    return { kind }
  }
  if (kind === 'filtered') {
    return { kind, where: readKey(raw, 'where') }
  }
  return kind === 'undecidable' ? { kind, reason: asText(readKey(raw, 'reason')) } : undefined
}

const asDraftRead = (raw: unknown): DraftReadEntry | undefined => {
  const slug: unknown = readKey(raw, 'slug')
  const kind: unknown = readKey(raw, 'kind')
  const anonymousRead: AnonymousRead | undefined = asAnonymousRead(readKey(raw, 'anonymousRead'))
  if (typeof slug !== 'string' || anonymousRead === undefined) {
    return undefined
  }
  return kind === 'collection' || kind === 'global' ? { kind, slug, anonymousRead } : undefined
}

const asDraftReads = (raw: unknown): readonly DraftReadEntry[] | undefined => {
  if (!isArray(raw)) {
    return undefined
  }
  const entries: readonly (DraftReadEntry | undefined)[] = raw.map((entry: unknown) =>
    asDraftRead(entry),
  )
  return entries.every(
    (entry: DraftReadEntry | undefined): entry is DraftReadEntry => entry !== undefined,
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
  const draftReads: readonly DraftReadEntry[] | undefined = asDraftReads(
    readKey(parsed, 'draftReads'),
  )
  if (collections === undefined || globals === undefined || draftReads === undefined) {
    return undefined
  }
  return { collections, draftReads, globals }
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
