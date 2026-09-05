// What a Payload application's own access report says an unauthenticated caller may do, decided here
// rather than in the sweep that fetches it.
//
// The sweep is a managed end-to-end spec, so nothing in this repository compiles it against a running
// Payload and no unit test can reach it. That is exactly the wrong place for the one decision it makes,
// because the decision turns on a shape Payload does not document and does not send twice the same way.
//
// `sanitizePermissions` rewrites the response before it leaves the server: an operation whose grant
// carries no query constraint is collapsed from `{ permission: true }` to the bare boolean `true`, and
// the object shape survives only when a `where` clause survives beside it. So the UNCONSTRAINED grant -
// `read: anyone`, the half the sweep exists to catch - is the one that is not an object. Reading
// `.permission` alone reported the query-constrained grants and stayed silent on the open ones, which
// is the sweep inverted against its own purpose: `payload-access.ts` stands its static rule down for
// the conforming spelling `read: anyone` on the stated promise that this sweep covers it, so a
// drafts-enabled collection open to every stranger passed the static rule and the dynamic one alike.
//
// Payload answers with a second half beside the operations: a `fields` map giving the same verdict per
// field. This module read the operations alone for a while, and the half it discarded is the half that
// decides whether a credential column is serialised to a stranger and whether a stranger may set the
// column that says who owns a row. A collection open to `create` with every field writable lets an
// anonymous caller compose the whole document, ownership included - which is a forgery rather than a
// creation, and passed both halves of the old sweep because neither looked.
//
// One kind of field in that map holds nothing. A `type: 'ui'` field is a panel control - a banner, a
// button, a computed label - with no column behind it, and `populateFieldPermissions` gates only on
// `'name' in field && field.name`, so Payload reports it exactly as it reports a real column. A
// `UIField` also carries no `access` property, so the project can neither close the grant nor decline
// to declare it: the only way to answer the finding was to record under `publicAccess` that a stranger
// may read a field that stores nothing, which degrades the very record this sweep exists to keep
// readable. Those paths are therefore dropped, on the doctrine `grantsForEntity` already follows - a
// permission over nothing is not a finding a project could answer - and they are dropped from the
// declaration side too, so an entry naming one is reported as stale and can be removed for good rather
// than sitting there forever, neither required nor mentioned.
//
// Knowing which paths those are needs the BUILT configuration, because the response cannot tell them
// apart. The walk over it is the walk `fieldPathsFor` makes over the response, and has to stay so: a
// path composed differently on the two sides matches nothing and drops nothing.
import { isArray, readKey } from './json-shapes.js'
import {
  COLLECTION_OPERATIONS,
  READ_VERSIONS_OPERATION,
  UNLOCK_OPERATION,
} from './payload-defaults.js'
import type { PublicAccess } from './settings.js'

/**
 * One operation's verdict as Payload sends it: `true` for an unconstrained grant, `{ permission: true,
 * where }` for a constrained one, and absent for a denial, which Payload deletes from the response.
 */
export type ReportedPermission =
  | boolean
  | { readonly permission?: boolean; readonly where?: unknown }

/**
 * A `fields` map as Payload sends it, or the bare `true` its sanitisation collapses a fully permitted
 * one to - which says every field without naming one, and so cannot be enumerated.
 */
export type ReportedFields = boolean | Readonly<Record<string, ReportedEntity>>

/**
 * One entity's operations and, beside them, the per-field map Payload reports for it.
 *
 * A field is reported in exactly the shape an entity is - its own operations, and its own `fields` when
 * it is an array or a group - so one type describes both and the walk over them is the same walk.
 */
export interface ReportedEntity {
  readonly fields?: ReportedFields
  readonly [operation: string]: ReportedFields | ReportedPermission | undefined
}

/** The body of `/api/access`, read for the operations and the fields beneath them. */
export interface AccessReport {
  readonly canAccessAdmin?: boolean
  readonly collections?: Readonly<Record<string, ReportedEntity>>
  readonly globals?: Readonly<Record<string, ReportedEntity>>
}

/** One permission the running application actually grants, on an entity or on one field of it. */
export interface Granted {
  readonly entity: string
  readonly operation: string
  readonly field?: string
}

/**
 * A write is never a default a project should be able to reach by accident: Payload grants none of these
 * to an anonymous caller unless the project's own rule says so. `read` is judged too, but it is the one
 * a public site legitimately grants, which is what `publicAccess` exists to record.
 *
 * `readVersions` and `unlock` are judged for the reason `payload-defaults` demands they be decided at
 * all. A version is the whole document, so a read narrowed to an audience is undone by asking for a
 * version instead - and `readVersions: theSameHelperAsRead` reads as obviously right while handing a
 * stranger everything the helper's filter was written to keep back. `unlock` clears the lockout an
 * attempt cap just set. Payload reports both beside the four, and both were passing unlooked-at.
 *
 * Composed from the lists `payload-defaults.ts` already declares rather than restated here, so the two
 * halves of the harness cannot drift into disagreeing about what an operation is called.
 */
export const JUDGED_OPERATIONS: readonly string[] = [
  ...COLLECTION_OPERATIONS,
  READ_VERSIONS_OPERATION,
  UNLOCK_OPERATION,
]

/** The path standing in for a `fields` map Payload collapsed, which grants every field at once. */
const EVERY_FIELD: string = '*'

const PATH_SEPARATOR: string = '.'

/** Whether Payload reported this operation as permitted, in either of the two shapes it sends. */
export const isPermitted = (
  permission: ReportedFields | ReportedPermission | undefined,
): boolean => {
  if (permission === undefined || typeof permission === 'boolean') {
    return permission === true
  }
  // Both remaining shapes carry an index signature or an optional `permission`, so both are readable
  // through one accessor rather than through a guard that would have to tell them apart by a key a
  // field could legitimately be named.
  const constrained: { readonly permission?: unknown } = permission
  return constrained.permission === true
}

/**
 * Every field path one operation reaches, joined as Payload nests them.
 *
 * Recursive because an array or group field carries a `fields` map of its own, so a leaf is named by
 * the path that reaches it (`playerFleet.shipKind`) rather than by its own name alone, which would
 * collide between two arrays sharing a field name.
 */
const fieldPathsFor = (
  fields: ReportedFields | undefined,
  operation: string,
  prefix: string,
): readonly string[] => {
  if (fields === undefined) {
    return []
  }
  if (typeof fields === 'boolean') {
    return fields ? [`${prefix}${EVERY_FIELD}`] : []
  }
  return Object.entries(fields).flatMap(
    ([name, reported]: readonly [string, ReportedEntity]): readonly string[] => [
      ...(isPermitted(reported[operation]) ? [`${prefix}${name}`] : []),
      ...fieldPathsFor(reported.fields, operation, `${prefix}${name}${PATH_SEPARATOR}`),
    ],
  )
}

const grantsForOperation = (
  entity: string,
  permissions: ReportedEntity,
  operation: string,
): readonly Granted[] => [
  { entity, operation },
  ...fieldPathsFor(permissions.fields, operation, '').map(
    (field: string): Granted => ({ entity, operation, field }),
  ),
]

// The field map is walked only for an operation the ENTITY grants, and that is a correctness rule
// rather than a saving. Payload reports a field's verdict whether or not the operation carrying it is
// reachable: an auth collection that denies `read` to a stranger still lists fields carrying
// `read: true`, because the field rule genuinely says yes and the collection rule is what stops the
// caller. Judging those would name permissions nobody holds, and a project cannot close a finding that
// describes no exposure - so it would close it by declaring it, which teaches exactly the wrong habit.
const grantsForEntity = (entity: string, permissions: ReportedEntity): readonly Granted[] =>
  JUDGED_OPERATIONS.filter((operation: string): boolean =>
    isPermitted(permissions[operation]),
  ).flatMap((operation: string): readonly Granted[] =>
    grantsForOperation(entity, permissions, operation),
  )

const grantsIn = (entities: Readonly<Record<string, ReportedEntity>>): readonly Granted[] =>
  Object.entries(entities).flatMap(
    ([entity, permissions]: readonly [string, ReportedEntity]): readonly Granted[] =>
      grantsForEntity(entity, permissions),
  )

/** Every permission an access report grants, across collections and globals alike. */
export const grantedPermissions = (report: AccessReport): readonly Granted[] => [
  ...grantsIn(report.collections ?? {}),
  ...grantsIn(report.globals ?? {}),
]

/** How one grant is named, both in a report and in the `publicAccess` entry that would declare it. */
export const describeGrant = (granted: Granted): string =>
  granted.field === undefined
    ? `${granted.entity}.${granted.operation}`
    : `${granted.entity}.${granted.operation}${PATH_SEPARATOR}${granted.field}`

/** The field paths an entity reports but stores nothing behind, keyed by the entity's slug. */
export type DatalessFields = Readonly<Record<string, readonly string[]>>

/** The field type Payload renders in the panel and keeps no column for. */
const UI_FIELD_TYPE: string = 'ui'

// A tab set is a container whose children live one level down; each tab hoists or adds a segment of its
// own, which is why it is walked apart from an ordinary named field.
const TABS_FIELD_TYPE: string = 'tabs'

// Blocks are reported as a map of their own, keyed by block slug, and `fieldPathsFor` never descends
// into one. Descending here would compose paths the report never sends, which match nothing.
const BLOCKS_FIELD_TYPE: string = 'blocks'

/** A field's or tab's own name, or nothing when it is presentational and hoists its children. */
const nameOf = (subject: unknown): string | undefined => {
  const name: unknown = readKey(subject, 'name')
  return typeof name === 'string' && name.length > 0 ? name : undefined
}

// A named container adds its segment; an unnamed one - a row, a collapsible, an unnamed group or tab -
// stores nothing of its own, and Payload reports its children at the parent's level.
const prefixUnder = (prefix: string, name: string | undefined): string =>
  name === undefined ? prefix : `${prefix}${name}${PATH_SEPARATOR}`

/** A list of child fields, and the prefix the paths beneath it are composed under. */
interface ChildFields {
  readonly fields: unknown
  readonly prefix: string
}

// Stated as the lists to descend into rather than by recursing here, so the walk below recurses into
// itself alone. A tab set contributes one list per tab, each hoisting or adding its own segment; a UI
// field and a block set contribute none; everything else contributes its own `fields`, which is absent
// on a leaf and read as an empty list.
const childFieldsOf = (field: unknown, prefix: string): readonly ChildFields[] => {
  const type: unknown = readKey(field, 'type')
  if (type === UI_FIELD_TYPE || type === BLOCKS_FIELD_TYPE) {
    return []
  }
  if (type === TABS_FIELD_TYPE) {
    const tabs: unknown = readKey(field, 'tabs')
    return (isArray(tabs) ? tabs : []).map(
      (tab: unknown): ChildFields => ({
        fields: readKey(tab, 'fields'),
        prefix: prefixUnder(prefix, nameOf(tab)),
      }),
    )
  }
  return [{ fields: readKey(field, 'fields'), prefix: prefixUnder(prefix, nameOf(field)) }]
}

// An unnamed UI field is reported by nothing, so it names no path to drop.
const datalessPathOf = (field: unknown, prefix: string): readonly string[] => {
  const name: string | undefined = nameOf(field)
  return name !== undefined && readKey(field, 'type') === UI_FIELD_TYPE ? [`${prefix}${name}`] : []
}

const datalessInFields = (fields: unknown, prefix: string): readonly string[] =>
  (isArray(fields) ? fields : []).flatMap((field: unknown): readonly string[] => [
    ...datalessPathOf(field, prefix),
    ...childFieldsOf(field, prefix).flatMap((child: ChildFields): readonly string[] =>
      datalessInFields(child.fields, child.prefix),
    ),
  ])

const datalessInEntities = (entities: unknown): DatalessFields =>
  Object.fromEntries(
    (isArray(entities) ? entities : []).flatMap(
      (entity: unknown): readonly (readonly [string, readonly string[]])[] => {
        const slug: unknown = readKey(entity, 'slug')
        const paths: readonly string[] = datalessInFields(readKey(entity, 'fields'), '')
        return typeof slug !== 'string' || paths.length === 0 ? [] : [[slug, paths]]
      },
    ),
  )

/**
 * Every field path a built Payload configuration reports but keeps no data behind.
 *
 * Read through the untyped accessors rather than through Payload's types, because this package depends
 * on nothing: what arrives is the configuration Payload booted, and what is read of it is the same four
 * keys the response is built from.
 * @param config the built Payload configuration, as its module's default export.
 * @returns the dataless paths of each entity that has any, keyed by slug.
 */
export const datalessFieldsIn = (config: unknown): DatalessFields => ({
  ...datalessInEntities(readKey(config, 'collections')),
  ...datalessInEntities(readKey(config, 'globals')),
})

const isDataless = (granted: Granted, dataless: DatalessFields): boolean =>
  granted.field !== undefined && (dataless[granted.entity] ?? []).includes(granted.field)

/** Every permission the report grants over something the configuration actually stores. */
const dataBearingGrants = (report: AccessReport, dataless: DatalessFields): readonly Granted[] =>
  grantedPermissions(report).filter((granted: Granted): boolean => !isDataless(granted, dataless))

// A field is matched by name and never by a wildcard the project could write for itself. An entry
// listing `*` covers only the grant Payload itself collapsed to `*`, where every field is open and the
// declaration is therefore exact rather than blanket.
//
// The ONE pattern a project may write is a trailing `.**` on a non-empty, star-free prefix: `sizes.**`
// names the group and everything beneath it - `sizes`, `sizes.thumbnail.url`, and a `sizes.*` Payload
// collapsed. An upload collection with eight renditions reports fifty-seven paths under `sizes`, and a
// list that long is a list nobody rereads, which defeats the declaration it exists to be. The trade is
// stated rather than hidden: a field added under that group later is covered by the same declaration.
// Every other spelling - `**` alone, `**` mid-path, `*` under a prefix - is a literal name, and a
// literal Payload never reports covers nothing, which fails in the safe direction. A top-level field
// therefore still has to be named one by one.
const SUBTREE_DECLARATION: RegExp = /^([^*]+)\.\*\*$/

const coversPath = (declared: string, field: string): boolean => {
  const prefix: string | undefined = SUBTREE_DECLARATION.exec(declared)?.[1]
  return prefix === undefined
    ? declared === field
    : field === prefix || field.startsWith(`${prefix}${PATH_SEPARATOR}`)
}

const coversField = (entry: PublicAccess, field: string): boolean =>
  (entry.fields ?? []).some((declared: string): boolean => coversPath(declared, field))

const isDeclared = (granted: Granted, declared: readonly PublicAccess[]): boolean =>
  declared.some((entry: PublicAccess): boolean => {
    if (entry.entity !== granted.entity || entry.operation !== granted.operation) {
      return false
    }
    return granted.field === undefined ? true : coversField(entry, granted.field)
  })

/**
 * The grants the running application makes to a stranger that the project has not recorded. Empty is
 * the only passing answer: a project that declares nothing is judged most strictly, and a declaration
 * narrows nothing else.
 * @param report the body of `/api/access` for an anonymous caller.
 * @param declared the project's `publicAccess` entries.
 * @param dataless the field paths the configuration reports but stores nothing behind, from
 * `datalessFieldsIn`. Defaulted to none, which judges every reported path and so errs strictly.
 * @returns one finding per undeclared grant, in report order.
 */
export const undeclaredGrants = (
  report: AccessReport,
  declared: readonly PublicAccess[],
  dataless: DatalessFields = {},
): readonly string[] =>
  dataBearingGrants(report, dataless)
    .filter((granted: Granted): boolean => !isDeclared(granted, declared))
    .map((granted: Granted): string => describeGrant(granted))

const isGranted = (entry: PublicAccess, granted: readonly Granted[]): boolean =>
  granted.some(
    (grant: Granted): boolean =>
      grant.entity === entry.entity && grant.operation === entry.operation,
  )

const isCovering = (entry: PublicAccess, declared: string, granted: readonly Granted[]): boolean =>
  granted.some(
    (grant: Granted): boolean =>
      grant.entity === entry.entity &&
      grant.operation === entry.operation &&
      grant.field !== undefined &&
      coversPath(declared, grant.field),
  )

const describeDeclaration = (entry: PublicAccess, field?: string): string =>
  describeGrant({
    entity: entry.entity,
    operation: entry.operation,
    ...(field !== undefined && { field }),
  })

const NO_MATCHING_GRANT: string = 'covers no grant the application makes'

/**
 * Every `publicAccess` declaration the running application does not bear out: an entity and operation
 * it grants nobody, or a field path under a granted operation that no reported field matches.
 *
 * The mirror of `undeclaredGrants`, and the access-boundary twin of an exclusion that excludes nothing:
 * a declaration matching no grant records a decision with no effect, outlives the field it was written
 * for, and covers that field the day it is exposed again without anyone being asked. A `.**` subtree
 * counts as borne out while the group or anything beneath it is granted, which keeps the trade that
 * form makes; a subtree under which nothing is granted is a misspelling like any other.
 * @param report the body of `/api/access` for an anonymous caller.
 * @param declared the project's `publicAccess` entries.
 * @param dataless the field paths the configuration reports but stores nothing behind, from
 * `datalessFieldsIn`. A declaration naming one is therefore reported stale and can be removed.
 * @returns one finding per stale entry or field, in declaration order.
 */
export const staleDeclarations = (
  report: AccessReport,
  declared: readonly PublicAccess[],
  dataless: DatalessFields = {},
): readonly string[] => {
  const granted: readonly Granted[] = dataBearingGrants(report, dataless)
  return declared.flatMap((entry: PublicAccess): readonly string[] => {
    if (!isGranted(entry, granted)) {
      return [
        `publicAccess entry "${describeDeclaration(entry)}" ${NO_MATCHING_GRANT}; the access rule ` +
          'was closed or the entity renamed, so remove the entry',
      ]
    }
    return (entry.fields ?? [])
      .filter((field: string): boolean => !isCovering(entry, field, granted))
      .map(
        (field: string): string =>
          `publicAccess entry "${describeDeclaration(entry, field)}" ${NO_MATCHING_GRANT}; the field ` +
          'was renamed, hidden or misspelt, so correct or remove it',
      )
  })
}
