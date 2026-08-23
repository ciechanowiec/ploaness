import { describe, expect, it } from 'vitest'
import { findPayloadViolations, stripComments, topLevelSlice } from '../src/payload-policy.js'

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
    const source = ['await payload.find({', "  collection: 'posts',", '  depth: 1,', '})'].join(
      '\n',
    )
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

  it('recognises the request-scoped payload instance', () => {
    expect(rulesOf("await req.payload.find({ collection: 'posts' })")).toEqual([
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

describe('no-deep-relative-imports', () => {
  it('flags a parent-relative import', () => {
    expect(rulesOf("import { thing } from '../lib/thing'")).toEqual(['no-deep-relative-imports'])
  })

  it('accepts a same-directory import', () => {
    expect(rulesOf("import { thing } from './thing'")).toEqual([])
  })

  it('exempts test helpers and the generated import map', () => {
    expect(rulesOf("import { seed } from '../helpers/seed'")).toEqual([])
    expect(rulesOf("import { importMap } from '../importMap'")).toEqual([])
  })
})

describe('require-collection-access', () => {
  it('flags a collection that declares no access', () => {
    const source = "export const Posts: CollectionConfig = { slug: 'posts', fields: [] }"
    expect(rulesOf(source)).toEqual(['require-collection-access'])
  })

  it('accepts a collection that declares access', () => {
    const source =
      "export const Posts: CollectionConfig = { slug: 'posts', access: { read: () => true }, fields: [] }"
    expect(rulesOf(source)).toEqual([])
  })

  it('ignores a file that declares no collection', () => {
    expect(rulesOf('export const value = 1')).toEqual([])
  })
})

describe('prose is never mistaken for code', () => {
  it('ignores a banned construct named in a line comment', () => {
    const source = '// no banned `overrideAccess: true` flag is needed here\nexport const x = 1'
    expect(rulesOf(source)).toEqual([])
  })

  it('ignores a banned construct named in a block comment', () => {
    const source =
      "/*\n * Never write payload.find({ collection: 'p' }) unbounded.\n */\nexport const x = 1"
    expect(rulesOf(source)).toEqual([])
  })

  it('still reports the construct when it is real code beside the comment', () => {
    const source =
      "// explaining overrideAccess\nawait payload.find({ collection: 'p', depth: 0, overrideAccess: true })"
    expect(rulesOf(source)).toEqual(['no-override-access'])
  })

  it('reports the line of the code, not of the comment', () => {
    const source = [
      '// a preamble',
      '// another line',
      "await payload.find({ collection: 'p' })",
    ].join('\n')
    expect(findPayloadViolations(source)[0]?.line).toBe(3)
  })

  it('does not treat escaped slashes in a regex literal as a comment', () => {
    const source = "const pattern = /https:\\/\\//\nawait payload.find({ collection: 'p' })"
    expect(rulesOf(source)).toEqual(['no-unbounded-find'])
  })
})

describe('require-collection-access precision', () => {
  it('ignores an array of already-defined collections', () => {
    const source = 'export const collections: CollectionConfig[] = [Users, Media]'
    expect(rulesOf(source)).toEqual([])
  })

  it('still flags a real collection definition', () => {
    const source = "export const Users: CollectionConfig = { slug: 'users', fields: [] }"
    expect(rulesOf(source)).toEqual(['require-collection-access'])
  })
})

describe('stripComments', () => {
  it('preserves line count so reported positions stay accurate', () => {
    const source = '/* a\n block\n comment */\ncode'
    expect(stripComments(source).split('\n')).toHaveLength(4)
  })

  it('leaves string literals untouched', () => {
    expect(stripComments("const url = 'https://example.com'")).toContain('https://example.com')
  })
})
