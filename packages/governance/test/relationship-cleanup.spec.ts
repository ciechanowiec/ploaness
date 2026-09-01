// The rule that moves a database constraint failure back to the configuration that caused it.
//
// Every case here is written as source text, the way `payload-access.spec.ts` writes its configs, and
// every exemption is asserted as well as the finding. That balance is the point: each exemption is a
// way the rule could fire on a configuration that is correct, and a rule that cried wolf on
// `hasMany: true` would be worse than no rule, because a project would learn to ignore it.
import { describe, expect, it } from 'vitest'
import type { SpecSource } from '../src/admin-view-coverage.js'
import { findUnguardedRelationships, type LocatedViolation } from '../src/relationship-cleanup.js'

const GUARDED_TARGET: SpecSource = {
  path: 'src/collections/Users.ts',
  source: `export const Users: CollectionConfig = {
  slug: 'users',
  hooks: { beforeDelete: [removeRanking] },
  fields: [{ name: 'email', type: 'text' }],
}`,
}

const UNGUARDED_TARGET: SpecSource = {
  path: 'src/collections/Users.ts',
  source: `export const Users: CollectionConfig = {
  slug: 'users',
  fields: [{ name: 'email', type: 'text' }],
}`,
}

// A collection pointing at `users`, with the field declared however the case under test needs.
const holder = (field: string, extra = ''): SpecSource => ({
  path: 'src/collections/Leaderboard.ts',
  source: `export const Leaderboard: CollectionConfig = {
  slug: 'leaderboard',${extra}
  fields: [${field}],
}`,
})

const REQUIRED_RELATIONSHIP: string =
  "{ name: 'player', type: 'relationship', relationTo: 'users', required: true }"

const rulesOf = (...files: readonly SpecSource[]): readonly string[] =>
  findUnguardedRelationships(files).map(
    (located: LocatedViolation): string => located.violation.rule,
  )

describe('require-relationship-cleanup', () => {
  it('reports a required relationship whose target takes nothing down with it', () => {
    expect(rulesOf(holder(REQUIRED_RELATIONSHIP), UNGUARDED_TARGET)).toEqual([
      'require-relationship-cleanup',
    ])
  })

  it('accepts the same relationship once the target declares a beforeDelete hook', () => {
    expect(rulesOf(holder(REQUIRED_RELATIONSHIP), GUARDED_TARGET)).toEqual([])
  })

  // A depth-one key is recognised by the delimiter in front of it, so a comment sitting between the
  // previous entry and `hooks:` hid the hook and the rule reported a collection that was guarded. The
  // integration fixture found this; every unit case here had been written without comments.
  it('sees a hook a comment sits in front of', () => {
    const commented: SpecSource = {
      path: 'src/collections/Users.ts',
      source: `export const Users: CollectionConfig = {
  slug: 'users',
  // Posts point at this collection, so its dependants go first.
  hooks: { beforeDelete: [removeRanking] },
  fields: [{ name: 'email', type: 'text' }],
}`,
    }
    expect(rulesOf(holder(REQUIRED_RELATIONSHIP), commented)).toEqual([])
  })

  it('reports against the file declaring the relationship, not the file that must change', () => {
    const found: readonly LocatedViolation[] = findUnguardedRelationships([
      holder(REQUIRED_RELATIONSHIP),
      UNGUARDED_TARGET,
    ])
    expect(found[0]?.path).toBe('src/collections/Leaderboard.ts')
    expect(found[0]?.violation.reason).toContain('users')
  })

  it('names the mechanism, because the error a project meets names another table', () => {
    const found: readonly LocatedViolation[] = findUnguardedRelationships([
      holder(REQUIRED_RELATIONSHIP),
      UNGUARDED_TARGET,
    ])
    expect(found[0]?.violation.reason).toContain('ON DELETE SET NULL')
  })
})

describe('require-relationship-cleanup leaves alone what the adapter never constrains', () => {
  // Each of these is a shape Payload stores differently, and each is therefore a way the rule could
  // fire on a configuration that is correct. A rule that cried wolf on any of them would teach a
  // project to ignore it.
  it.each([
    {
      shape: 'is not required',
      field: "{ name: 'player', type: 'relationship', relationTo: 'users' }",
    },
    {
      shape: 'is hasMany, so it lives in the join table',
      field:
        "{ name: 'players', type: 'relationship', relationTo: 'users', hasMany: true, required: true }",
    },
    {
      shape: 'names several collections, which is stored the same way',
      field:
        "{ name: 'owner', type: 'relationship', relationTo: ['users', 'teams'], required: true }",
    },
    {
      shape: 'carries an admin condition, which drops the null constraint',
      field:
        "{ name: 'player', type: 'relationship', relationTo: 'users', required: true, admin: { condition: isRanked } }",
    },
  ])('accepts a relationship that $shape', ({ field }: { readonly field: string }) => {
    expect(rulesOf(holder(field), UNGUARDED_TARGET)).toEqual([])
  })

  // Drafts disable the null constraint across the whole collection.
  it('accepts a required relationship on a collection with drafts enabled', () => {
    expect(
      rulesOf(holder(REQUIRED_RELATIONSHIP, '\n  versions: { drafts: true },'), UNGUARDED_TARGET),
    ).toEqual([])
  })

  // A collection this file set does not declare - one a plugin contributes - cannot be judged.
  it('says nothing about a target it cannot see', () => {
    expect(rulesOf(holder(REQUIRED_RELATIONSHIP))).toEqual([])
  })
})

describe('require-relationship-cleanup reads the shapes a project actually writes', () => {
  it('reads an upload field, which is a relationship wearing another name', () => {
    const field: string = "{ name: 'hero', type: 'upload', relationTo: 'media', required: true }"
    const media: SpecSource = {
      path: 'src/collections/Media.ts',
      source:
        "export const Media: CollectionConfig = { slug: 'media', upload: { mimeTypes: ['image/*'] } }",
    }
    expect(rulesOf(holder(field), media)).toEqual(['require-relationship-cleanup'])
  })

  it('reads a relationship nested inside an array field, which gets a column of its own', () => {
    const field: string = `{ name: 'entries', type: 'array', fields: [${REQUIRED_RELATIONSHIP}] }`
    expect(rulesOf(holder(field), UNGUARDED_TARGET)).toEqual(['require-relationship-cleanup'])
  })

  it('reads a collection declared with satisfies rather than an annotation', () => {
    const holderSatisfies: SpecSource = {
      path: 'src/collections/Leaderboard.ts',
      source: `export const Leaderboard = {
  slug: 'leaderboard',
  fields: [${REQUIRED_RELATIONSHIP}],
} satisfies CollectionConfig`,
    }
    expect(rulesOf(holderSatisfies, UNGUARDED_TARGET)).toEqual(['require-relationship-cleanup'])
  })

  it('judges every collection in a file that declares more than one', () => {
    const both: SpecSource = {
      path: 'src/collections/Both.ts',
      source: `export const One: CollectionConfig = {
  slug: 'one',
  fields: [${REQUIRED_RELATIONSHIP}],
}
export const Two: CollectionConfig = {
  slug: 'two',
  fields: [${REQUIRED_RELATIONSHIP}],
}`,
    }
    expect(rulesOf(both, UNGUARDED_TARGET)).toHaveLength(2)
  })
})
