import { describe, expect, it } from 'vitest'
import {
  findAnonymousDraftReads,
  findUndeclaredAccess,
  findUnhardenedAuth,
} from '../src/payload-access.js'

const COMPLETE_ACCESS: string =
  'access: { create: isAdmin, read: isAdmin, update: isAdmin, delete: isAdmin },'

const rulesOf = (source: string): readonly string[] =>
  [
    ...findUndeclaredAccess(source),
    ...findUnhardenedAuth(source),
    ...findAnonymousDraftReads(source),
  ].map((violation) => violation.rule)

// The three declaration forms are the point of this block. Two of them used to be matched by nothing at
// all, so a collection written either way passed every rule below without one of them reading it - a
// failure indistinguishable from a pass, which is the only kind that survives unnoticed.
describe('which declarations are judged at all', () => {
  it('judges the plain type annotation', () => {
    expect(rulesOf("const A: CollectionConfig = { slug: 'a' }")).toEqual([
      'require-complete-access',
    ])
  })

  it('judges an annotation carrying a type argument', () => {
    expect(rulesOf("const A: CollectionConfig<'a'> = { slug: 'a' }")).toEqual([
      'require-complete-access',
    ])
  })

  it('judges the satisfies form, whose type follows its value', () => {
    expect(rulesOf("const A = { slug: 'a' } satisfies CollectionConfig")).toEqual([
      'require-complete-access',
    ])
  })

  it('judges a satisfies form whose value contains an arrow function', () => {
    const source: string = `const A = { slug: 'a', hooks: { beforeChange: [() => true] } } satisfies CollectionConfig`
    expect(rulesOf(source)).toEqual(['require-complete-access'])
  })

  it('judges a global as well as a collection', () => {
    expect(rulesOf("const H: GlobalConfig = { slug: 'h' }")).toEqual(['require-complete-access'])
  })

  it('does not read a longer type name as one it judges', () => {
    expect(rulesOf("const A: CollectionConfigs = { slug: 'a' }")).toEqual([])
  })
})

// `search` found one offset, so everything after the first config in a file was judged by nothing.
describe('every config in the file, not the first', () => {
  it('reports a second collection that declares no access', () => {
    const source: string = [
      `const A: CollectionConfig = { slug: 'a', ${COMPLETE_ACCESS} }`,
      `const B: CollectionConfig = { slug: 'b' }`,
    ].join('\n')
    expect(rulesOf(source)).toEqual(['require-complete-access'])
  })

  it('reports both when neither declares access', () => {
    const source: string = [
      `const A: CollectionConfig = { slug: 'a' }`,
      `const B: CollectionConfig = { slug: 'b' }`,
    ].join('\n')
    expect(rulesOf(source)).toEqual(['require-complete-access', 'require-complete-access'])
  })

  it('names the line of the config it is reporting, not the line of the first', () => {
    const source: string = [
      `const A: CollectionConfig = { slug: 'a', ${COMPLETE_ACCESS} }`,
      `const B: CollectionConfig = { slug: 'b' }`,
    ].join('\n')
    expect(findUndeclaredAccess(source)[0]?.line).toBe(2)
  })
})

// A key was matched at every offset the scan visited, so any longer key ending in the sought name
// matched it: `oauth` was read as `auth`, and `myaccess` as `access`.
describe('a key is a key, not a suffix of one', () => {
  it('does not read oauth as auth', () => {
    const source: string = `const A: CollectionConfig = { slug: 'a', ${COMPLETE_ACCESS} oauth: true }`
    expect(rulesOf(source)).toEqual([])
  })

  it('does not read myaccess as access', () => {
    const source: string = `const A: CollectionConfig = { slug: 'a', myaccess: { read: x } }`
    expect(rulesOf(source)).toEqual(['require-complete-access'])
  })

  it('still reports auth that is genuinely unhardened', () => {
    const source: string = `const A: CollectionConfig = { slug: 'a', ${COMPLETE_ACCESS} auth: true }`
    expect(rulesOf(source)).toEqual(['require-auth-hardening'])
  })

  it('accepts auth that declares both hardening keys', () => {
    const source: string = `const A: CollectionConfig = { slug: 'a', ${COMPLETE_ACCESS} auth: { maxLoginAttempts: 5, lockTime: 600 } }`
    expect(rulesOf(source)).toEqual([])
  })
})

describe('require-complete-access', () => {
  it('accepts a block declaring all four operations', () => {
    expect(rulesOf(`const A: CollectionConfig = { slug: 'a', ${COMPLETE_ACCESS} }`)).toEqual([])
  })

  it('reports a partial block, which Payload fills in silently', () => {
    const source: string = `const A: CollectionConfig = { slug: 'a', access: { read: isAdmin } }`
    expect(findUndeclaredAccess(source)[0]?.reason).toContain('create')
  })

  it('accepts a global that declares only read and update', () => {
    const source: string = `const H: GlobalConfig = { slug: 'h', access: { read: isAdmin, update: isAdmin } }`
    expect(rulesOf(source)).toEqual([])
  })

  it('does not read a field-level access block as the collection own', () => {
    const source: string = `const A: CollectionConfig = { slug: 'a', fields: [{ name: 'x', access: { read: isAdmin, create: isAdmin, update: isAdmin, delete: isAdmin } }] }`
    expect(rulesOf(source)).toEqual(['require-complete-access'])
  })
})

describe('no-anonymous-draft-reads', () => {
  const drafts: string = 'versions: { drafts: true },'

  it('reports an unconditionally true read on a drafting collection', () => {
    const source: string = `const A: CollectionConfig = { slug: 'a', ${drafts} access: { read: () => true, create: x, update: x, delete: x } }`
    expect(rulesOf(source)).toEqual(['no-anonymous-draft-reads'])
  })

  it('says nothing when drafts are not enabled', () => {
    const source: string = `const A: CollectionConfig = { slug: 'a', access: { read: () => true, create: x, update: x, delete: x } }`
    expect(rulesOf(source)).toEqual([])
  })

  // The access value runs to the end of the enclosing literal, so testing it whole reported a field
  // that grants nothing beyond itself as though the collection were open.
  it('does not read a field-level always-true read as the collection own', () => {
    const source: string = `const A: CollectionConfig = { slug: 'a', ${drafts} ${COMPLETE_ACCESS} fields: [{ name: 'x', access: { read: () => true } }] }`
    expect(rulesOf(source)).toEqual([])
  })
})
