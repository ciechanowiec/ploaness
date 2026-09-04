import { describe, expect, it } from 'vitest'
import {
  COLLECTION_OPERATIONS,
  DEFAULT_PAYLOAD_CONFIG_PATH,
  EXEMPT_PAYLOAD_SUBJECTS,
  type ExemptPayloadSubject,
  findInheritedAccess,
  GLOBAL_OPERATIONS,
  INHERITED_ACCESS_REPORT_MARKER,
  type InheritedAccessReport,
  parseInheritedAccessReport,
  payloadConfigPathOf,
} from '../src/payload-defaults.js'

const DECIDED: InheritedAccessReport = {
  collections: [
    { slug: 'users', inherited: [] },
    { slug: 'media', inherited: [] },
  ],
  globals: [{ slug: 'header', inherited: [] }],
}

const reportOf = (line: string): string => `${INHERITED_ACCESS_REPORT_MARKER}${line}`

describe('findInheritedAccess', () => {
  it('passes an empty configuration and one whose every entity decides its access', () => {
    expect(findInheritedAccess({ collections: [], globals: [] })).toEqual([])
    expect(findInheritedAccess(DECIDED)).toEqual([])
  })

  // The folder tree is the case that reached a real project: `folders: true` built a collection every
  // signed-in stakeholder could reshape, and every gate stayed green.
  it('names the folder override for the collection the folders setting builds', () => {
    const report: InheritedAccessReport = {
      collections: [{ slug: 'payload-folders', inherited: ['create', 'read', 'update', 'delete'] }],
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
      globals: [],
    }
    expect(findInheritedAccess(report)[0]).toContain('decide them in jobs.jobsCollectionOverrides')
  })

  it('points a project or plugin collection at its own access block, singular for one operation', () => {
    const report: InheritedAccessReport = {
      collections: [{ slug: 'posts', inherited: ['update'] }],
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
          ? { collections: [entry], globals: [] }
          : { collections: [], globals: [entry] }
      expect(findInheritedAccess(report)).toEqual([])
    },
  )

  // An exemption names a kind as well as a slug, so a project collection that borrows an exempt
  // global's name is still judged.
  it('exempts a slug only under the kind it is exempt as', () => {
    const report: InheritedAccessReport = {
      collections: [{ slug: 'payload-jobs-stats', inherited: ['read'] }],
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
      globals: [{ slug: 'g', inherited: ['read'] }],
    }
    expect(
      findInheritedAccess(report).map((finding: string): string => finding.split('"', 2)[1] ?? ''),
    ).toEqual(['b', 'a', 'g'])
  })
})

describe('parseInheritedAccessReport', () => {
  it('reads the marker line', () => {
    const text: string = reportOf(JSON.stringify(DECIDED))
    expect(parseInheritedAccessReport(text)).toEqual(DECIDED)
  })

  it('ignores what a plugin logged before the report and takes the last report line', () => {
    const stale: InheritedAccessReport = { collections: [], globals: [] }
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
