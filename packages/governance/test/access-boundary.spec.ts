import { describe, expect, it } from 'vitest'
import {
  type AccessReport,
  describeGrant,
  type Granted,
  grantedPermissions,
  isPermitted,
  JUDGED_OPERATIONS,
  type ReportedPermission,
  staleDeclarations,
  undeclaredGrants,
} from '../src/access-boundary.js'
import type { PublicAccess } from '../src/settings.js'

const NOTHING_DECLARED: readonly PublicAccess[] = []

const declaring = (entity: string, operation: string): readonly PublicAccess[] => [
  { entity, operation, reason: 'the public site reads it' },
]

const declaringFields = (
  entity: string,
  operation: string,
  fields: readonly string[],
): readonly PublicAccess[] => [{ entity, operation, reason: 'the public site reads it', fields }]

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

describe('grantedPermissions over the field map', () => {
  it('namesAFieldGrantByTheEntityTheOperationAndTheField', () => {
    const report: AccessReport = {
      collections: { leaderboard: { read: OPEN, fields: { displayName: { read: OPEN } } } },
    }
    expect(
      grantedPermissions(report).map((granted: Granted): string => describeGrant(granted)),
    ).toEqual(['leaderboard.read', 'leaderboard.read.displayName'])
  })

  // The rule that keeps this free of findings nobody can answer. Payload reports a field's own verdict
  // whether or not the operation carrying it is reachable, so an auth collection that denies `read` to
  // a stranger still lists fields saying `read: true`. Those name no exposure.
  it('ignoresAFieldGrantOnAnOperationTheEntityItselfDenies', () => {
    const report: AccessReport = {
      collections: { users: { create: OPEN, fields: { email: { create: OPEN, read: OPEN } } } },
    }
    expect(
      grantedPermissions(report).map((granted: Granted): string => describeGrant(granted)),
    ).toEqual(['users.create', 'users.create.email'])
  })

  // An array field carries a field map of its own, and two arrays on one collection routinely share a
  // field name. The path is what tells `playerFleet.row` from `aiShots.row`.
  it('joinsANestedFieldOntoThePathThatReachesIt', () => {
    const report: AccessReport = {
      collections: {
        games: {
          create: OPEN,
          fields: { playerShots: { create: OPEN, fields: { row: { create: OPEN } } } },
        },
      },
    }
    expect(
      grantedPermissions(report).map((granted: Granted): string => describeGrant(granted)),
    ).toEqual(['games.create', 'games.create.playerShots', 'games.create.playerShots.row'])
  })

  // Payload collapses a fully permitted field map to a bare `true`, which says every field without
  // naming one. Reporting nothing there would make the most open case the least judged.
  it('namesACollapsedFieldMapAsEveryField', () => {
    const report: AccessReport = { collections: { pages: { read: OPEN, fields: true } } }
    expect(
      grantedPermissions(report).map((granted: Granted): string => describeGrant(granted)),
    ).toEqual(['pages.read', 'pages.read.*'])
  })

  it('readsAConstrainedFieldGrantAsPermittedJustAsAnEntityOne', () => {
    const report: AccessReport = {
      collections: { pages: { read: OPEN, fields: { body: { read: CONSTRAINED } } } },
    }
    expect(
      grantedPermissions(report).map((granted: Granted): string => describeGrant(granted)),
    ).toEqual(['pages.read', 'pages.read.body'])
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

describe('undeclaredGrants over the field map', () => {
  const Leaderboard: AccessReport = {
    collections: {
      leaderboard: { read: OPEN, fields: { displayName: { read: OPEN }, player: { read: OPEN } } },
    },
  }

  it('passesAFieldTheProjectListed', () => {
    const declared: readonly PublicAccess[] = declaringFields('leaderboard', 'read', [
      'displayName',
      'player',
    ])
    expect(undeclaredGrants(Leaderboard, declared)).toEqual([])
  })

  // The defect this whole half exists for: the entity grant was declared and correct, and the field
  // beneath it exposed the account behind every row with nothing to say so.
  it('reportsAFieldTheProjectDidNotList', () => {
    const declared: readonly PublicAccess[] = declaringFields('leaderboard', 'read', [
      'displayName',
    ])
    expect(undeclaredGrants(Leaderboard, declared)).toEqual(['leaderboard.read.player'])
  })

  it('doesNotLetAnEntityDeclarationAloneCoverItsFields', () => {
    expect(undeclaredGrants(Leaderboard, declaring('leaderboard', 'read'))).toEqual([
      'leaderboard.read.displayName',
      'leaderboard.read.player',
    ])
  })

  // `*` is a path Payload produced, not a wildcard a project may write for itself: it matches the
  // collapsed grant and nothing else, so no declaration can stand in for a field added later.
  it('doesNotLetAStarDeclarationStandForANamedField', () => {
    const declared: readonly PublicAccess[] = declaringFields('leaderboard', 'read', ['*'])
    expect(undeclaredGrants(Leaderboard, declared)).toEqual([
      'leaderboard.read.displayName',
      'leaderboard.read.player',
    ])
  })

  it('passesTheCollapsedGrantWhenTheProjectDeclaredEveryField', () => {
    const report: AccessReport = { collections: { pages: { read: OPEN, fields: true } } }
    const declared: readonly PublicAccess[] = declaringFields('pages', 'read', ['*'])
    expect(undeclaredGrants(report, declared)).toEqual([])
  })

  it('holdsAFieldDeclarationToItsOperation', () => {
    const report: AccessReport = {
      collections: { media: { create: OPEN, read: OPEN, fields: { alt: { create: OPEN } } } },
    }
    const declared: readonly PublicAccess[] = [
      ...declaringFields('media', 'read', ['alt']),
      ...declaring('media', 'create'),
    ]
    expect(undeclaredGrants(report, declared)).toEqual(['media.create.alt'])
  })
})

// The one pattern a project may write. An upload collection with eight renditions reports fifty-seven
// paths beneath `sizes`, so a trailing `.**` declares the group and everything under it at once. It is
// bounded rather than a wildcard: only a trailing `.**` on a star-free prefix is honoured, it stops at
// the dot boundary, and every other spelling is a literal that matches nothing - the safe direction.
describe('undeclaredGrants over a declared subtree', () => {
  const Media: AccessReport = {
    collections: {
      media: {
        read: OPEN,
        fields: {
          alt: { read: OPEN },
          sizes: {
            read: OPEN,
            fields: {
              thumbnail: { read: OPEN, fields: { url: { read: OPEN }, width: { read: OPEN } } },
            },
          },
          sizesLegacy: { read: OPEN, fields: { url: { read: OPEN } } },
        },
      },
    },
  }

  it('coversEveryFieldBeneathADeclaredSubtree', () => {
    const declared: readonly PublicAccess[] = declaringFields('media', 'read', [
      'alt',
      'sizes.**',
      'sizesLegacy',
      'sizesLegacy.url',
    ])
    expect(undeclaredGrants(Media, declared)).toEqual([])
  })

  it('coversTheGroupASubtreeDeclarationNames', () => {
    const declared: readonly PublicAccess[] = declaringFields('media', 'read', ['sizes.**'])
    expect(undeclaredGrants(Media, declared)).not.toContain('media.read.sizes')
  })

  it('coversAMapPayloadCollapsedBeneathADeclaredSubtree', () => {
    const report: AccessReport = {
      collections: { media: { read: OPEN, fields: { sizes: { read: OPEN, fields: true } } } },
    }
    const declared: readonly PublicAccess[] = declaringFields('media', 'read', ['sizes.**'])
    expect(undeclaredGrants(report, declared)).toEqual([])
  })

  it('doesNotLetASubtreeDeclarationReachAFieldBesideTheGroup', () => {
    const declared: readonly PublicAccess[] = declaringFields('media', 'read', ['sizes.**'])
    expect(undeclaredGrants(Media, declared)).toContain('media.read.alt')
  })

  it('doesNotLetASubtreeDeclarationReachASiblingSharingItsPrefix', () => {
    const declared: readonly PublicAccess[] = declaringFields('media', 'read', ['alt', 'sizes.**'])
    expect(undeclaredGrants(Media, declared)).toEqual([
      'media.read.sizesLegacy',
      'media.read.sizesLegacy.url',
    ])
  })

  it('readsABareDoubleStarAsALiteralName', () => {
    const declared: readonly PublicAccess[] = declaringFields('media', 'read', ['**'])
    expect(undeclaredGrants(Media, declared)).toEqual(
      undeclaredGrants(Media, declaring('media', 'read')),
    )
  })

  it('readsADoubleStarMidPathAsALiteralName', () => {
    const declared: readonly PublicAccess[] = declaringFields('media', 'read', ['sizes.**.url'])
    expect(undeclaredGrants(Media, declared)).toContain('media.read.sizes.thumbnail.url')
  })

  it('readsADoubleStarOnAStarPrefixAsALiteralName', () => {
    const report: AccessReport = { collections: { pages: { read: OPEN, fields: true } } }
    const declared: readonly PublicAccess[] = declaringFields('pages', 'read', ['*.**'])
    expect(undeclaredGrants(report, declared)).toEqual(['pages.read.*'])
  })

  it('doesNotLetASingleStarBeneathAPrefixStandForNamedFields', () => {
    const declared: readonly PublicAccess[] = declaringFields('media', 'read', ['sizes.*'])
    expect(undeclaredGrants(Media, declared)).toContain('media.read.sizes.thumbnail')
  })

  it('holdsASubtreeDeclarationToItsOperation', () => {
    const declared: readonly PublicAccess[] = declaringFields('media', 'create', ['sizes.**'])
    expect(undeclaredGrants(Media, declared)).toContain('media.read.sizes.thumbnail.url')
  })
})

// The mirror of undeclaredGrants. A declaration nothing bears out is the access-boundary twin of an
// exclusion that excludes nothing: it records a decision with no effect, and it covers the field the
// day it is exposed again. The one form that may name more than the report shows is the subtree, and
// only while something beneath it is granted.
describe('staleDeclarations', () => {
  const Media: AccessReport = {
    collections: {
      media: {
        read: OPEN,
        fields: {
          alt: { read: OPEN },
          sizes: {
            read: OPEN,
            fields: { thumbnail: { read: OPEN, fields: { url: { read: OPEN } } } },
          },
        },
      },
    },
  }

  it('acceptsADeclarationTheApplicationBearsOut', () => {
    expect(staleDeclarations(Media, declaringFields('media', 'read', ['alt']))).toEqual([])
    expect(staleDeclarations(Media, declaring('media', 'read'))).toEqual([])
  })

  it('reportsAnEntryForAnOperationNobodyIsGranted', () => {
    expect(staleDeclarations(Media, declaring('media', 'update'))).toEqual([
      'publicAccess entry "media.update" covers no grant the application makes; the access rule was ' +
        'closed or the entity renamed, so remove the entry',
    ])
  })

  it('reportsAnEntryForAnEntityTheReportDoesNotName', () => {
    expect(staleDeclarations(Media, declaring('posts', 'read'))).toHaveLength(1)
  })

  it('reportsAFieldNoGrantMatches', () => {
    expect(staleDeclarations(Media, declaringFields('media', 'read', ['alt', 'prefix']))).toEqual([
      'publicAccess entry "media.read.prefix" covers no grant the application makes; the field was ' +
        'renamed, hidden or misspelt, so correct or remove it',
    ])
  })

  it('reportsAFieldGrantedUnderAnotherOperationOnly', () => {
    const report: AccessReport = {
      collections: { media: { read: OPEN, update: OPEN, fields: { alt: { read: OPEN } } } },
    }
    expect(staleDeclarations(report, declaringFields('media', 'update', ['alt']))).toHaveLength(1)
  })

  it('acceptsASubtreeWhileAnythingBeneathItIsGranted', () => {
    expect(staleDeclarations(Media, declaringFields('media', 'read', ['sizes.**']))).toEqual([])
  })

  it('reportsASubtreeUnderWhichNothingIsGranted', () => {
    expect(
      staleDeclarations(Media, declaringFields('media', 'read', ['sizesLegacy.**'])),
    ).toHaveLength(1)
  })

  it('reportsTheSpellingsThatAreLiteralsMatchingNothing', () => {
    const literals: readonly string[] = ['**', 'sizes.**.url', 'sizes.*']
    expect(staleDeclarations(Media, declaringFields('media', 'read', literals))).toHaveLength(
      literals.length,
    )
  })

  it('acceptsAStarAgainstAMapPayloadCollapsed', () => {
    const report: AccessReport = { collections: { media: { read: OPEN, fields: true } } }
    expect(staleDeclarations(report, declaringFields('media', 'read', ['*']))).toEqual([])
    expect(staleDeclarations(report, declaringFields('media', 'read', ['alt']))).toHaveLength(1)
  })

  it('reportsInDeclarationOrder', () => {
    const declared: readonly PublicAccess[] = [
      ...declaring('posts', 'read'),
      ...declaringFields('media', 'read', ['gone']),
    ]
    expect(
      staleDeclarations(Media, declared).map(
        (finding: string): string => finding.split('"', 2)[1] ?? '',
      ),
    ).toEqual(['posts.read', 'media.read.gone'])
  })
})
