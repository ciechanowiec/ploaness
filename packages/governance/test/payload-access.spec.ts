import { describe, expect, it } from 'vitest'
import {
  findAnonymousDraftReads,
  findUndecidedSvgHeaders,
  findUndeclaredAccess,
  findUndeclaredVersionReads,
  findUnhardenedAuth,
  findUnlockableAuth,
  findUnrestrictedUploads,
} from '../src/payload-access.js'

const COMPLETE_ACCESS: string =
  'access: { create: isAdmin, read: isAdmin, update: isAdmin, delete: isAdmin },'

// An auth collection owes a fifth operation, and a versioned one owes a sixth. The fixtures below
// declare them so that a case about hardening or about drafts reports the rule it is named for alone.
const AUTH_ACCESS: string =
  'access: { create: isAdmin, read: isAdmin, update: isAdmin, delete: isAdmin, unlock: isAdmin },'

const VERSIONED_ACCESS: string =
  'access: { create: isAdmin, read: isAdmin, update: isAdmin, delete: isAdmin, readVersions: isAdmin },'

const rulesOf = (source: string): readonly string[] =>
  [
    ...findUndeclaredAccess(source),
    ...findUnhardenedAuth(source),
    ...findUnlockableAuth(source),
    ...findAnonymousDraftReads(source),
    ...findUndeclaredVersionReads(source),
    ...findUnrestrictedUploads(source),
    ...findUndecidedSvgHeaders(source),
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
    const source: string = `const A: CollectionConfig = { slug: 'a', ${AUTH_ACCESS} auth: true }`
    expect(rulesOf(source)).toEqual(['require-auth-hardening'])
  })

  it('accepts auth that declares both hardening keys', () => {
    const hardened: string = 'auth: { maxLoginAttempts: 5, lockTime: 600 }'
    const source: string = `const A: CollectionConfig = { slug: 'a', ${AUTH_ACCESS} ${hardened} }`
    expect(rulesOf(source)).toEqual([])
  })
})

describe('positive authentication hardening values', () => {
  it.each([
    'auth: { maxLoginAttempts: 0, lockTime: 600 }',
    'auth: { maxLoginAttempts: -1, lockTime: 600 }',
    'auth: { maxLoginAttempts: 5, lockTime: 0 }',
    'auth: { maxLoginAttempts: 5, lockTime: -600 }',
  ])('reports a disabled hardening value in %s', (auth: string) => {
    const source: string = `const A: CollectionConfig = { slug: 'a', ${AUTH_ACCESS} ${auth} }`
    expect(rulesOf(source)).toEqual(['require-auth-hardening'])
  })

  it('accepts positive numeric literals carrying separators', () => {
    const auth: string = 'auth: { maxLoginAttempts: 5, lockTime: 600_000 }'
    const source: string = `const A: CollectionConfig = { slug: 'a', ${AUTH_ACCESS} ${auth} }`
    expect(rulesOf(source)).toEqual([])
  })

  it('retains presence-only handling for values the pure reader cannot resolve', () => {
    const auth: string = 'auth: { maxLoginAttempts: MAX_ATTEMPTS, lockTime: LOCK_TIME }'
    const source: string = `const A: CollectionConfig = { slug: 'a', ${AUTH_ACCESS} ${auth} }`
    expect(rulesOf(source)).toEqual([])
  })
})

// Payload fills `unlock` in with the same default as the rest of the access block, so a collection can
// cap login attempts, lock the account, decide all four ordinary operations, and still let any signed-in
// user clear the lockout it just set. The cap is then enforced against nobody.
describe('require-unlock-access', () => {
  it('reports an auth collection whose access block omits unlock', () => {
    const auth: string = 'auth: { maxLoginAttempts: 5, lockTime: 600 }'
    const source: string = `const A: CollectionConfig = { slug: 'a', ${COMPLETE_ACCESS} ${auth} }`
    expect(rulesOf(source)).toEqual(['require-unlock-access'])
  })

  it('accepts an auth collection that decides who may unlock', () => {
    const auth: string = 'auth: { maxLoginAttempts: 5, lockTime: 600 }'
    const source: string = `const A: CollectionConfig = { slug: 'a', ${AUTH_ACCESS} ${auth} }`
    expect(rulesOf(source)).toEqual([])
  })

  it('says nothing about a collection that does not authenticate', () => {
    const source: string = `const A: CollectionConfig = { slug: 'a', ${COMPLETE_ACCESS} }`
    expect(rulesOf(source)).toEqual([])
  })

  it('names the operation it wants in the reason it gives', () => {
    const source: string = `const A: CollectionConfig = { slug: 'a', ${COMPLETE_ACCESS} auth: true }`
    expect(findUnlockableAuth(source)[0]?.reason).toContain('unlock')
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

  // The consequence named is the real one: the default is not public read, which the anonymous sweep
  // would catch, but every signed-in user, which it cannot.
  it('names the default the missing operations fall to', () => {
    const source: string = `const A: CollectionConfig = { slug: 'a', access: { read: isAdmin } }`
    expect(findUndeclaredAccess(source)[0]?.reason).toContain('admits every signed-in user')
  })

  it('accepts a global that declares only read and update', () => {
    const source: string = `const H: GlobalConfig = { slug: 'h', access: { read: isAdmin, update: isAdmin } }`
    expect(rulesOf(source)).toEqual([])
  })

  it('does not read a field-level access block as the collection own', () => {
    const field: string = `{ name: 'x', ${COMPLETE_ACCESS.replace(',', '')} }`
    const source: string = `const A: CollectionConfig = { slug: 'a', fields: [${field}] }`
    expect(rulesOf(source)).toEqual(['require-complete-access'])
  })
})

describe('no-anonymous-draft-reads', () => {
  const drafts: string = 'versions: { drafts: true },'

  it('reports an unconditionally true read on a drafting collection', () => {
    const open: string =
      'access: { read: () => true, create: x, update: x, delete: x, readVersions: x }'
    const source: string = `const A: CollectionConfig = { slug: 'a', ${drafts} ${open} }`
    expect(rulesOf(source)).toEqual(['no-anonymous-draft-reads'])
  })

  it('says nothing when drafts are not enabled', () => {
    const open: string = 'access: { read: () => true, create: x, update: x, delete: x }'
    const source: string = `const A: CollectionConfig = { slug: 'a', ${open} }`
    expect(rulesOf(source)).toEqual([])
  })

  // The access value runs to the end of the enclosing literal, so testing it whole reported a field
  // that grants nothing beyond itself as though the collection were open.
  it('does not read a field-level always-true read as the collection own', () => {
    const field: string = `{ name: 'x', access: { read: () => true } }`
    const source: string = `const A: CollectionConfig = { slug: 'a', ${drafts} ${VERSIONED_ACCESS} fields: [${field}] }`
    expect(rulesOf(source)).toEqual([])
  })
})

// A version carries the whole document, and `readVersions` is the one operation Payload never fills in,
// so an undeclared rule falls through to "any signed-in user". A read narrowed to an audience is then
// bypassed by asking for a version of the document instead of the document, which is why this is asked
// wherever versions are kept rather than only where drafts are.
describe('require-version-read-access', () => {
  it('reports a collection that keeps versions and decides no version read', () => {
    const source: string = `const A: CollectionConfig = { slug: 'a', versions: { drafts: true }, ${COMPLETE_ACCESS} }`
    expect(rulesOf(source)).toEqual(['require-version-read-access'])
  })

  it('accepts a collection that decides who may read a version', () => {
    const source: string = `const A: CollectionConfig = { slug: 'a', versions: true, ${VERSIONED_ACCESS} }`
    expect(rulesOf(source)).toEqual([])
  })

  it('reports a global that keeps versions, which Payload leaves undeclared too', () => {
    const access: string = 'access: { read: isAdmin, update: isAdmin },'
    const source: string = `const H: GlobalConfig = { slug: 'h', versions: true, ${access} }`
    expect(rulesOf(source)).toEqual(['require-version-read-access'])
  })

  it('says nothing about a config that keeps no versions', () => {
    const source: string = `const A: CollectionConfig = { slug: 'a', ${COMPLETE_ACCESS} }`
    expect(rulesOf(source)).toEqual([])
  })

  it('reads an explicit disable as keeping no versions', () => {
    const source: string = `const A: CollectionConfig = { slug: 'a', versions: false, ${COMPLETE_ACCESS} }`
    expect(rulesOf(source)).toEqual([])
  })

  it('names the operation it wants in the reason it gives', () => {
    const source: string = `const A: CollectionConfig = { slug: 'a', versions: true, ${COMPLETE_ACCESS} }`
    expect(findUndeclaredVersionReads(source)[0]?.reason).toContain('readVersions')
  })
})

// mimeTypes defaults to undefined, so an upload collection takes whatever a client sends until the
// project says otherwise, and an SVG served from this origin is script that runs as the site.
describe('require-upload-restrictions', () => {
  it('reports the bare enable, which restricts nothing', () => {
    const source: string = `const A: CollectionConfig = { slug: 'a', ${COMPLETE_ACCESS} upload: true }`
    expect(rulesOf(source)).toEqual(['require-upload-restrictions'])
  })

  it('reports an upload block that declares no mimeTypes', () => {
    const upload: string = `upload: { staticDir: 'media' }`
    const source: string = `const A: CollectionConfig = { slug: 'a', ${COMPLETE_ACCESS} ${upload} }`
    expect(rulesOf(source)).toEqual(['require-upload-restrictions'])
  })

  it('accepts an upload block that restricts mimeTypes', () => {
    const upload: string = `upload: { mimeTypes: ['image/png'] }`
    const source: string = `const A: CollectionConfig = { slug: 'a', ${COMPLETE_ACCESS} ${upload} }`
    expect(rulesOf(source)).toEqual([])
  })

  it('says nothing about a collection that uploads nothing', () => {
    expect(rulesOf(`const A: CollectionConfig = { slug: 'a', ${COMPLETE_ACCESS} }`)).toEqual([])
  })

  it('names the restriction it wants in the reason it gives', () => {
    const source: string = `const A: CollectionConfig = { slug: 'a', ${COMPLETE_ACCESS} upload: true }`
    expect(findUnrestrictedUploads(source)[0]?.reason).toContain('mimeTypes')
  })
})

// A governed project cannot write the untyped form: `explicit-function-return-type` requires the
// annotation, so `read: (): boolean => true` is the only always-true spelling that reaches these rules.
// The detector demanded `()` immediately before the arrow, so it matched none of them, and both rules
// below reported nothing on precisely the code they exist to catch.
describe('the always-true form a governed project actually writes', () => {
  it('reports a typed always-true read on a drafting collection', () => {
    const drafts: string = 'versions: { drafts: true },'
    const open: string =
      'access: { read: (): boolean => true, create: x, update: x, delete: x, readVersions: x }'
    const source: string = `const A: CollectionConfig = { slug: 'a', ${drafts} ${open} }`
    expect(rulesOf(source)).toEqual(['no-anonymous-draft-reads'])
  })

  it('still accepts a typed rule that returns false', () => {
    const drafts: string = 'versions: { drafts: true },'
    const closed: string =
      'access: { read: (): boolean => false, create: x, update: x, delete: x, readVersions: x }'
    const source: string = `const A: CollectionConfig = { slug: 'a', ${drafts} ${closed} }`
    expect(rulesOf(source)).toEqual([])
  })
})

// Payload adds `script-src 'none'` to an SVG response and refuses a scripted SVG, but only on the branch
// where content detection found nothing: an SVG opening with an XML declaration is retyped from XML and
// skips that check. A collection that admits SVG must therefore decide the headers itself. Admission is
// read as Payload reads it - an entry loses its first `*` and is a prefix - and a list that cannot be
// read from the file is taken to admit it, because silence here would mean "safe".
const uploading = (upload: string): string =>
  `const A: CollectionConfig = { slug: 'a', ${COMPLETE_ACCESS} upload: { ${upload} } }`

describe('require-svg-response-headers', () => {
  const svgRule: readonly string[] = ['require-svg-response-headers']

  it('reports an inline list naming image/svg+xml without response headers', () => {
    expect(rulesOf(uploading("mimeTypes: ['image/png', 'image/svg+xml']"))).toEqual(svgRule)
  })

  it('reports the image wildcard, which Payload reads as admitting SVG', () => {
    expect(rulesOf(uploading("mimeTypes: ['image/*']"))).toEqual(svgRule)
  })

  it.each(['[]', "['*']", "['image/svg']", "['image']", "['']"])(
    "reads %s by prefix, as Payload's own check does",
    (list) => {
      expect(rulesOf(uploading(`mimeTypes: ${list}`))).toEqual(svgRule)
    },
  )

  it('accepts an inline list that excludes SVG', () => {
    expect(rulesOf(uploading("mimeTypes: ['image/png', 'image/jpeg']"))).toEqual([])
  })

  it('accepts a list written in double quotes across several lines', () => {
    const upload: string =
      'mimeTypes: [\n  "image/png",\n  "application/pdf",\n],\n  staticDir: "media"'
    expect(rulesOf(uploading(upload))).toEqual([])
  })

  it('accepts the star-slash-star entry Payload itself reads as admitting nothing', () => {
    expect(rulesOf(uploading("mimeTypes: ['*/*']"))).toEqual([])
  })

  it('accepts response headers beside an SVG-admitting list', () => {
    const upload: string = "mimeTypes: ['image/svg+xml'], modifyResponseHeaders: hardenSvg"
    expect(rulesOf(uploading(upload))).toEqual([])
  })

  it('accepts handlers, which answer before the headers hook runs', () => {
    expect(rulesOf(uploading("mimeTypes: ['image/*'], handlers: [serveFromBucket]"))).toEqual([])
  })

  it.each([
    ['a list declared elsewhere', 'IMAGE_TYPES'],
    ['a list spread from another', '[...IMAGE_TYPES]'],
    ['a list with one computed entry', "['image/png', svgType]"],
    ['a computed list', 'imageTypes()'],
    ['a template entry carrying a substitution', `[\`image/\${kind}\`]`],
  ])('reports %s, which it cannot read', (_shape, list) => {
    expect(rulesOf(uploading(`mimeTypes: ${list}`))).toEqual(svgRule)
  })

  it('names the provable entry over an unreadable neighbour', () => {
    const reason: string | undefined = findUndecidedSvgHeaders(
      uploading("mimeTypes: [...IMAGE_TYPES, 'image/svg+xml']"),
    )[0]?.reason
    expect(reason).toContain("'image/svg+xml' admits")
  })

  it('says nothing when mimeTypes is absent, which the restriction rule reports', () => {
    expect(rulesOf(uploading("staticDir: 'media'"))).toEqual(['require-upload-restrictions'])
  })

  it('says nothing about the bare enable, which the restriction rule reports', () => {
    const source: string = `const A: CollectionConfig = { slug: 'a', ${COMPLETE_ACCESS} upload: true }`
    expect(rulesOf(source)).toEqual(['require-upload-restrictions'])
  })

  it("does not read a mimeTypes key of the next block as the upload block's own", () => {
    const source: string =
      `const A: CollectionConfig = { slug: 'a', ${COMPLETE_ACCESS} ` +
      "upload: { staticDir: 'x' }, admin: { mimeTypes: ['image/svg+xml'] } }"
    expect(rulesOf(source)).toEqual(['require-upload-restrictions'])
  })

  it('says nothing about a global', () => {
    const source: string =
      "const A: GlobalConfig = { slug: 'a', access: { read: isAdmin, update: isAdmin }, " +
      "upload: { mimeTypes: ['image/svg+xml'] } }"
    expect(rulesOf(source)).toEqual([])
  })

  it('tells an unreadable list what would make it readable', () => {
    const reason: string | undefined = findUndecidedSvgHeaders(
      uploading('mimeTypes: IMAGE_TYPES'),
    )[0]?.reason
    expect(reason).toContain('write the list inline')
    expect(reason).toContain('modifyResponseHeaders')
  })

  it('names the empty list for what it admits', () => {
    const reason: string | undefined = findUndecidedSvgHeaders(uploading('mimeTypes: []'))[0]
      ?.reason
    expect(reason).toContain('empty mimeTypes list admits every type')
  })
})
