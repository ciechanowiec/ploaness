import { describe, expect, it } from 'vitest'
import { findEndpointViolations, findPayloadViolations } from '../src/payload-policy.js'

describe('explicit protected Payload options', () => {
  it('accepts protected properties after an options spread', () => {
    expect(
      findPayloadViolations(
        'await req.payload.find({ ...options, depth: 0, req, overrideAccess: false })',
      ),
    ).toEqual([])
  })

  it('refuses a spread that can replace protected properties', () => {
    const source: string =
      'await req.payload.find({ depth: 0, req, overrideAccess: false, ...options })'
    expect(findPayloadViolations(source).map((finding) => finding.rule)).toEqual([
      'no-unbounded-find',
      'no-unthreaded-req',
      'require-user-access-control',
    ])
  })

  it('preserves nested application data spreads', () => {
    expect(
      findPayloadViolations(
        'await req.payload.create({ collection: "posts", data: { ...data }, req })',
      ),
    ).toEqual([])
  })

  it.each(['options', 'makeOptions({ depth: 0 })', 'options ?? { depth: 0 }'])(
    'reports opaque options rather than inferring properties from %s',
    (options: string) => {
      expect(
        findPayloadViolations(`await payload.find(${options})`).map((finding) => finding.rule),
      ).toEqual(['require-explicit-payload-options'])
    },
  )

  it.each([
    'src/endpoints/posts.ts',
    'src/app/api/posts/route.ts',
    'src/app/(site)/posts/route.ts',
  ])('requires effective access control in %s', (file: string) => {
    expect(
      findEndpointViolations(file, 'await payload.find({ depth: 0 })').map(
        (finding) => finding.rule,
      ),
    ).toEqual(['require-endpoint-access'])
    expect(
      findEndpointViolations(
        file,
        'await payload.find({ ...options, depth: 0, overrideAccess: false })',
      ),
    ).toEqual([])
    expect(
      findEndpointViolations(
        file,
        'await payload.find({ depth: 0, overrideAccess: false, ...options })',
      ),
    ).toHaveLength(1)
  })

  it('does not apply endpoint policy to a component or an unrelated method', () => {
    expect(
      findEndpointViolations('src/app/posts/page.tsx', 'await payload.find({ depth: 0 })'),
    ).toEqual([])
    expect(findEndpointViolations('src/app/api/posts/route.ts', 'rows.find(options)')).toEqual([])
  })
})
