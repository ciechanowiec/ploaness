import { describe, expect, it } from 'vitest'
import { findPayloadViolations, findSourceViolations } from '../src/payload-policy.js'
import type { PayloadViolation } from '../src/payload-source.js'
import { stripComments, topLevelSlice } from '../src/source-text.js'

const rulesOf = (source: string): readonly string[] =>
  findPayloadViolations(source).map((violation) => violation.rule)

describe('topLevelSlice', () => {
  it('keeps depth-one keys and elides nested ones', () => {
    expect(topLevelSlice("{ collection: 'posts', where: { depth: 9 } }")).toContain('collection')
    expect(topLevelSlice("{ collection: 'posts', where: { depth: 9 } }")).not.toContain('depth')
  })

  it('ignores braces inside string literals', () => {
    expect(topLevelSlice("{ slug: '{not-a-brace}', limit: 5 }")).toContain('limit')
  })
})

describe('no-unbounded-find', () => {
  it('flags a find without depth or limit', () => {
    expect(rulesOf("await payload.find({ collection: 'posts' })")).toEqual(['no-unbounded-find'])
  })

  it('accepts a find bounded by limit', () => {
    expect(rulesOf("await payload.find({ collection: 'posts', limit: 10 })")).toEqual([])
  })

  it('accepts a find bounded by depth', () => {
    expect(rulesOf("await payload.find({ collection: 'posts', depth: 0 })")).toEqual([])
  })

  it('reads a bound across several lines', () => {
    const source: string = [
      'await payload.find({',
      "  collection: 'posts',",
      '  depth: 1,',
      '})',
    ].join('\n')
    expect(rulesOf(source)).toEqual([])
  })

  it('does not accept a depth nested inside where', () => {
    expect(
      rulesOf("await payload.find({ collection: 'p', where: { depth: { equals: 1 } } })"),
    ).toEqual(['no-unbounded-find'])
  })

  it('ignores an unrelated array find', () => {
    expect(rulesOf('const found = items.find({ id: 1 })')).toEqual([])
  })

  // The request is threaded so this reports the bound alone. A call that omits both is the subject of
  // its own case under no-unthreaded-req.
  it('recognises the request-scoped payload instance', () => {
    expect(rulesOf("await req.payload.find({ collection: 'posts', req })")).toEqual([
      'no-unbounded-find',
    ])
  })

  it('stays silent when the argument is a variable it cannot read', () => {
    expect(rulesOf('await payload.find(options)')).toEqual([])
  })

  it('stays silent when the argument object is spread', () => {
    expect(rulesOf("await payload.find({ ...base, collection: 'posts' })")).toEqual([])
  })
})

// Threading `req` is what keeps a nested operation inside the caller's transaction. The rule fires only
// on the request-scoped instance, because that is the one call site where the request provably exists.
describe('no-unthreaded-req', () => {
  it('flags a read reached through req.payload that does not carry req', () => {
    expect(rulesOf("await req.payload.findGlobal({ slug: 'settings', depth: 0 })")).toEqual([
      'no-unthreaded-req',
    ])
  })

  it('accepts req passed as the shorthand property it is normally written as', () => {
    expect(rulesOf("await req.payload.findGlobal({ slug: 'settings', depth: 0, req })")).toEqual([])
  })

  it('accepts req passed explicitly', () => {
    expect(
      rulesOf("await req.payload.findGlobal({ slug: 'settings', depth: 0, req: req })"),
    ).toEqual([])
  })

  it('accepts req as the only key, with no comma to anchor on', () => {
    expect(rulesOf('await req.payload.delete({ req })')).toEqual([])
  })

  it('reads the shorthand across several lines, which is how a hook writes one', () => {
    const source: string = [
      'await req.payload.find({',
      "  collection: 'bookings',",
      '  depth: 0,',
      '  limit: 1,',
      '  req,',
      '})',
    ].join('\n')
    expect(rulesOf(source)).toEqual([])
  })

  it('flags every operation that joins a transaction, writes included', () => {
    expect(rulesOf("await req.payload.create({ collection: 'a', data })")).toEqual([
      'no-unthreaded-req',
    ])
    expect(rulesOf("await req.payload.update({ collection: 'a', id, data })")).toEqual([
      'no-unthreaded-req',
    ])
    expect(rulesOf("await req.payload.delete({ collection: 'a', id })")).toEqual([
      'no-unthreaded-req',
    ])
    expect(rulesOf("await req.payload.updateGlobal({ slug: 'a', data })")).toEqual([
      'no-unthreaded-req',
    ])
  })
})

// The half that keeps the rule from being a nuisance: what it must stay silent about, and what it must
// not be fooled by. Its own block, because a describe callback counts towards the line ceiling.
describe('what no-unthreaded-req leaves alone', () => {
  it('reads the instance through a chain, as a hook that destructures nothing does', () => {
    expect(rulesOf("await ctx.req.payload.findGlobal({ slug: 'settings', depth: 0 })")).toEqual([
      'no-unthreaded-req',
    ])
  })

  // The half that keeps the rule honest. A script, a seed, or a Server Component holds an instance from
  // `getPayload()` and has no request to thread, so demanding one would be demanding a value that does
  // not exist. Only reaching the instance THROUGH req proves a request is in scope.
  it('says nothing about a bare payload instance, which has no request to thread', () => {
    expect(rulesOf("await payload.findGlobal({ slug: 'settings', depth: 0 })")).toEqual([])
    expect(rulesOf("await payload.create({ collection: 'a', data })")).toEqual([])
  })

  it('says nothing about a property named payload on some unrelated object', () => {
    expect(rulesOf("await message.payload.create({ collection: 'a', data })")).toEqual([])
  })

  it('is not fooled by a key that merely begins with req', () => {
    expect(rulesOf("await req.payload.create({ collection: 'a', requestedBy: user })")).toEqual([
      'no-unthreaded-req',
    ])
  })

  it('does not accept a req nested inside another key', () => {
    expect(rulesOf("await req.payload.create({ collection: 'a', data: { req: 1 } })")).toEqual([
      'no-unthreaded-req',
    ])
  })

  it('stays silent when the options are spread or unreadable', () => {
    expect(rulesOf('await req.payload.create(options)')).toEqual([])
    expect(rulesOf("await req.payload.create({ ...base, collection: 'a' })")).toEqual([])
  })

  it('reports the bound and the transaction separately when a call breaks both', () => {
    expect(rulesOf("await req.payload.find({ collection: 'posts' })")).toEqual([
      'no-unbounded-find',
      'no-unthreaded-req',
    ])
  })
})

describe('the single-document reads', () => {
  it('requires depth on findByID', () => {
    expect(rulesOf("await payload.findByID({ collection: 'posts', id })")).toEqual([
      'no-unbounded-findbyid',
    ])
  })

  it('does not accept limit as a bound on findByID', () => {
    expect(rulesOf("await payload.findByID({ collection: 'posts', id, limit: 1 })")).toEqual([
      'no-unbounded-findbyid',
    ])
  })

  it('requires depth on findGlobal', () => {
    expect(rulesOf("await payload.findGlobal({ slug: 'settings' })")).toEqual([
      'no-unbounded-findglobal',
    ])
  })
})

describe('no-override-access', () => {
  it('flags an access-control override', () => {
    expect(
      rulesOf("await payload.find({ collection: 'p', depth: 0, overrideAccess: true })"),
    ).toEqual(['no-override-access'])
  })

  it('accepts an explicit false', () => {
    expect(
      rulesOf("await payload.find({ collection: 'p', depth: 0, overrideAccess: false })"),
    ).toEqual([])
  })
})

// The import rule is about the language rather than about Payload, so it moved out of the framework set
// and is asked for through `findSourceViolations`. Every package is held to it now, not only the ones
// that happen to have Payload in them.
const sourceRulesOf = (source: string): readonly string[] =>
  findSourceViolations(source).map((violation: PayloadViolation): string => violation.rule)

describe('no-deep-relative-imports', () => {
  it('flags a parent-relative import', () => {
    expect(sourceRulesOf("import { thing } from '../lib/thing'")).toEqual([
      'no-deep-relative-imports',
    ])
  })

  it('accepts a same-directory import', () => {
    expect(sourceRulesOf("import { thing } from './thing'")).toEqual([])
  })

  it('exempts test helpers and the generated import map', () => {
    expect(sourceRulesOf("import { seed } from '../helpers/seed'")).toEqual([])
    expect(sourceRulesOf("import { importMap } from '../importMap'")).toEqual([])
  })

  it('exempts a helper reached from a nested spec directory', () => {
    expect(sourceRulesOf("import { seed } from '../../../helpers/seed'")).toEqual([])
  })

  it('reports a climb that lands inside source rather than on a helper root', () => {
    expect(sourceRulesOf("import { seed } from '../../src/helpers/seed'")).toEqual([
      'no-deep-relative-imports',
    ])
  })

  it('is not part of the framework rule set, which only a Payload package can break', () => {
    expect(rulesOf("import { thing } from '../lib/thing'")).toEqual([])
  })
})

const COMPLETE_ACCESS: string =
  'access: { create: admins, read: anyone, update: admins, delete: admins }'

describe('require-complete-access', () => {
  it('flags a collection that declares no access', () => {
    const source: string = "export const Posts: CollectionConfig = { slug: 'posts', fields: [] }"
    expect(rulesOf(source)).toEqual(['require-complete-access'])
  })

  it('accepts a collection that decides every operation', () => {
    const source: string = `export const Posts: CollectionConfig = { slug: 'posts', ${COMPLETE_ACCESS} }`
    expect(rulesOf(source)).toEqual([])
  })

  // The rule this replaced checked only that the word `access` appeared somewhere in the file, so a
  // block deciding one operation out of four passed while Payload filled the rest with its defaults.
  it('flags a partial access block', () => {
    const source: string =
      "export const Posts: CollectionConfig = { slug: 'posts', access: { read: anyone }, fields: [] }"
    expect(rulesOf(source)).toEqual(['require-complete-access'])
  })

  it('names the operations that were left to the defaults', () => {
    const source: string =
      "export const Posts: CollectionConfig = { slug: 'posts', access: { read: anyone, create: admins } }"
    expect(findPayloadViolations(source)[0]?.reason).toContain('update, delete')
  })

  // A field-level access block sits inside `fields`, so it must not be read as the collection's own.
  it('does not accept a field-level access block in place of the collection one', () => {
    const source: string = [
      "export const Users: CollectionConfig = { slug: 'users', fields: [",
      '  { name: "roles", access: { read: a, create: a, update: a, delete: a } },',
      '] }',
    ].join('\n')
    expect(rulesOf(source)).toEqual(['require-complete-access'])
  })

  it('ignores a file that declares no config', () => {
    expect(rulesOf('export const value = 1')).toEqual([])
  })
})

// Globals were covered by no rule at all: the old check looked for CollectionConfig only.
describe('require-complete-access on a global', () => {
  it('flags a global that declares no access', () => {
    const source: string = "export const Header: GlobalConfig = { slug: 'header', fields: [] }"
    expect(rulesOf(source)).toEqual(['require-complete-access'])
  })

  it('accepts a global that decides read and update', () => {
    const source: string =
      "export const Header: GlobalConfig = { slug: 'header', access: { read: anyone, update: admins } }"
    expect(rulesOf(source)).toEqual([])
  })

  it('flags a global that decides only read', () => {
    const source: string =
      "export const Header: GlobalConfig = { slug: 'header', access: { read: anyone } }"
    expect(findPayloadViolations(source)[0]?.reason).toContain('update')
  })
})

describe('prose is never mistaken for code', () => {
  it('ignores a banned construct named in a line comment', () => {
    const source: string =
      '// no banned `overrideAccess: true` flag is needed here\nexport const x = 1'
    expect(rulesOf(source)).toEqual([])
  })

  it('ignores a banned construct named in a block comment', () => {
    const source: string =
      "/*\n * Never write payload.find({ collection: 'p' }) unbounded.\n */\nexport const x = 1"
    expect(rulesOf(source)).toEqual([])
  })

  it('still reports the construct when it is real code beside the comment', () => {
    const source: string =
      "// explaining overrideAccess\nawait payload.find({ collection: 'p', depth: 0, overrideAccess: true })"
    expect(rulesOf(source)).toEqual(['no-override-access'])
  })

  it('reports the line of the code, not of the comment', () => {
    const source: string = [
      '// a preamble',
      '// another line',
      "await payload.find({ collection: 'p' })",
    ].join('\n')
    expect(findPayloadViolations(source)[0]?.line).toBe(3)
  })

  it('does not treat escaped slashes in a regex literal as a comment', () => {
    const source: string = "const pattern = /https:\\/\\//\nawait payload.find({ collection: 'p' })"
    expect(rulesOf(source)).toEqual(['no-unbounded-find'])
  })
})

describe('require-complete-access precision', () => {
  it('ignores an array of already-defined collections', () => {
    const source: string = 'export const collections: CollectionConfig[] = [Users, Media]'
    expect(rulesOf(source)).toEqual([])
  })

  it('still flags a real collection definition', () => {
    const source: string = "export const Users: CollectionConfig = { slug: 'users', fields: [] }"
    expect(rulesOf(source)).toEqual(['require-complete-access'])
  })
})

describe('stripComments', () => {
  it('preserves line count so reported positions stay accurate', () => {
    const source: string = '/* a\n block\n comment */\ncode'
    expect(stripComments(source).split('\n')).toHaveLength(4)
  })

  it('leaves string literals untouched', () => {
    expect(stripComments("const url = 'https://example.com'")).toContain('https://example.com')
  })
})

const withAuth = (auth: string): string =>
  `export const Users: CollectionConfig = { slug: 'users', ${COMPLETE_ACCESS}, auth: ${auth} }`

// Payload locks nothing by default, so an auth collection that says only `auth: true` accepts password
// guesses at whatever rate a client can manage.
describe('require-auth-hardening', () => {
  it('flags the bare enable', () => {
    expect(rulesOf(withAuth('true'))).toEqual(['require-auth-hardening'])
  })

  it('accepts a collection that caps attempts and locks the account', () => {
    expect(rulesOf(withAuth('{ maxLoginAttempts: 5, lockTime: 600 }'))).toEqual([])
  })

  it('flags an auth block that caps attempts but never locks', () => {
    expect(findPayloadViolations(withAuth('{ maxLoginAttempts: 5 }'))[0]?.reason).toContain(
      'lockTime',
    )
  })

  it('leaves a collection without auth alone', () => {
    const source: string = `export const Posts: CollectionConfig = { slug: 'posts', ${COMPLETE_ACCESS} }`
    expect(rulesOf(source)).toEqual([])
  })

  // `auth` also appears inside a field's admin config; only the collection's own counts.
  it('does not read a nested auth key as the one the collection declares', () => {
    const source: string = [
      `export const Posts: CollectionConfig = { slug: 'posts', ${COMPLETE_ACCESS},`,
      '  fields: [{ name: "x", custom: { auth: true } }] }',
    ].join('\n')
    expect(rulesOf(source)).toEqual([])
  })
})

// A draft is unpublished content, and `?draft=true` serves it to whoever the read rule admits.
describe('no-anonymous-draft-reads', () => {
  it('flags a drafts collection whose read is unconditionally true', () => {
    const source: string = [
      "export const Posts: CollectionConfig = { slug: 'posts',",
      '  versions: { drafts: true },',
      '  access: { create: admins, read: () => true, update: admins, delete: admins } }',
    ].join('\n')
    expect(rulesOf(source)).toContain('no-anonymous-draft-reads')
  })

  it('accepts a drafts collection whose read is delegated to a helper', () => {
    const source: string = [
      "export const Posts: CollectionConfig = { slug: 'posts',",
      '  versions: { drafts: true },',
      '  access: { create: admins, read: authenticatedOrPublished, update: admins, delete: admins } }',
    ].join('\n')
    expect(rulesOf(source)).toEqual([])
  })

  // Without drafts there is nothing unpublished to leak, so a public read is a decision, not a defect.
  it('leaves a public read alone when the collection has no drafts', () => {
    const source: string =
      "export const Posts: CollectionConfig = { slug: 'posts', " +
      'access: { create: a, read: () => true, update: a, delete: a } }'
    expect(rulesOf(source)).toEqual([])
  })

  it('flags a global with drafts enabled and an unconditional read', () => {
    const source: string = [
      "export const Header: GlobalConfig = { slug: 'header',",
      '  versions: { drafts: true },',
      '  access: { read: () => true, update: admins } }',
    ].join('\n')
    expect(rulesOf(source)).toContain('no-anonymous-draft-reads')
  })
})
