// The access-control half of the Payload rules: who a collection or a global lets in, and what it
// leaves to the framework's defaults.
//
// These three rules are separated from the Local API rules in `payload-policy.ts` because they share a
// question the others do not ask - "which object literal IS this config" - and because together the two
// halves passed the file size cap. Every one of them is a security decision that Payload will silently
// make on the project's behalf if the project does not make it first.
import {
  configBody,
  depthOneBlockKeys,
  depthOneValue,
  type PayloadViolation,
} from './payload-source.js'
import { lineOf, NOT_FOUND, topLevelKeys } from './source-text.js'

// The three ways a Payload config is declared, all of them idiomatic:
//
//   const Users: CollectionConfig = { ... }          the annotation
//   const Users: CollectionConfig<'users'> = { ... } the annotation, with the slug as a type argument
//   const Users = { ... } satisfies CollectionConfig the inferred form
//
// Only the first was matched for a long time, because the lookahead that stopped `CollectionConfigs`
// from matching also excluded `<`, and nothing looked for `satisfies` at all. A collection written
// either of the other two ways passed every rule below without one of them ever reading it - which is
// the worst failure a gate can have, because it is indistinguishable from a pass.
const declarationPattern = (typeName: string): RegExp =>
  new RegExp(String.raw`(:|satisfies)\s*${typeName}(?=[<=,)\s]|$)`, 'g')

/** The operations a collection must decide for itself rather than inherit. */
const COLLECTION_OPERATIONS: readonly string[] = ['create', 'read', 'update', 'delete']

/** A global has no create or delete: it exists from the moment it is configured. */
const GLOBAL_OPERATIONS: readonly string[] = ['read', 'update']

/** One kind of Payload config, and what a complete access block on it looks like. */
interface ConfigKind {
  readonly label: string
  readonly declaration: RegExp
  readonly operations: readonly string[]
}

const CONFIG_KINDS: readonly ConfigKind[] = [
  {
    label: 'CollectionConfig',
    declaration: declarationPattern('CollectionConfig'),
    operations: COLLECTION_OPERATIONS,
  },
  {
    label: 'GlobalConfig',
    declaration: declarationPattern('GlobalConfig'),
    operations: GLOBAL_OPERATIONS,
  },
]

/** One config found in a file: where it was declared, and the body that belongs to it. */
interface FoundConfig {
  readonly marker: number
  readonly body: string
}

const SATISFIES: string = 'satisfies'

// EVERY config in the file, not the first. `search` returned one offset, so a module exporting two
// collections - or a collection beside a global - had its second config judged by nothing at all. The
// Local API rules already iterated their matches; these three did not, and the asymmetry was invisible
// because a file with one config, which is most of them, behaves identically either way.
const findConfigs = (source: string, kind: ConfigKind): readonly FoundConfig[] =>
  [...source.matchAll(kind.declaration)].flatMap(
    (match: RegExpExecArray): readonly FoundConfig[] => {
      const body: string | undefined = configBody(source, match.index, match[1] === SATISFIES)
      return body === undefined ? [] : [{ marker: match.index, body }]
    },
  )

const eachConfig = (
  source: string,
  judge: (kind: ConfigKind, found: FoundConfig) => readonly PayloadViolation[],
): readonly PayloadViolation[] =>
  CONFIG_KINDS.flatMap((kind: ConfigKind): readonly PayloadViolation[] =>
    findConfigs(source, kind).flatMap((found: FoundConfig): readonly PayloadViolation[] =>
      judge(kind, found),
    ),
  )

// Payload fills the missing operations in during sanitisation, so a partial access block is invisible
// the moment the app boots - and its default for a non-auth collection is public read. Checking that
// the word `access` appears somewhere in the file, which is what this rule used to do, accepted a block
// that declared one operation out of four.
export const findUndeclaredAccess = (source: string): readonly PayloadViolation[] =>
  eachConfig(source, (kind: ConfigKind, found: FoundConfig): readonly PayloadViolation[] => {
    const declared: readonly string[] = depthOneBlockKeys(found.body, 'access')
    const missing: readonly string[] = kind.operations.filter(
      (operation: string): boolean => !declared.includes(operation),
    )
    return missing.length === 0
      ? []
      : [
          {
            line: lineOf(source, found.marker),
            rule: 'require-complete-access',
            reason:
              `a ${kind.label} must declare access for ${kind.operations.join(', ')}; ` +
              `${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} left to the Payload ` +
              'defaults, which allow public read',
          },
        ]
  })

// Payload locks nothing by default: without a login-attempt cap and a lock time, an auth collection
// accepts guesses at whatever rate a client can make them. `auth: true` is the bare enable, so it is
// the case this rule most needs to catch.
const AUTH_HARDENING_KEYS: readonly string[] = ['maxLoginAttempts', 'lockTime']

const COLLECTION: string = 'CollectionConfig'

const unhardenedAuthIn = (source: string, found: FoundConfig): readonly PayloadViolation[] => {
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
  return missing.length === 0
    ? []
    : [
        {
          line: lineOf(source, found.marker),
          rule: 'require-auth-hardening',
          reason:
            `an auth collection must declare ${AUTH_HARDENING_KEYS.join(' and ')}; ` +
            `${missing.join(' and ')} left to the Payload defaults means a login attempt is never ` +
            'capped and an account is never locked',
        },
      ]
}

/** Report an auth collection that leaves the login-attempt cap and lock time to Payload's defaults. */
export const findUnhardenedAuth = (source: string): readonly PayloadViolation[] =>
  eachConfig(source, (kind: ConfigKind, found: FoundConfig): readonly PayloadViolation[] =>
    kind.label === COLLECTION ? unhardenedAuthIn(source, found) : [],
  )

// A draft is unpublished content. With versions.drafts enabled, `?draft=true` serves it to whoever the
// read rule admits - so a read that is unconditionally true publishes every draft to anyone.
// The return type is optional in the pattern and effectively mandatory in a governed project, which is
// the whole reason it appears here. `explicit-function-return-type` makes a conforming project write
// `read: (): boolean => true`, and a pattern demanding `()` immediately before `=>` matched none of
// those - so this rule reported nothing on the only spelling the harness permits. `[^=]*` cannot run
// past the arrow it precedes, which keeps the optional part from swallowing the match.
const ALWAYS_TRUE_READ: RegExp = /read\s*:\s*\(\s*\)\s*(?:\s*:[^=]*)?=>\s*true/
const DRAFTS_ENABLED: RegExp = /drafts\s*:\s*(?:true|\{)/

// Where the access block's own braces close, so the search below cannot run past them into the fields.
const blockEnd = (access: string, open: number): number => {
  const body: string | undefined = configBody(access.slice(open), 0, false)
  return body === undefined ? access.length : open + body.length
}

// The read rule is looked for inside the access block alone. `depthOneValue` returns everything from
// the key's colon to the end of the enclosing literal, so testing it whole meant a FIELD-level
// `read: () => true` - which grants nothing beyond that one field - was reported as though the
// collection itself were open to anyone.
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
  eachConfig(source, (kind: ConfigKind, found: FoundConfig): readonly PayloadViolation[] =>
    isDraftExposed(found.body)
      ? [
          {
            line: lineOf(source, found.marker),
            rule: 'no-anonymous-draft-reads',
            reason:
              `a ${kind.label} with drafts enabled must not grant an unconditionally true read; ` +
              'an unauthenticated client would fetch unpublished drafts through ?draft=true',
          },
        ]
      : [],
  )
