// The Payload half of the source reader, exercised directly.
//
// It sat one layer below `payload-access.ts` and `payload-policy.ts` and was reached only through them,
// which is the arrangement `source-text.spec.ts` was written to end for the layer below THIS one: a
// defect here would have been reported as a defect in whichever rule happened to call it, and the
// inputs a rule builds are the ones that rule needs rather than the ones this reader has to survive.
import { describe, expect, it } from 'vitest'
import { configBody, depthOneBlockKeys, depthOneValue } from '../src/payload-source.js'

const COLLECTION: string = `{
  slug: 'posts',
  auth: { maxLoginAttempts: 5, lockTime: 600000 },
  access: { read: () => true },
  fields: [
    { name: 'title', type: 'text', access: { update: () => false } },
    { name: 'author', type: 'relationship', relationTo: 'users' },
  ],
}`

describe('depthOneValue', () => {
  it('reads the value a key declares on the literal itself', () => {
    expect(depthOneValue(COLLECTION, 'slug')?.trimStart().startsWith("'posts'")).toBe(true)
  })

  it('returns undefined for a key the literal does not declare', () => {
    expect(depthOneValue(COLLECTION, 'versions')).toBeUndefined()
  })

  // The reason the key lookup requires a `{` or `,` before the name rather than merely allowing one.
  // Without it `oauth:` matched as `auth:`, and a collection with no authentication was reported as one
  // whose authentication was left unhardened.
  it('does not read a key whose name merely ends with the one asked for', () => {
    expect(depthOneValue("{ oauth: { provider: 'github' } }", 'auth')).toBeUndefined()
  })

  // The whole point of the depth restriction: a field carries blocks with the same names a collection
  // does, and reading one of those as the collection's own is what the access rules exist to catch.
  it('does not read a key nested inside a field', () => {
    expect(depthOneValue("{ fields: [{ name: 'a', versions: true }] }", 'versions')).toBeUndefined()
  })
})

describe('depthOneBlockKeys', () => {
  it('reads the keys of a block the literal declares', () => {
    expect(depthOneBlockKeys(COLLECTION, 'auth')).toEqual(['maxLoginAttempts', 'lockTime'])
  })

  it('reads a block whose value is an arrow function as no keys of its own', () => {
    expect(depthOneBlockKeys(COLLECTION, 'access')).toEqual(['read'])
  })

  it('returns no keys for a block the literal does not declare', () => {
    expect(depthOneBlockKeys(COLLECTION, 'hooks')).toEqual([])
  })
})

describe('configBody', () => {
  const annotated: string = `const Posts: CollectionConfig = { slug: 'posts', fields: [] }`
  const trailing: string = `const Posts = { slug: 'posts', fields: [] } satisfies CollectionConfig`

  it('reads the literal that follows an annotation', () => {
    expect(configBody(annotated, annotated.indexOf('CollectionConfig'), false)).toBe(
      "{ slug: 'posts', fields: [] }",
    )
  })

  // `satisfies` writes the type after the value, so the body is the literal that CLOSES before the
  // marker rather than the one that opens after it. Scanning forward from the marker finds nothing.
  it('reads the literal that precedes a satisfies marker', () => {
    expect(configBody(trailing, trailing.indexOf('satisfies'), true)).toBe(
      "{ slug: 'posts', fields: [] }",
    )
  })

  it('picks the nearest preceding literal when a file declares several', () => {
    const two: string = `const A = { slug: 'a' } satisfies CollectionConfig
const B = { slug: 'b' } satisfies CollectionConfig`
    expect(configBody(two, two.lastIndexOf('satisfies'), true)).toBe("{ slug: 'b' }")
  })

  it('returns undefined when no literal belongs to the marker', () => {
    const none: string = `export type Alias = CollectionConfig`
    expect(configBody(none, none.indexOf('CollectionConfig'), false)).toBeUndefined()
    expect(configBody(none, none.indexOf('CollectionConfig'), true)).toBeUndefined()
  })

  // A brace inside a string is not a brace. Without the string skipping the scan would close the
  // literal early and hand a rule a body that stops mid-declaration.
  it('does not end the body at a brace inside a string literal', () => {
    const tricky: string = `const Posts: CollectionConfig = { slug: 'a}b', fields: [] }`
    expect(configBody(tricky, tricky.indexOf('CollectionConfig'), false)).toBe(
      "{ slug: 'a}b', fields: [] }",
    )
  })
})
