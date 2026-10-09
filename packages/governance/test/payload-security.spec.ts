import { describe, expect, it } from 'vitest'
import { INHERITED_ACCESS_REPORT_MARKER } from '../src/payload-defaults.js'
import {
  findPayloadSecurityViolations,
  type PayloadSecurityReport,
  parsePayloadSecurityReport,
  payloadSecurityOf,
} from '../src/payload-security.js'

const configWith = (auth: unknown, autoLogin: unknown = false): unknown => ({
  collections: [{ slug: 'users', auth }],
  admin: { autoLogin },
})
const validAuth: Readonly<Record<string, unknown>> = { maxLoginAttempts: 5, lockTime: 600_000, tokenExpiration: 7200 }
const findingsFor = (auth: unknown): readonly string[] =>
  findPayloadSecurityViolations(payloadSecurityOf(configWith(auth)))

describe('resolved authentication policy', () => {
  it('accepts resolved positive values', () => {
    expect(findingsFor(validAuth)).toEqual([])
  })
  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '5', null])('rejects attempt count %j', (value) => {
    expect(findingsFor({ ...validAuth, maxLoginAttempts: value })).toEqual([
      expect.stringContaining('auth.maxLoginAttempts'),
    ])
  })
  it.each(['lockTime', 'tokenExpiration'])('rejects invalid %s with its unit', (key) => {
    expect(findingsFor({ ...validAuth, [key]: 0 })).toEqual([expect.stringContaining(key)])
    expect(findingsFor({ ...validAuth, [key]: Number.POSITIVE_INFINITY })).toHaveLength(1)
  })
  it('does not apply native limits to disabled local authentication or non-auth collections', () => {
    expect(findingsFor({ disableLocalStrategy: true })).toEqual([])
    expect(findingsFor({ disableLocalStrategy: { enableFields: true } })).toEqual([])
    expect(findingsFor(false)).toEqual([])
    expect(findingsFor(undefined)).toEqual([])
  })
  it('fails incomplete native settings and malformed resolved collections', () => {
    expect(findingsFor({})).toHaveLength(3)
    expect(() => payloadSecurityOf({})).toThrow('collections')
    expect(() => payloadSecurityOf(configWith(true))).toThrow('resolved')
    expect(() => payloadSecurityOf({ collections: [{ auth: {} }] })).toThrow('slug')
    expect(() => payloadSecurityOf(configWith({ disableLocalStrategy: 0 }))).toThrow('disableLocalStrategy')
  })
})

describe('production auto-login', () => {
  it.each([{}, { prefillOnly: true }, { email: 'person@example.invalid', password: 'fixture' }, true, null])(
    'rejects enabled or malformed setting %j without returning its credentials',
    (autoLogin) => {
      const report: PayloadSecurityReport = payloadSecurityOf(configWith(validAuth, autoLogin))
      expect(findPayloadSecurityViolations(report)).toEqual([expect.stringContaining('admin.autoLogin')])
      expect(JSON.stringify(report)).not.toContain('person@example.invalid')
      expect(JSON.stringify(report)).not.toContain('fixture')
    },
  )
  it('accepts absent admin configuration', () => {
    expect(findPayloadSecurityViolations(payloadSecurityOf({ collections: [] }))).toEqual([])
  })
})

describe('security probe evidence', () => {
  it('round-trips the observed values alongside unrelated report fields', () => {
    const report: PayloadSecurityReport = payloadSecurityOf(configWith(validAuth))
    expect(parsePayloadSecurityReport(`${INHERITED_ACCESS_REPORT_MARKER}${JSON.stringify(report)}`)).toEqual(report)
  })
  it.each([
    {},
    { authentication: [] },
    { authentication: [], autoLogin: true },
    { authentication: [{ slug: 'users', local: true }], autoLogin: 'disabled' },
    { authentication: [null], autoLogin: 'disabled' },
  ])('rejects incomplete evidence %j', (report) => {
    expect(parsePayloadSecurityReport(`${INHERITED_ACCESS_REPORT_MARKER}${JSON.stringify(report)}`)).toBeUndefined()
  })
  it('retains invalid auto-login state for a policy finding', () => {
    const report: PayloadSecurityReport = payloadSecurityOf(configWith(validAuth, true))
    expect(parsePayloadSecurityReport(`${INHERITED_ACCESS_REPORT_MARKER}${JSON.stringify(report)}`)).toEqual(report)
  })
})
