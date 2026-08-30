import { describe, expect, it } from 'vitest'
import { findPayloadViolations } from '../src/payload-policy.js'

const rulesOf = (source: string): readonly string[] =>
  findPayloadViolations(source).map((violation) => violation.rule)

describe('require-user-access-control', () => {
  it('flags a user whose access control remains at the bypassing default', () => {
    expect(rulesOf("await payload.find({ collection: 'p', depth: 0, user })")).toEqual([
      'require-user-access-control',
    ])
  })

  it('accepts both spellings of user with a literal false', () => {
    expect(
      rulesOf("await payload.find({ collection: 'p', depth: 0, user, overrideAccess: false })"),
    ).toEqual([])
    expect(
      rulesOf(
        "await this.payload.find({ collection: 'p', depth: 0, user: actor, overrideAccess: false })",
      ),
    ).toEqual([])
  })

  it('requires a value it can prove is false', () => {
    expect(
      rulesOf("await payload.find({ collection: 'p', depth: 0, user, overrideAccess })"),
    ).toEqual(['require-user-access-control'])
  })

  it('leaves an explicit true to the existing rule without duplicating the finding', () => {
    expect(
      rulesOf("await payload.find({ collection: 'p', depth: 0, user, overrideAccess: true })"),
    ).toEqual(['no-override-access'])
  })

  it('judges only top-level options on a recognised Payload receiver', () => {
    expect(
      rulesOf("await payload.create({ collection: 'p', data: { user }, overrideAccess: false })"),
    ).toEqual([])
    expect(rulesOf('await client.find({ user, overrideAccess: false })')).toEqual([])
    expect(rulesOf('await payload.find(options)')).toEqual([])
  })

  it('accepts only a false that follows the last top-level spread', () => {
    expect(rulesOf('await payload.create({ user, ...base, overrideAccess: false, data })')).toEqual(
      [],
    )
    expect(rulesOf('await payload.create({ user, overrideAccess: false, ...base, data })')).toEqual(
      ['require-user-access-control'],
    )
    expect(
      rulesOf('await payload.create({ user, overrideAccess: false, data: { ...base } })'),
    ).toEqual([])
  })
})

describe('require-user-access-control operation coverage', () => {
  it.each([
    'count',
    'create',
    'delete',
    'find',
    'findByID',
    'findDistinct',
    'findGlobal',
    'findGlobalVersionByID',
    'findGlobalVersions',
    'findVersionByID',
    'findVersions',
    'restoreGlobalVersion',
    'restoreVersion',
    'update',
    'updateGlobal',
  ])('covers the documented %s operation', (operation: string) => {
    expect(rulesOf(`await payload.${operation}({ user })`)).toContain('require-user-access-control')
  })
})
