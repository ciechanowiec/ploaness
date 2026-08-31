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
 */
export const JUDGED_OPERATIONS: readonly string[] = ['create', 'read', 'update', 'delete']

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

// A field is matched by name and never by a wildcard the project could write for itself. An entry
// listing `*` covers only the grant Payload itself collapsed to `*`, where every field is open and the
// declaration is therefore exact rather than blanket. Nothing here lets one declaration stand for a
// field added later, which is the whole reason the field half is judged at all.
const coversField = (entry: PublicAccess, field: string): boolean =>
  (entry.fields ?? []).includes(field)

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
 */
export const undeclaredGrants = (
  report: AccessReport,
  declared: readonly PublicAccess[],
): readonly string[] =>
  grantedPermissions(report)
    .filter((granted: Granted): boolean => !isDeclared(granted, declared))
    .map((granted: Granted): string => describeGrant(granted))
