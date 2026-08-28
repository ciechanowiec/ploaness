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
import type { PublicAccess } from './settings.js'

/**
 * One operation's verdict as Payload sends it: `true` for an unconstrained grant, `{ permission: true,
 * where }` for a constrained one, and absent for a denial, which Payload deletes from the response.
 */
export type ReportedPermission =
  | boolean
  | { readonly permission?: boolean; readonly where?: unknown }

/** One entity's operations, keyed as Payload keys them. */
export type ReportedEntity = Readonly<Record<string, ReportedPermission>>

/** The body of `/api/access`, read for the operations alone. */
export interface AccessReport {
  readonly canAccessAdmin?: boolean
  readonly collections?: Readonly<Record<string, ReportedEntity>>
  readonly globals?: Readonly<Record<string, ReportedEntity>>
}

/** One permission the running application actually grants. */
export interface Granted {
  readonly entity: string
  readonly operation: string
}

/**
 * A write is never a default a project should be able to reach by accident: Payload grants none of these
 * to an anonymous caller unless the project's own rule says so. `read` is judged too, but it is the one
 * a public site legitimately grants, which is what `publicAccess` exists to record.
 */
export const JUDGED_OPERATIONS: readonly string[] = ['create', 'read', 'update', 'delete']

/** Whether Payload reported this operation as permitted, in either of the two shapes it sends. */
export const isPermitted = (permission: ReportedPermission | undefined): boolean =>
  typeof permission === 'boolean' ? permission : permission?.permission === true

const grantsIn = (entities: Readonly<Record<string, ReportedEntity>>): readonly Granted[] =>
  Object.entries(entities).flatMap(
    ([entity, permissions]: readonly [string, ReportedEntity]): readonly Granted[] =>
      JUDGED_OPERATIONS.filter((operation: string): boolean =>
        isPermitted(permissions[operation]),
      ).map((operation: string): Granted => ({ entity, operation })),
  )

/** Every permission an access report grants, across collections and globals alike. */
export const grantedPermissions = (report: AccessReport): readonly Granted[] => [
  ...grantsIn(report.collections ?? {}),
  ...grantsIn(report.globals ?? {}),
]

/** How one grant is named, both in a report and in the `publicAccess` entry that would declare it. */
export const describeGrant = (granted: Granted): string => `${granted.entity}.${granted.operation}`

const isDeclared = (granted: Granted, declared: readonly PublicAccess[]): boolean =>
  declared.some(
    (entry: PublicAccess): boolean =>
      entry.entity === granted.entity && entry.operation === granted.operation,
  )

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
