// The access-control half of the Payload rules: who a collection or a global lets in, and what it
// leaves to the framework's defaults.
//
// These rules are separated from the Local API rules in `payload-policy.ts` because they share a
// question the others do not ask - "which object literal IS this config" - and because together the two
// halves passed the file size cap. Every one of them is a security decision that Payload will silently
// make on the project's behalf if the project does not make it first.

import {
  type FoundPayloadConfig,
  type PayloadConfigKind,
  payloadConfigsIn,
} from './payload-configs.js'
import {
  configBody,
  depthOneBlockKeys,
  depthOneValue,
  type PayloadViolation,
} from './payload-source.js'
import { NOT_FOUND, topLevelKeys } from './source-text.js'

const eachConfig = (
  source: string,
  judge: (kind: PayloadConfigKind, found: FoundPayloadConfig) => readonly PayloadViolation[],
): readonly PayloadViolation[] =>
  payloadConfigsIn(source).flatMap((found: FoundPayloadConfig): readonly PayloadViolation[] =>
    judge(found.kind, found),
  )

// Payload fills the missing operations in during sanitisation, so a partial access block is invisible
// the moment the app boots - and its default for a non-auth collection is public read. Checking that
// the word `access` appears somewhere in the file, which is what this rule used to do, accepted a block
// that declared one operation out of four.
export const findUndeclaredAccess = (source: string): readonly PayloadViolation[] =>
  eachConfig(
    source,
    (kind: PayloadConfigKind, found: FoundPayloadConfig): readonly PayloadViolation[] => {
      const declared: readonly string[] = depthOneBlockKeys(found.body, 'access')
      const missing: readonly string[] = kind.operations.filter(
        (operation: string): boolean => !declared.includes(operation),
      )
      return missing.length === 0
        ? []
        : [
            {
              line: found.line,
              rule: 'require-complete-access',
              reason:
                `a ${kind.label} must declare access for ${kind.operations.join(', ')}; ` +
                `${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} left to the Payload ` +
                'defaults, which allow public read',
            },
          ]
    },
  )

// Payload locks nothing by default: without a login-attempt cap and a lock time, an auth collection
// accepts guesses at whatever rate a client can make them. `auth: true` is the bare enable, so it is
// the case this rule most needs to catch.
const AUTH_HARDENING_KEYS: readonly string[] = ['maxLoginAttempts', 'lockTime']

const COLLECTION: string = 'CollectionConfig'

const leadingNumber = (value: string | undefined): number | undefined => {
  const match: RegExpExecArray | null = /^\s*(-?\d[\d_]*(?:\.\d[\d_]*)?)\s*(?=[,}])/.exec(
    value ?? '',
  )
  return match === null ? undefined : Number((match[1] ?? '').replaceAll('_', ''))
}

const unhardenedAuthIn = (found: FoundPayloadConfig): readonly PayloadViolation[] => {
  const value: string | undefined = depthOneValue(found.body, 'auth')
  if (value === undefined) {
    return []
  }
  const declared: readonly string[] = value.trimStart().startsWith('{')
    ? topLevelKeys(value, 0)
    : []
  const missing: readonly string[] = AUTH_HARDENING_KEYS.filter(
    (key: string): boolean => !declared.includes(key),
  )
  const disabled: readonly string[] = AUTH_HARDENING_KEYS.filter((key: string): boolean => {
    const numeric: number | undefined = leadingNumber(depthOneValue(value, key))
    return numeric !== undefined && numeric <= 0
  })
  return missing.length === 0 && disabled.length === 0
    ? []
    : [
        {
          line: found.line,
          rule: 'require-auth-hardening',
          reason:
            `an auth collection must declare ${AUTH_HARDENING_KEYS.join(' and ')}; ` +
            (missing.length === 0 ? '' : `${missing.join(' and ')} is missing; `) +
            (disabled.length === 0 ? '' : `${disabled.join(' and ')} is not positive; `) +
            'without a positive attempt cap and lock time, login guesses are not bounded',
        },
      ]
}

/** Report an auth collection that leaves the login-attempt cap and lock time to Payload's defaults. */
export const findUnhardenedAuth = (source: string): readonly PayloadViolation[] =>
  eachConfig(
    source,
    (kind: PayloadConfigKind, found: FoundPayloadConfig): readonly PayloadViolation[] =>
      kind.label === COLLECTION ? unhardenedAuthIn(found) : [],
  )

// A draft is unpublished content. With versions.drafts enabled, `?draft=true` serves it to whoever the
// read rule admits - so a read that is unconditionally true publishes every draft to anyone.
const DRAFTS_ENABLED: RegExp = /drafts\s*:\s*(?:true|\{)/

// The inline always-true read.
//
// The return type is optional in the pattern and effectively mandatory in a governed project, which is
// the whole reason it appears here. `explicit-function-return-type` makes a conforming project write
// `read: (): boolean => true`, and a pattern demanding `()` immediately before `=>` matched none of
// those - so this rule reported nothing on the only spelling the harness permits. `[^=]*` cannot run
// past the arrow it precedes, which keeps the optional part from swallowing the match.
const ALWAYS_TRUE_READ: RegExp = /read\s*:\s*\(\s*\)\s*(?::[^=]*)?=>\s*true/

// Where the access block's own braces close, so the search below cannot run past them into the fields.
const blockEnd = (access: string, open: number): number => {
  const body: string | undefined = configBody(access.slice(open), 0, false)
  return body === undefined ? access.length : open + body.length
}

// The read is looked for inside the access block alone. `depthOneValue` returns everything from the
// key's colon to the end of the enclosing literal, so testing it whole meant a FIELD-level
// `read: () => true` - which grants nothing beyond that one field - was reported as though the
// collection itself were open to anyone.
//
// Only the inline form is decidable here, and the lint pass forbids that form in a config file, so a
// conforming project writes `read: anyone` and this rule stays silent on it. What covers the conforming
// case is the managed access-boundary sweep, which asks the running application what it grants rather
// than reading the source. This rule reaches a config declared outside the linted directories.
const isDraftExposed = (body: string): boolean => {
  const versions: string | undefined = depthOneValue(body, 'versions')
  if (versions === undefined || !DRAFTS_ENABLED.test(versions)) {
    return false
  }
  const access: string | undefined = depthOneValue(body, 'access')
  if (access === undefined) {
    return false
  }
  const open: number = access.indexOf('{')
  return open !== NOT_FOUND && ALWAYS_TRUE_READ.test(access.slice(0, blockEnd(access, open)))
}

/** Report a config whose drafts are readable by an unauthenticated client. */
export const findAnonymousDraftReads = (source: string): readonly PayloadViolation[] =>
  eachConfig(
    source,
    (kind: PayloadConfigKind, found: FoundPayloadConfig): readonly PayloadViolation[] =>
      isDraftExposed(found.body)
        ? [
            {
              line: found.line,
              rule: 'no-anonymous-draft-reads',
              reason:
                `a ${kind.label} with drafts enabled must not grant an unconditionally true read; ` +
                'an unauthenticated client would fetch unpublished drafts through ?draft=true',
            },
          ]
        : [],
  )

// `mimeTypes` defaults to undefined, so an upload collection takes whatever a client sends until the
// project says otherwise. Served from the application's own origin, an uploaded SVG is script that runs
// as the site, which is why the restriction is required rather than advised. No size cap is asked for
// here: Payload takes that at the config root rather than on the collection.
const UPLOAD_RESTRICTION: string = 'mimeTypes'

const unrestrictedUploadIn = (found: FoundPayloadConfig): readonly PayloadViolation[] => {
  const value: string | undefined = depthOneValue(found.body, 'upload')
  if (value === undefined) {
    return []
  }
  const declared: readonly string[] = value.trimStart().startsWith('{')
    ? topLevelKeys(value, 0)
    : []
  return declared.includes(UPLOAD_RESTRICTION)
    ? []
    : [
        {
          line: found.line,
          rule: 'require-upload-restrictions',
          reason:
            `an upload collection must declare ${UPLOAD_RESTRICTION}; left undeclared it accepts ` +
            'any file, and an SVG served from this origin is script that runs as the site',
        },
      ]
}

/** Report an upload collection that accepts whatever file type Payload's defaults allow. */
export const findUnrestrictedUploads = (source: string): readonly PayloadViolation[] =>
  eachConfig(
    source,
    (kind: PayloadConfigKind, found: FoundPayloadConfig): readonly PayloadViolation[] =>
      kind.label === COLLECTION ? unrestrictedUploadIn(found) : [],
  )
