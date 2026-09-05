// The catalogue of Payload configuration literals, exercised directly.
//
// Every Payload access rule stands on this reader, so a defect here is reported as a defect in whichever
// rule happened to call it. The question it answers is narrow and easy to get wrong: which object
// literal in a file IS the collection a type reference names. It used to answer "the next `{` anywhere
// after the type name", an unbounded forward search that crossed statement boundaries, so a call
// argument, a parameter annotation and an interface member were each judged as configurations - and,
// because the search ran on to the next literal in the file, they were judged against text nobody wrote
// as a config. The false-positive cases below are that defect, held down.
import { describe, expect, it } from 'vitest'
import {
  directFieldsIn,
  type FoundPayloadConfig,
  payloadConfigsIn,
} from '../src/payload-configs.js'

/** What each found configuration is, shortly enough to compare a whole file's worth at once. */
const describeConfig = (found: FoundPayloadConfig): string => `${found.kind.kind}:${found.body}`

const foundIn = (source: string): readonly string[] =>
  payloadConfigsIn(source).map((found: FoundPayloadConfig): string => describeConfig(found))

// Whether the reported body really is the text at the reported offset. `directFieldsIn` computes
// absolute field offsets from `bodyStart` and `body.length` together, so the two disagreeing puts every
// field on the wrong line.
const isAnchored = (source: string): boolean =>
  payloadConfigsIn(source).every(
    (found: FoundPayloadConfig): boolean =>
      source.slice(found.bodyStart, found.bodyStart + found.body.length) === found.body,
  )

// The forms exercised below are not configurations, and each used to be read as one. The trailing
// literal is what made the old reader dangerous rather than merely noisy: the unbounded forward search
// ran past the end of the statement and judged THAT literal as the collection.
const andALaterLiteral = (declaration: string): string =>
  `${declaration}\nconst unrelated = { anything: true }\n`

const firstConfig = (source: string): FoundPayloadConfig => {
  const [found]: readonly FoundPayloadConfig[] = payloadConfigsIn(source)
  if (found === undefined) {
    throw new Error('the source declares no configuration')
  }
  return found
}

describe('payloadConfigsIn', () => {
  it('reads the literal an annotation is written in front of', () => {
    expect(foundIn(`const Posts: CollectionConfig = { slug: 'posts' }`)).toEqual([
      "collection:{ slug: 'posts' }",
    ])
  })

  it('reads the literal a trailing satisfies is written behind', () => {
    expect(foundIn(`const Posts = { slug: 'posts' } satisfies CollectionConfig`)).toEqual([
      "collection:{ slug: 'posts' }",
    ])
  })

  it('reads an annotation carrying a generic argument', () => {
    expect(foundIn(`export const Posts: CollectionConfig<'posts'> = { slug: 'posts' }`)).toEqual([
      "collection:{ slug: 'posts' }",
    ])
  })

  it('reads a literal an arrow function returns in parentheses', () => {
    expect(foundIn(`const make = (): CollectionConfig => ({ slug: 'posts' })`)).toEqual([
      "collection:{ slug: 'posts' }",
    ])
  })

  it('reads a global apart from a collection', () => {
    expect(foundIn(`const Nav: GlobalConfig = { slug: 'nav' }`)).toEqual(["global:{ slug: 'nav' }"])
  })

  it('reads every configuration a file declares, in the order they are written', () => {
    const two: string = [
      `const Posts: CollectionConfig = { slug: 'posts' }`,
      `const Tags = { slug: 'tags' } satisfies CollectionConfig`,
    ].join('\n')
    expect(foundIn(two)).toEqual(["collection:{ slug: 'posts' }", "collection:{ slug: 'tags' }"])
  })

  it('reads a literal that spans several lines and spreads another object into itself', () => {
    const spread: string = `const Posts: CollectionConfig = {
  ...base,
  slug: 'posts',
  access: { read: anyone },
}`
    expect(payloadConfigsIn(spread)).toHaveLength(1)
    expect(isAnchored(spread)).toBe(true)
  })

  it('reports a body that is exactly the source text at the offset it reports', () => {
    const file: string = [
      `const Posts: CollectionConfig = { slug: 'posts', fields: [{ name: 'title' }] }`,
      `const Tags = { slug: 'tags' } satisfies CollectionConfig`,
      `const Nav: GlobalConfig = { slug: 'nav' }`,
    ].join('\n')
    expect(isAnchored(file)).toBe(true)
  })

  it('does not read a literal passed as an argument to a call', () => {
    expect(
      foundIn(andALaterLiteral(`const Jobs: CollectionConfig = withAccess({ slug: 'j' })`)),
    ).toEqual([])
  })

  it('does not read a literal that merely follows an annotation on an identifier', () => {
    expect(foundIn(andALaterLiteral(`const Jobs: CollectionConfig = builtByPayload`))).toEqual([])
  })

  it('does not read a parameter annotation', () => {
    expect(
      foundIn(
        andALaterLiteral(`const check = (config: CollectionConfig): void => { look(config) }`),
      ),
    ).toEqual([])
  })

  it('does not read an interface member', () => {
    expect(foundIn(andALaterLiteral(`interface Deps { readonly base: CollectionConfig }`))).toEqual(
      [],
    )
  })

  it('does not read a type alias member', () => {
    expect(foundIn(andALaterLiteral(`type Deps = { readonly base: CollectionConfig }`))).toEqual([])
  })

  // One declaration, two matches of the type name: the parameter's type-literal member and the return
  // annotation. Only the second governs a literal, so the configuration is reported once.
  it('reads a destructured factory once, through its return annotation alone', () => {
    const factory: string = `const make = ({ base }: { readonly base: CollectionConfig }): CollectionConfig => ({
  ...base,
  slug: 'jobs',
})`
    expect(payloadConfigsIn(factory)).toHaveLength(1)
    expect(isAnchored(factory)).toBe(true)
  })

  it('reads nothing from an annotation with no literal anywhere after it', () => {
    expect(foundIn(`const Posts: CollectionConfig = builtElsewhere`)).toEqual([])
  })
})

describe('directFieldsIn', () => {
  const withFields: string = `const Posts: CollectionConfig = {
  slug: 'posts',
  fields: [
    { name: 'title', type: 'text' },
    { name: 'body', type: 'richText', admin: { position: 'sidebar' } },
  ],
}`

  it('reads each object written directly in the fields array', () => {
    expect(
      directFieldsIn(withFields, firstConfig(withFields)).map(
        (field: { readonly body: string }): string => field.body,
      ),
    ).toEqual([
      `{ name: 'title', type: 'text' }`,
      `{ name: 'body', type: 'richText', admin: { position: 'sidebar' } }`,
    ])
  })

  // The line numbers come from `bodyStart` plus an offset inside the body, so an anchor that pointed at
  // a different literal reported every field against a line in that one.
  it('reports each field against the line it is written on', () => {
    expect(
      directFieldsIn(withFields, firstConfig(withFields)).map(
        (field: { readonly line: number }): number => field.line,
      ),
    ).toEqual([4, 5])
  })

  it('reads no fields from a configuration that declares none', () => {
    const bare: string = `const Posts: CollectionConfig = { slug: 'posts' }`
    expect(directFieldsIn(bare, firstConfig(bare))).toEqual([])
  })
})
