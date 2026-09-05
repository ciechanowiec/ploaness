import { describe, expect, it } from 'vitest'
import {
  type AnonymousRead,
  accessOperationsFor,
  COLLECTION_OPERATIONS,
  DEFAULT_PAYLOAD_CONFIG_PATH,
  EXEMPT_PAYLOAD_SUBJECTS,
  type ExemptPayloadSubject,
  findInheritedAccess,
  findUnconstrainedDraftReads,
  GLOBAL_OPERATIONS,
  INHERITED_ACCESS_REPORT_MARKER,
  type InheritedAccessReport,
  parseInheritedAccessReport,
  payloadConfigPathOf,
  QUERY_PRESETS_SLUG,
  requiresPublishedStatus,
} from '../src/payload-defaults.js'

const DECIDED: InheritedAccessReport = {
  collections: [
    { slug: 'users', inherited: [] },
    { slug: 'media', inherited: [] },
  ],
  draftReads: [],
  globals: [{ slug: 'header', inherited: [] }],
}

const reportOf = (line: string): string => `${INHERITED_ACCESS_REPORT_MARKER}${line}`

// Two of the operations are conditional, and both would be wrong as constants. Payload writes `unlock`
// onto every collection during sanitisation, auth or not, so asking for it unconditionally would report
// the whole configuration; `readVersions` means nothing where no version is kept.
describe('accessOperationsFor', () => {
  it('asks an ordinary collection for the four and nothing more', () => {
    expect(accessOperationsFor({ kind: 'collection', hasAuth: false, hasVersions: false })).toEqual(
      COLLECTION_OPERATIONS,
    )
  })

  it('asks an auth collection for unlock as well', () => {
    expect(accessOperationsFor({ kind: 'collection', hasAuth: true, hasVersions: false })).toEqual([
      ...COLLECTION_OPERATIONS,
      'unlock',
    ])
  })

  it('asks a versioned collection for the version read as well', () => {
    expect(accessOperationsFor({ kind: 'collection', hasAuth: false, hasVersions: true })).toEqual([
      ...COLLECTION_OPERATIONS,
      'readVersions',
    ])
  })

  it('asks a collection that does both for both', () => {
    expect(accessOperationsFor({ kind: 'collection', hasAuth: true, hasVersions: true })).toEqual([
      ...COLLECTION_OPERATIONS,
      'unlock',
      'readVersions',
    ])
  })

  it('asks an ordinary global for the two', () => {
    expect(accessOperationsFor({ kind: 'global', hasAuth: false, hasVersions: false })).toEqual(
      GLOBAL_OPERATIONS,
    )
  })

  it('asks a versioned global for the version read, which Payload leaves undeclared there too', () => {
    expect(accessOperationsFor({ kind: 'global', hasAuth: false, hasVersions: true })).toEqual([
      ...GLOBAL_OPERATIONS,
      'readVersions',
    ])
  })

  // A global has no login of its own, so the unlock operation does not exist on one whatever it claims.
  it('never asks a global for unlock', () => {
    expect(accessOperationsFor({ kind: 'global', hasAuth: true, hasVersions: false })).toEqual(
      GLOBAL_OPERATIONS,
    )
  })
})

describe('findInheritedAccess', () => {
  it('passes an empty configuration and one whose every entity decides its access', () => {
    expect(findInheritedAccess({ collections: [], draftReads: [], globals: [] })).toEqual([])
    expect(findInheritedAccess(DECIDED)).toEqual([])
  })

  // The folder tree is the case that reached a real project: `folders: true` built a collection every
  // signed-in stakeholder could reshape, and every gate stayed green.
  it('names the folder override for the collection the folders setting builds', () => {
    const report: InheritedAccessReport = {
      collections: [{ slug: 'payload-folders', inherited: ['create', 'read', 'update', 'delete'] }],
      draftReads: [],
      globals: [],
    }
    expect(findInheritedAccess(report)).toEqual([
      'collection "payload-folders" leaves create, read, update, delete to Payload\'s default ' +
        'access, which admits every signed-in user; decide them in folders.collectionOverrides',
    ])
  })

  it('names the jobs override for the queue collection', () => {
    const report: InheritedAccessReport = {
      collections: [{ slug: 'payload-jobs', inherited: ['create', 'delete'] }],
      draftReads: [],
      globals: [],
    }
    expect(findInheritedAccess(report)[0]).toContain('decide them in jobs.jobsCollectionOverrides')
  })

  // The slug the probe imports has to stay a key of the repairs table, because the two are what make
  // this collection reportable at all: the probe reads its access off the configuration under that
  // slug, and the table is what turns the finding into the repair that actually works. A rename on
  // either side would otherwise leave the collection judged and pointed at an access block it does
  // not have.
  it('names the query-presets setting for the collection the saved filters build', () => {
    const report: InheritedAccessReport = {
      collections: [{ slug: QUERY_PRESETS_SLUG, inherited: COLLECTION_OPERATIONS }],
      draftReads: [],
      globals: [],
    }
    expect(findInheritedAccess(report)).toEqual([
      `collection "${QUERY_PRESETS_SLUG}" leaves create, read, update, delete to Payload's default ` +
        'access, which admits every signed-in user; decide them in queryPresets.access',
    ])
  })

  // Payload builds this one for its own use, like the ledgers above it, and the resemblance is the
  // hazard: exempting it would restore exactly the blindness this rule was added to close, because an
  // undecided `create` there admits every signed-in user.
  it('judges the query-presets collection rather than exempting it as framework bookkeeping', () => {
    expect(
      EXEMPT_PAYLOAD_SUBJECTS.map((subject: ExemptPayloadSubject): string => subject.slug),
    ).not.toContain(QUERY_PRESETS_SLUG)
  })

  it('points a project or plugin collection at its own access block, singular for one operation', () => {
    const report: InheritedAccessReport = {
      collections: [{ slug: 'posts', inherited: ['update'] }],
      draftReads: [],
      globals: [],
    }
    expect(findInheritedAccess(report)).toEqual([
      'collection "posts" leaves update to Payload\'s default access, which admits every signed-in ' +
        'user; decide it in its access block, or in the override its plugin offers',
    ])
  })

  it('judges a global by the two operations a global decides', () => {
    const report: InheritedAccessReport = {
      collections: [],
      draftReads: [],
      globals: [{ slug: 'header', inherited: ['read', 'update'] }],
    }
    expect(findInheritedAccess(report)[0]).toBe(
      'global "header" leaves read, update to Payload\'s default access, which admits every ' +
        'signed-in user; decide them in its access block, or in the override its plugin offers',
    )
  })

  it.each(EXEMPT_PAYLOAD_SUBJECTS)(
    'exempts $kind "$slug", which keeps the default by design',
    ({ kind, slug }: ExemptPayloadSubject) => {
      const operations: readonly string[] =
        kind === 'collection' ? COLLECTION_OPERATIONS : GLOBAL_OPERATIONS
      const entry: { readonly slug: string; readonly inherited: readonly string[] } = {
        slug,
        inherited: operations,
      }
      const report: InheritedAccessReport =
        kind === 'collection'
          ? { collections: [entry], draftReads: [], globals: [] }
          : { collections: [], draftReads: [], globals: [entry] }
      expect(findInheritedAccess(report)).toEqual([])
    },
  )

  // An exemption names a kind as well as a slug, so a project collection that borrows an exempt
  // global's name is still judged.
  it('exempts a slug only under the kind it is exempt as', () => {
    const report: InheritedAccessReport = {
      collections: [{ slug: 'payload-jobs-stats', inherited: ['read'] }],
      draftReads: [],
      globals: [],
    }
    expect(findInheritedAccess(report)).toHaveLength(1)
  })

  it('reports in configuration order, collections before globals', () => {
    const report: InheritedAccessReport = {
      collections: [
        { slug: 'b', inherited: ['read'] },
        { slug: 'a', inherited: ['read'] },
      ],
      draftReads: [],
      globals: [{ slug: 'g', inherited: ['read'] }],
    }
    expect(
      findInheritedAccess(report).map((finding: string): string => finding.split('"', 2)[1] ?? ''),
    ).toEqual(['b', 'a', 'g'])
  })
})

const PUBLISHED: unknown = { _status: { equals: 'published' } }
const AUDIENCE: unknown = { audiences: { in: ['public'] } }

const draftsOf = (anonymousRead: AnonymousRead): InheritedAccessReport => ({
  collections: [],
  draftReads: [{ kind: 'collection', slug: 'articles', anonymousRead }],
  globals: [],
})

// The filter a read returns is the half `/api/access` reports and the anonymous sweep never opens, so
// this is the only place in the harness that reads what a constraint constrains.
describe('requiresPublishedStatus', () => {
  it('accepts the clause at the top level and inside an and, however deep', () => {
    expect(requiresPublishedStatus(PUBLISHED)).toBe(true)
    expect(requiresPublishedStatus({ and: [AUDIENCE, PUBLISHED] })).toBe(true)
    expect(requiresPublishedStatus({ and: [{ and: [PUBLISHED] }, AUDIENCE] })).toBe(true)
  })

  // Every branch of an or holds, or none of them does: one branch without the clause is the way in.
  it('accepts an or only when every branch carries the clause', () => {
    expect(requiresPublishedStatus({ or: [{ and: [PUBLISHED, AUDIENCE] }, PUBLISHED] })).toBe(true)
    expect(requiresPublishedStatus({ or: [PUBLISHED, AUDIENCE] })).toBe(false)
    expect(requiresPublishedStatus({ or: [] })).toBe(false)
  })

  it('refuses a filter that names another field, another status, or nothing at all', () => {
    expect(requiresPublishedStatus({ and: [AUDIENCE] })).toBe(false)
    expect(requiresPublishedStatus({ _status: { equals: 'draft' } })).toBe(false)
    expect(requiresPublishedStatus({ _status: { not_equals: 'draft' } })).toBe(false)
    for (const nothing of [undefined, null, true, 'published', []]) {
      expect(requiresPublishedStatus(nothing)).toBe(false)
    }
  })
})

// The defect this exists for: a read helper that scopes by audience and forgets the status. It passed
// the static rule, which only reads the inline spelling the shipped ESLint config forbids, and it
// passed the anonymous sweep, which sees that a constraint exists and never opens it.
describe('findUnconstrainedDraftReads', () => {
  it('reports a filter that constrains something other than the status', () => {
    const findings: readonly string[] = findUnconstrainedDraftReads(
      draftsOf({ kind: 'filtered', where: { and: [AUDIENCE] } }),
    )
    expect(findings).toHaveLength(1)
    expect(findings[0]).toContain(
      'collection "articles" keeps drafts and filters its anonymous read',
    )
    expect(findings[0]).toContain('_status equals published')
  })

  it('reports an unconditional read, which the static rule misses once it is a named helper', () => {
    expect(findUnconstrainedDraftReads(draftsOf({ kind: 'open' }))[0]).toContain(
      'grants an unconditional anonymous read',
    )
  })

  // A rule that cannot be asked is not a rule that answered no.
  it('reports a read rule that threw rather than reading the throw as a refusal', () => {
    const findings: readonly string[] = findUnconstrainedDraftReads(
      draftsOf({ kind: 'undecidable', reason: 'payload is not defined' }),
    )
    expect(findings[0]).toContain('could not be decided')
    expect(findings[0]).toContain('payload is not defined')
  })

  it('passes a read that refuses a stranger and one that constrains the status', () => {
    expect(findUnconstrainedDraftReads(draftsOf({ kind: 'denied' }))).toEqual([])
    expect(
      findUnconstrainedDraftReads(
        draftsOf({ kind: 'filtered', where: { and: [PUBLISHED, AUDIENCE] } }),
      ),
    ).toEqual([])
  })

  it('says which kind of entity it found, and passes a configuration that keeps no drafts', () => {
    const report: InheritedAccessReport = {
      collections: [],
      draftReads: [{ kind: 'global', slug: 'banner', anonymousRead: { kind: 'open' } }],
      globals: [],
    }
    expect(findUnconstrainedDraftReads(report)[0]).toContain('global "banner"')
    expect(findUnconstrainedDraftReads(DECIDED)).toEqual([])
  })
})

describe('parseInheritedAccessReport', () => {
  it('reads the marker line', () => {
    const text: string = reportOf(JSON.stringify(DECIDED))
    expect(parseInheritedAccessReport(text)).toEqual(DECIDED)
  })

  it('ignores what a plugin logged before the report and takes the last report line', () => {
    const stale: InheritedAccessReport = { collections: [], draftReads: [], globals: [] }
    const text: string = [
      'a storage plugin says hello',
      reportOf(JSON.stringify(stale)),
      `  ${reportOf(JSON.stringify(DECIDED))}  `,
    ].join('\n')
    expect(parseInheritedAccessReport(text)).toEqual(DECIDED)
  })

  // A probe that died printed a stack trace and no marker; a probe that was cut off printed half a
  // line. Neither may read as a clean report.
  it.each([
    ['no marker line', 'TypeError: cannot read properties of undefined'],
    ['a marker followed by broken JSON', reportOf('{"collections": [')],
    ['a report without globals', reportOf('{"collections": []}')],
    ['an entry without a slug', reportOf('{"collections": [{"inherited": []}], "globals": []}')],
    [
      'an operation that is not a string',
      reportOf('{"collections": [{"slug": "a", "inherited": [1]}], "globals": []}'),
    ],
    ['a report that is not an object', reportOf('"text"')],
  ])('refuses %s', (_case: string, text: string) => {
    expect(parseInheritedAccessReport(text)).toBeUndefined()
  })
})

// The probe and this parser ship in one tarball set at one version, so a report it cannot read is a
// bug rather than a version to tolerate: it fails the gate, exactly as a report that never arrived.
describe('parseInheritedAccessReport over the drafts half', () => {
  it.each([
    { kind: 'denied' },
    { kind: 'open' },
    { kind: 'filtered', where: { and: [{ _status: { equals: 'published' } }] } },
    { kind: 'undecidable', reason: 'payload is not defined' },
  ] as readonly AnonymousRead[])('carries a $kind read through the report', (anonymousRead) => {
    const report: InheritedAccessReport = draftsOf(anonymousRead)
    expect(parseInheritedAccessReport(reportOf(JSON.stringify(report)))).toEqual(report)
  })

  it.each([
    ['the drafts half missing entirely', '{"collections":[],"globals":[]}'],
    ['the drafts half not an array', '{"collections":[],"globals":[],"draftReads":{}}'],
    [
      'an entry with no slug',
      '{"collections":[],"globals":[],"draftReads":' +
        '[{"kind":"collection","anonymousRead":{"kind":"open"}}]}',
    ],
    [
      'an entry of no known kind',
      '{"collections":[],"globals":[],"draftReads":' +
        '[{"kind":"plugin","slug":"a","anonymousRead":{"kind":"open"}}]}',
    ],
    [
      'a read of no known kind',
      '{"collections":[],"globals":[],"draftReads":' +
        '[{"kind":"collection","slug":"a","anonymousRead":{"kind":"maybe"}}]}',
    ],
  ])('refuses a report with %s', (_description: string, line: string) => {
    expect(parseInheritedAccessReport(reportOf(line))).toBeUndefined()
  })
})

describe('payloadConfigPathOf', () => {
  it('reads the alias ploaness init writes, without its leading ./', () => {
    const tsconfig: unknown = {
      compilerOptions: { paths: { '@payload-config': ['./src/payload.config.ts'] } },
    }
    expect(payloadConfigPathOf(tsconfig)).toBe('src/payload.config.ts')
  })

  it('keeps an alias that does not start with ./', () => {
    const tsconfig: unknown = {
      compilerOptions: { paths: { '@payload-config': ['cms/config.ts'] } },
    }
    expect(payloadConfigPathOf(tsconfig)).toBe('cms/config.ts')
  })

  it.each([
    ['no tsconfig', undefined],
    ['no paths', { compilerOptions: {} }],
    ['an alias that is not a list', { compilerOptions: { paths: { '@payload-config': 'x' } } }],
    ['an empty alias', { compilerOptions: { paths: { '@payload-config': [] } } }],
  ])('falls back to the default path with %s', (_case: string, tsconfig: unknown) => {
    expect(payloadConfigPathOf(tsconfig)).toBe(DEFAULT_PAYLOAD_CONFIG_PATH)
  })
})
