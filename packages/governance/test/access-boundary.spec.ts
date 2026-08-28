import { describe, expect, it } from 'vitest'
import {
  type AccessReport,
  describeGrant,
  type Granted,
  grantedPermissions,
  isPermitted,
  JUDGED_OPERATIONS,
  type ReportedPermission,
  undeclaredGrants,
} from '../src/access-boundary.js'
import type { PublicAccess } from '../src/settings.js'

const NOTHING_DECLARED: readonly PublicAccess[] = []

const declaring = (entity: string, operation: string): readonly PublicAccess[] => [
  { entity, operation, reason: 'the public site reads it' },
]

// The two shapes Payload's own sanitisation produces, named for what distinguishes them. An
// unconstrained grant is collapsed to a bare `true`; the object survives only when a `where` clause
// does. A denial is deleted from the response rather than sent as false, which is why absence is the
// third case rather than an edge one.
const OPEN: ReportedPermission = true
const CONSTRAINED: ReportedPermission = {
  permission: true,
  where: { _status: { equals: 'published' } },
}

describe('isPermitted', () => {
  it('readsTheBareBooleanAnUnconstrainedGrantCollapsesTo', () => {
    expect(isPermitted(OPEN)).toBe(true)
  })

  it('readsThePermissionObjectAConstrainedGrantKeeps', () => {
    expect(isPermitted(CONSTRAINED)).toBe(true)
  })

  it('treatsAnAbsentOperationAsDenied', () => {
    expect(isPermitted(undefined)).toBe(false)
  })

  it('treatsAFalseBooleanAsDenied', () => {
    expect(isPermitted(false)).toBe(false)
  })

  it('treatsAPermissionObjectSayingFalseAsDenied', () => {
    expect(isPermitted({ permission: false })).toBe(false)
  })
})

describe('grantedPermissions', () => {
  // The regression this module exists for: `read: anyone` reaches the sweep as a bare `true`, and a
  // reader that only understood the object shape reported the collection constrained to published
  // documents while staying silent on the one open to every stranger.
  it('reportsAnUnconstrainedGrantBesideAConstrainedOne', () => {
    const report: AccessReport = {
      collections: {
        media: { read: OPEN },
        pages: { read: CONSTRAINED },
      },
    }
    expect(
      grantedPermissions(report).map((granted: Granted): string => describeGrant(granted)),
    ).toEqual(['media.read', 'pages.read'])
  })

  it('readsGlobalsAsWellAsCollections', () => {
    const report: AccessReport = { globals: { configuration: { read: OPEN } } }
    expect(
      grantedPermissions(report).map((granted: Granted): string => describeGrant(granted)),
    ).toEqual(['configuration.read'])
  })

  it('reportsEveryWriteOperationAndNotOnlyRead', () => {
    const report: AccessReport = {
      collections: { pages: { create: OPEN, delete: OPEN, read: OPEN, update: OPEN } },
    }
    expect(grantedPermissions(report)).toHaveLength(JUDGED_OPERATIONS.length)
  })

  // Payload reports field-level entries and version operations beside the four this sweep judges, and
  // collapses a fully-permitted `fields` map to a bare `true`. Reading every key would name entries no
  // `publicAccess` entry can be written against.
  it('ignoresKeysThatAreNotTheOperationsItJudges', () => {
    const report: AccessReport = {
      collections: { pages: { fields: OPEN, readVersions: OPEN } },
    }
    expect(grantedPermissions(report)).toEqual([])
  })

  it('reportsNothingForAReportWithNeitherHalf', () => {
    expect(grantedPermissions({})).toEqual([])
  })
})

describe('undeclaredGrants', () => {
  it('reportsAGrantTheProjectHasNotRecorded', () => {
    const report: AccessReport = { collections: { media: { read: OPEN } } }
    expect(undeclaredGrants(report, NOTHING_DECLARED)).toEqual(['media.read'])
  })

  it('passesAGrantTheProjectRecordedWithAReason', () => {
    const report: AccessReport = { collections: { media: { read: OPEN } } }
    expect(undeclaredGrants(report, declaring('media', 'read'))).toEqual([])
  })

  it('holdsADeclarationToBothTheEntityAndTheOperation', () => {
    const report: AccessReport = { collections: { media: { delete: OPEN } } }
    expect(undeclaredGrants(report, declaring('media', 'read'))).toEqual(['media.delete'])
  })

  it('doesNotLetOneEntitysDeclarationCoverAnother', () => {
    const report: AccessReport = { collections: { users: { read: OPEN } } }
    expect(undeclaredGrants(report, declaring('media', 'read'))).toEqual(['users.read'])
  })
})
