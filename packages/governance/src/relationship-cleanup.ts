// A required relationship makes the collection it points at undeletable, unless that collection takes
// its dependants down first.
//
// Payload's Postgres adapter emits two settings for one field, and they contradict each other. For a
// single-value, non-polymorphic `relationship` or `upload` it puts a column on the table with
// `ON DELETE SET NULL`, and it adds `NOT NULL` to that same column when the field is `required` - unless
// the field carries an `admin.condition`, or the collection enables drafts, both of which switch the
// null constraint off. So deleting the row being pointed AT asks the database to null a column that may
// never be null, and the whole transaction aborts.
//
// Nothing reports it until something deletes. The configuration is valid, the build passes, and every
// test passes; then an unrelated spec deletes a user and fails with a constraint on a table it never
// mentioned. That is what this rule exists to move: from a runtime error naming the wrong collection to
// a source finding naming the right one.
//
// The repair is a `beforeDelete` hook on the collection being pointed at. It has to be BEFORE rather
// than after, because the row must go while its target still exists.
//
// This is the one Payload rule that cannot be decided from a single file: `relationTo: 'users'` names a
// collection some other module declares. It therefore reads every candidate at once, the way
// `admin-view-coverage.ts` does, rather than joining the single-source finders in `payload-policy.ts`.
import type { SpecSource } from './axe-coverage.js'
import {
  configBody,
  depthOneBlockKeys,
  depthOneValue,
  type PayloadViolation,
} from './payload-source.js'
import { enclosingLiteral, lineOf, occurrences, stripComments } from './source-text.js'

/** A violation together with the file it was found in, because this rule reads more than one. */
export interface LocatedViolation {
  readonly path: string
  readonly violation: PayloadViolation
}

// Only the annotation and `satisfies` forms a collection is actually written in, matching
// `payload-access.ts`. A global has no relationship column of its own to constrain.
const COLLECTION_DECLARATION: RegExp = /(:|satisfies)\s*CollectionConfig(?=[<=,)\s]|$)/g
const SATISFIES: string = 'satisfies'

// The two field types that put a foreign key on the table rather than in the join table. `upload` is
// one of them: it is a relationship to the media collection wearing a different name.
const KEYED_FIELD_TYPES: readonly string[] = ['relationship', 'upload']

// Biome normalises a project to single quotes; nothing obliges a project to have run it yet.
const QUOTE_STYLES: readonly string[] = ["'", '"']

const TRUE_VALUE: RegExp = /^\s*true\b/
const QUOTED_VALUE: RegExp = /^\s*['"`]([^'"`]+)['"`]/
const DRAFTS_ENABLED: RegExp = /drafts\s*:\s*(?:true|\{)/
const CLEANUP_HOOK: string = 'beforeDelete'

/** One collection as this rule needs it: what it is called, what it declares, and where it was found. */
interface FoundCollection {
  readonly path: string
  readonly slug: string
  readonly body: string
  readonly line: number
}

const declaresTrue = (field: string, key: string): boolean =>
  TRUE_VALUE.test(depthOneValue(field, key) ?? '')

// The slug a `relationTo` names, and only when it names exactly one. An array is the polymorphic form,
// which Payload stores in the join table instead and which therefore carries no column to constrain.
const singleTarget = (field: string): string | undefined =>
  QUOTED_VALUE.exec(depthOneValue(field, 'relationTo') ?? '')?.[1]

const slugOf = (body: string): string | undefined =>
  QUOTED_VALUE.exec(depthOneValue(body, 'slug') ?? '')?.[1]

// A collection with drafts enabled gets no null constraint anywhere, so none of its required fields can
// reach the contradiction.
const declaresDrafts = (body: string): boolean =>
  DRAFTS_ENABLED.test(depthOneValue(body, 'versions') ?? '')

// Comments are blanked before anything is read, the way every other Payload rule reads a file. The keys
// this rule looks for sit at depth one, and a depth-one key is recognised by the delimiter in front of
// it - so a comment between the previous entry and `hooks:` hid the hook, and the rule reported a
// collection that was guarded. `stripComments` preserves offsets and newlines, so the reported line is
// still the line of the source.
const collectionsIn = (file: SpecSource): readonly FoundCollection[] => {
  const source: string = stripComments(file.source)
  return [...source.matchAll(COLLECTION_DECLARATION)].flatMap(
    (match: RegExpExecArray): readonly FoundCollection[] => {
      const body: string | undefined = configBody(source, match.index, match[1] === SATISFIES)
      const slug: string | undefined = body === undefined ? undefined : slugOf(body)
      return body === undefined || slug === undefined
        ? []
        : [{ path: file.path, slug, body, line: lineOf(source, match.index) }]
    },
  )
}

// Every field of one collection that puts a NOT NULL column against another collection's primary key.
// The field literal is recovered from the offset of its own `type` key, so a relationship nested inside
// an array or a group is read exactly like one declared at the top: both get a column, on their own
// table, with the same pair of settings.
const constrainedTargets = (collection: FoundCollection): readonly string[] => {
  if (declaresDrafts(collection.body)) {
    return []
  }
  return KEYED_FIELD_TYPES.flatMap((fieldType: string): readonly string[] =>
    QUOTE_STYLES.flatMap((quote: string): readonly number[] =>
      occurrences(collection.body, `${quote}${fieldType}${quote}`),
    )
      .map((at: number): string | undefined => {
        const field: string | undefined = enclosingLiteral(collection.body, at)
        return field === undefined || !isConstrained(field, fieldType)
          ? undefined
          : singleTarget(field)
      })
      .filter((slug: string | undefined): slug is string => slug !== undefined),
  )
}

// The four conditions the adapter itself applies, read back off the field. `hasMany` moves the
// relationship into the join table; `admin.condition` and an array `relationTo` each drop the null
// constraint; and without `required` there is nothing to contradict.
const isConstrained = (field: string, fieldType: string): boolean =>
  QUOTED_VALUE.exec(depthOneValue(field, 'type') ?? '')?.[1] === fieldType &&
  declaresTrue(field, 'required') &&
  !declaresTrue(field, 'hasMany') &&
  !depthOneBlockKeys(field, 'admin').includes('condition') &&
  singleTarget(field) !== undefined

const declaresCleanup = (target: FoundCollection): boolean =>
  depthOneBlockKeys(target.body, 'hooks').includes(CLEANUP_HOOK)

const reason = (target: string): string =>
  `a required relationship to \`${target}\` gives this table a NOT NULL column against a foreign key ` +
  `Payload declares ON DELETE SET NULL, so deleting a ${target} row aborts on this table's ` +
  `constraint; declare a ${CLEANUP_HOOK} hook on ${target} that removes its dependants first`

/**
 * Every required single-value relationship whose target collection cannot be deleted because of it.
 *
 * Reads the whole candidate set at once, because the collection a `relationTo` names is declared in
 * another file. A target this set does not declare - a collection a plugin contributes, say - is left
 * alone rather than reported, since nothing here can see whether it takes its dependants down.
 * @param files every source file the gate collected, as a path and its text.
 * @returns one violation per unguarded relationship, located in the file that declares it.
 */
export const findUnguardedRelationships = (
  files: readonly SpecSource[],
): readonly LocatedViolation[] => {
  const collections: readonly FoundCollection[] = files.flatMap(
    (file: SpecSource): readonly FoundCollection[] => collectionsIn(file),
  )
  const bySlug: ReadonlyMap<string, FoundCollection> = new Map(
    collections.map((collection: FoundCollection): [string, FoundCollection] => [
      collection.slug,
      collection,
    ]),
  )
  return collections.flatMap((collection: FoundCollection): readonly LocatedViolation[] =>
    constrainedTargets(collection)
      .map((slug: string): FoundCollection | undefined => bySlug.get(slug))
      .filter(
        (target: FoundCollection | undefined): target is FoundCollection => target !== undefined,
      )
      .filter((target: FoundCollection): boolean => !declaresCleanup(target))
      .map(
        (target: FoundCollection): LocatedViolation => ({
          path: collection.path,
          violation: {
            line: collection.line,
            rule: 'require-relationship-cleanup',
            reason: reason(target.slug),
          },
        }),
      ),
  )
}
