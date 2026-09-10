import { describe, expect, it } from 'vitest'
import { CHECKOV_CHECKS, type CheckovCheck, checkovCheckList } from '../src/checkov-policy.js'

const CHECK_ID: RegExp = /^CKV_AWS_\d+$/

describe('CHECKOV_CHECKS', () => {
  // An empty catalogue would render an empty `--check`, and checkov reads that as every check rather
  // than none. The one assertion here that guards against a verdict nobody chose.
  it('enables at least one check', () => {
    expect(CHECKOV_CHECKS.length).toBeGreaterThan(0)
  })

  it('names every check by an identifier checkov would recognise', () => {
    const malformed: readonly CheckovCheck[] = CHECKOV_CHECKS.filter(
      (check: CheckovCheck): boolean => !CHECK_ID.test(check.id),
    )
    expect(malformed).toEqual([])
  })

  // A repeated id is not an error checkov reports; it is a list somebody edited twice.
  it('names each check once', () => {
    const ids: readonly string[] = CHECKOV_CHECKS.map((check: CheckovCheck): string => check.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  // The reason is what makes the audit re-readable when the pin moves and the catalogue is re-checked.
  it('records why every check is enabled', () => {
    const unexplained: readonly CheckovCheck[] = CHECKOV_CHECKS.filter(
      (check: CheckovCheck): boolean => check.reason.trim().length === 0,
    )
    expect(unexplained).toEqual([])
  })

  // The three left off deliberately: each states a policy about how an environment is run rather than a
  // defect in how it is written, and a deliberately ephemeral environment fails all three on day one.
  it.each(['CKV_AWS_133', 'CKV_AWS_139', 'CKV_AWS_293'])(
    'leaves %s off, because it is a policy choice rather than a defect',
    (id: string) => {
      expect(CHECKOV_CHECKS.map((check: CheckovCheck): string => check.id)).not.toContain(id)
    },
  )
})

describe('checkovCheckList', () => {
  it('renders the catalogue as the comma separated value the flag takes', () => {
    expect(checkovCheckList().split(',')).toHaveLength(CHECKOV_CHECKS.length)
  })

  it('renders the identifiers rather than the reasons', () => {
    expect(checkovCheckList()).toContain('CKV_AWS_274')
  })

  it('renders no whitespace, which the flag would carry into the argument', () => {
    expect(checkovCheckList()).not.toMatch(/\s/)
  })
})
