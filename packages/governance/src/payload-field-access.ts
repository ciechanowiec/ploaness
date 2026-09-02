// Field-level access decisions that protect an account's authority.
//
// A collection access rule and a field access rule defend different boundaries. The collection rule
// decides who may update an account at all; the field rule decides whether that caller may change the
// part which grants authority. Requiring both prevents a later widening of collection access from
// silently turning an ordinary profile update into privilege escalation.

import type { FoundFieldLiteral, FoundPayloadConfig } from './payload-configs.js'
import { directFieldsIn, payloadConfigsIn } from './payload-configs.js'
import { depthOneBlockKeys, depthOneValue, type PayloadViolation } from './payload-source.js'

const PRIVILEGED_FIELD_NAMES: ReadonlySet<string> = new Set([
  'role',
  'roles',
  'isAdmin',
  'isStaff',
  'permission',
  'permissions',
  'capability',
  'capabilities',
])

const REQUIRED_OPERATIONS: readonly string[] = ['create', 'update']

const quotedValue = (value: string | undefined): string | undefined =>
  /^\s*['"`]([^'"`]+)['"`]/.exec(value ?? '')?.[1]

const isAuthCollection = (config: FoundPayloadConfig): boolean => {
  if (config.kind.kind !== 'collection') {
    return false
  }
  const auth: string | undefined = depthOneValue(config.body, 'auth')
  return /^\s*(?:true\b|\{)/.test(auth ?? '')
}

const violationFor = (field: FoundFieldLiteral): PayloadViolation | undefined => {
  const name: string | undefined = quotedValue(depthOneValue(field.body, 'name'))
  if (name === undefined || !PRIVILEGED_FIELD_NAMES.has(name)) {
    return undefined
  }
  const declared: readonly string[] = depthOneBlockKeys(field.body, 'access')
  const missing: readonly string[] = REQUIRED_OPERATIONS.filter(
    (operation: string): boolean => !declared.includes(operation),
  )
  return missing.length === 0
    ? undefined
    : {
        line: field.line,
        rule: 'require-privileged-field-access',
        reason:
          `the privilege-bearing field "${name}" must declare field access for create and update; ` +
          `${missing.join(' and ')} is not protected from assignment by a caller who can write ` +
          'the auth collection',
      }
}

/** Report privilege-bearing auth fields without explicit create and update access. */
export const findUnprotectedPrivilegedFields = (source: string): readonly PayloadViolation[] =>
  payloadConfigsIn(source)
    .filter((config: FoundPayloadConfig): boolean => isAuthCollection(config))
    .flatMap((config: FoundPayloadConfig): readonly FoundFieldLiteral[] =>
      directFieldsIn(source, config),
    )
    .map((field: FoundFieldLiteral): PayloadViolation | undefined => violationFor(field))
    .filter(
      (violation: PayloadViolation | undefined): violation is PayloadViolation =>
        violation !== undefined,
    )
