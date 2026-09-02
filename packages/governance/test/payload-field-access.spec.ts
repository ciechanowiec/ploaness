import { describe, expect, it } from 'vitest'
import { findUnprotectedPrivilegedFields } from '../src/payload-field-access.js'
import type { PayloadViolation } from '../src/payload-source.js'

const COLLECTION_ACCESS: string =
  'access: { create: admins, read: admins, update: admins, delete: admins },'

const collectionWith = (
  field: string,
  auth: string = 'auth: { maxLoginAttempts: 5, lockTime: 600 },',
): string =>
  `const Users: CollectionConfig = { slug: 'users', ${auth} ${COLLECTION_ACCESS} fields: [${field}] }`

const rulesOf = (source: string): readonly string[] =>
  findUnprotectedPrivilegedFields(source).map(
    (violation: PayloadViolation): string => violation.rule,
  )

const protectedField = (name: string): string =>
  `{ name: '${name}', type: 'text', access: { create: admins, update: admins } }`

describe('require-privileged-field-access', () => {
  it.each([
    'role',
    'roles',
    'isAdmin',
    'isStaff',
    'permission',
    'permissions',
    'capability',
    'capabilities',
  ])('requires create and update access for %s', (name: string) => {
    expect(rulesOf(collectionWith(`{ name: '${name}', type: 'text' }`))).toEqual([
      'require-privileged-field-access',
    ])
  })

  it('accepts a privileged field that declares both operations', () => {
    expect(rulesOf(collectionWith(protectedField('roles')))).toEqual([])
  })

  it('reports create when only update is protected', () => {
    const findings: readonly PayloadViolation[] = findUnprotectedPrivilegedFields(
      collectionWith("{ name: 'roles', type: 'text', access: { update: admins } }"),
    )
    expect(findings[0]?.reason).toContain('create is not protected')
  })

  it('reports update when only create is protected', () => {
    const findings: readonly PayloadViolation[] = findUnprotectedPrivilegedFields(
      collectionWith("{ name: 'roles', type: 'text', access: { create: admins } }"),
    )
    expect(findings[0]?.reason).toContain('update is not protected')
  })

  it('requires the keys to be visible instead of trusting an imported access object', () => {
    const field: string = "{ name: 'roles', type: 'text', access: privilegedFieldAccess }"
    expect(rulesOf(collectionWith(field))).toEqual(['require-privileged-field-access'])
  })

  it('does not let a spread stand in for an absent operation', () => {
    const field: string =
      "{ name: 'roles', type: 'text', access: { ...baseAccess, update: admins } }"
    expect(rulesOf(collectionWith(field))).toEqual(['require-privileged-field-access'])
  })
})

describe('the privilege rule boundary', () => {
  it('does not judge a non-auth collection', () => {
    expect(rulesOf(collectionWith("{ name: 'roles', type: 'text' }", ''))).toEqual([])
  })

  it('does not judge a collection that explicitly disables auth', () => {
    expect(rulesOf(collectionWith("{ name: 'roles', type: 'text' }", 'auth: false,'))).toEqual([])
  })

  it('does not judge a global', () => {
    const source: string =
      "const Settings: GlobalConfig = { slug: 'settings', auth: true, fields: [{ name: 'roles', type: 'text' }] }"
    expect(rulesOf(source)).toEqual([])
  })

  it('uses exact names rather than treating an admin note as authority', () => {
    expect(rulesOf(collectionWith("{ name: 'adminNotes', type: 'textarea' }"))).toEqual([])
  })

  it('does not read a nested subfield as a top-level account authority', () => {
    const field: string =
      "{ name: 'profile', type: 'group', fields: [{ name: 'roles', type: 'text' }] }"
    expect(rulesOf(collectionWith(field))).toEqual([])
  })

  it('does not guess through an imported fields array', () => {
    const source: string = [
      "const Users: CollectionConfig = { slug: 'users', auth: true,",
      COLLECTION_ACCESS,
      'fields: userFields }',
    ].join(' ')
    expect(rulesOf(source)).toEqual([])
  })
})

describe('the shared config reader used by the field rule', () => {
  it('judges a generic CollectionConfig annotation', () => {
    const source: string = collectionWith("{ name: 'roles', type: 'text' }").replace(
      'CollectionConfig',
      "CollectionConfig<'users'>",
    )
    expect(rulesOf(source)).toEqual(['require-privileged-field-access'])
  })

  it('judges the satisfies form whose type follows its value', () => {
    const body: string = collectionWith("{ name: 'roles', type: 'text' }")
      .replace('const Users: CollectionConfig = ', 'const Users = ')
      .concat(' satisfies CollectionConfig')
    expect(rulesOf(body)).toEqual(['require-privileged-field-access'])
  })

  it('judges every config in a file and reports the field own line', () => {
    const source: string = [
      collectionWith(protectedField('roles')),
      collectionWith("{ name: 'isAdmin', type: 'checkbox' }").replace('Users', 'Editors'),
    ].join('\n')
    const findings: readonly PayloadViolation[] = findUnprotectedPrivilegedFields(source)
    expect(findings).toHaveLength(1)
    expect(findings[0]?.line).toBe(2)
  })
})
