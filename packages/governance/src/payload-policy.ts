// Payload source policy for explicit read bounds, request threading, and access decisions.
import {
  findAnonymousDraftReads,
  findUndecidedSvgHeaders,
  findUndeclaredAccess,
  findUndeclaredVersionReads,
  findUnhardenedAuth,
  findUnlockableAuth,
  findUnrestrictedUploads,
} from './payload-access.js'
import { findUnreviewedSchemaPush } from './payload-database.js'
import { findUnprotectedPrivilegedFields } from './payload-field-access.js'
import type { PayloadViolation } from './payload-source.js'
import { findAbsentSecretAcceptances, findFailOpenSecretGuards } from './source-security.js'
import {
  balancedArguments,
  lineOf,
  occurrences,
  stripComments,
  topLevelSlice,
} from './source-text.js'

interface BoundedCallRule {
  readonly call: string
  readonly required: readonly string[]
  readonly rule: string
  readonly reason: string
}

// The Local API reads that must declare their bound. `find` returns a page, so either `depth` or `limit`
// bounds it; the single-document and global reads return one document, so only `depth` applies.
const BOUNDED_CALLS: readonly BoundedCallRule[] = [
  {
    call: '.find(',
    required: ['depth', 'limit'],
    rule: 'no-unbounded-find',
    reason:
      'bound payload.find() with an explicit depth and/or limit, or it pulls an unbounded relationship graph',
  },
  {
    call: '.findByID(',
    required: ['depth'],
    rule: 'no-unbounded-findbyid',
    reason: 'bound payload.findByID() with an explicit depth to cap relationship population',
  },
  {
    call: '.findGlobal(',
    required: ['depth'],
    rule: 'no-unbounded-findglobal',
    reason: 'bound payload.findGlobal() with an explicit depth to cap relationship population',
  },
]

// Recognized Payload receivers exclude unrelated collection methods such as array.find().
const PAYLOAD_RECEIVER: RegExp = /(?:^|[^\w$.])(?:payload|(?:[\w$]+\.)*req\.payload|this\.payload)$/

// A property boundary keeps a value such as request: req from being read as a req property.
const declaresProperty = (topLevel: string, key: string): boolean =>
  new RegExp(String.raw`(?:^|,)\s*${key}\s*(?::|,|$)`).test(topLevel)

// The depth-one text of a call's options literal, or undefined when the call is not one to judge.
const topLevelOptionsAt = (
  source: string,
  call: string,
  found: number,
  receiver: RegExp,
): string | undefined => {
  if (!receiver.test(source.slice(0, found))) {
    return undefined
  }
  const argumentText: string | undefined = balancedArguments(source, found + call.length - 1)
  return argumentText?.trim().startsWith('{') === true ? topLevelSlice(argumentText) : undefined
}

// A protected property must follow every spread that could replace it.
const hasEffectiveProperty = (topLevel: string, key: string): boolean => {
  const properties: readonly RegExpExecArray[] = [
    ...topLevel.matchAll(new RegExp(String.raw`(?:^|,)\s*${key}\s*(?::|(?=,|$))`, 'gu')),
  ]
  const last: RegExpExecArray | undefined = properties.at(-1)
  return last !== undefined && last.index > topLevel.lastIndexOf('...')
}

const unboundedCallAt = (
  source: string,
  rule: BoundedCallRule,
  found: number,
): PayloadViolation | undefined => {
  const topLevel: string | undefined = topLevelOptionsAt(source, rule.call, found, PAYLOAD_RECEIVER)
  if (
    topLevel === undefined ||
    rule.required.some((key: string): boolean => hasEffectiveProperty(topLevel, key))
  ) {
    return undefined
  }
  return { line: lineOf(source, found), rule: rule.rule, reason: rule.reason }
}

const findUnboundedCalls = (source: string): readonly PayloadViolation[] =>
  BOUNDED_CALLS.flatMap((rule: BoundedCallRule): readonly PayloadViolation[] =>
    occurrences(source, rule.call)
      .map((found: number): PayloadViolation | undefined => unboundedCallAt(source, rule, found))
      .filter(
        (violation: PayloadViolation | undefined): violation is PayloadViolation =>
          violation !== undefined,
      ),
  )

// The collection, global, and version operations whose options carry both the caller and the request.
// One catalogue feeds both rules below: adding a Payload operation to one contract and not the other
// would leave a call either outside its transaction or running as an administrator with a decorative
// user value.
const LOCAL_API_CALLS: readonly string[] = [
  '.count(',
  '.create(',
  '.delete(',
  '.find(',
  '.findByID(',
  '.findDistinct(',
  '.findGlobal(',
  '.findGlobalVersionByID(',
  '.findGlobalVersions(',
  '.findVersionByID(',
  '.findVersions(',
  '.restoreGlobalVersion(',
  '.restoreVersion(',
  '.update(',
  '.updateGlobal(',
]

// Only the request-scoped instance is judged, which is the whole reason the rule can be trusted. A bare
// `payload` from `getPayload()` - a script, a seed, a Server Component that opened its own instance -
// has no request to thread, and demanding one would be asking for a value that does not exist. Reaching
// the instance THROUGH `req` is the proof that one does, so the omission is never a decision.
const REQUEST_RECEIVER: RegExp = /(?:^|[^\w$.])(?:[\w$]+\.)*req\.payload$/

const findOpaqueOptions = (source: string): readonly PayloadViolation[] =>
  LOCAL_API_CALLS.flatMap((call: string): readonly PayloadViolation[] =>
    occurrences(source, call).flatMap((found: number): readonly PayloadViolation[] =>
      PAYLOAD_RECEIVER.test(source.slice(0, found)) &&
      topLevelOptionsAt(source, call, found, PAYLOAD_RECEIVER) === undefined
        ? [
            {
              line: lineOf(source, found),
              rule: 'require-explicit-payload-options',
              reason:
                `cannot check ${call.slice(1, -1)}() options; use an object literal and state ` +
                'the required depth/limit, req, and access settings after any spread',
            },
          ]
        : [],
    ),
  )

const unthreadedCallAt = (
  source: string,
  call: string,
  found: number,
): PayloadViolation | undefined => {
  const topLevel: string | undefined = topLevelOptionsAt(source, call, found, REQUEST_RECEIVER)
  if (topLevel === undefined || hasEffectiveProperty(topLevel, 'req')) {
    return undefined
  }
  return {
    line: lineOf(source, found),
    rule: 'no-unthreaded-req',
    reason:
      `pass req to ${call.slice(1, -1)}() so it joins the caller's transaction; reached through ` +
      'req.payload without it, the operation opens its own - it cannot see the in-flight write, and ' +
      'it is not rolled back with it',
  }
}

// The defect this catches is invisible in a passing test suite and in a code review. A hook that reads
// or writes through `req.payload` without `req` looks identical to one that threads it, runs correctly
// whenever no transaction is open, and corrupts a document only when one is - which is precisely when a
// hook runs. Payload's own documentation calls threading it critical, and no type checker can require it
// because the parameter is optional for the callers that genuinely have no request.
const findUnthreadedRequests = (source: string): readonly PayloadViolation[] =>
  LOCAL_API_CALLS.flatMap((call: string): readonly PayloadViolation[] =>
    occurrences(source, call)
      .map((found: number): PayloadViolation | undefined => unthreadedCallAt(source, call, found))
      .filter(
        (violation: PayloadViolation | undefined): violation is PayloadViolation =>
          violation !== undefined,
      ),
  )

interface OverrideProperty {
  readonly index: number
  readonly value: string
}

const OVERRIDE_PROPERTY: RegExp = /(?:^|,)\s*overrideAccess\s*:\s*([^,]*)/g

const overrideProperties = (topLevel: string): readonly OverrideProperty[] =>
  [...topLevel.matchAll(OVERRIDE_PROPERTY)].map(
    (match: RegExpExecArray): OverrideProperty => ({
      index: match.index,
      value: (match[1] ?? '').trim(),
    }),
  )

// A later spread can replace an earlier false. A false written after the last spread is the only form
// whose effective value this text reader can prove without resolving another object.
const hasEffectiveAccessControl = (topLevel: string): boolean => {
  const last: OverrideProperty | undefined = overrideProperties(topLevel).at(-1)
  return last?.value === 'false' && last.index > topLevel.lastIndexOf('...')
}

const userAccessViolationAt = (
  source: string,
  call: string,
  found: number,
): PayloadViolation | undefined => {
  const topLevel: string | undefined = topLevelOptionsAt(source, call, found, PAYLOAD_RECEIVER)
  if (
    topLevel === undefined ||
    !(declaresProperty(topLevel, 'user') || topLevel.includes('...')) ||
    hasEffectiveAccessControl(topLevel) ||
    overrideProperties(topLevel).some(
      (property: OverrideProperty): boolean => property.value === 'true',
    )
  ) {
    return undefined
  }
  return {
    line: lineOf(source, found),
    rule: 'require-user-access-control',
    reason:
      `set overrideAccess: false on ${call.slice(1, -1)}() after any spread; ` +
      'a supplied or inherited user otherwise does not enable access control. Payload ' +
      'runs the operation as an administrator and ignores that user for access control',
  }
}

const findIgnoredUsers = (source: string): readonly PayloadViolation[] =>
  LOCAL_API_CALLS.flatMap((call: string): readonly PayloadViolation[] =>
    occurrences(source, call)
      .map((found: number): PayloadViolation | undefined =>
        userAccessViolationAt(source, call, found),
      )
      .filter(
        (violation: PayloadViolation | undefined): violation is PayloadViolation =>
          violation !== undefined,
      ),
  )

const OVERRIDE_ACCESS: RegExp = /overrideAccess\s*:\s*true/g

const findOverrideAccess = (source: string): readonly PayloadViolation[] =>
  [...source.matchAll(OVERRIDE_ACCESS)].map(
    (match: RegExpExecArray): PayloadViolation => ({
      line: lineOf(source, match.index),
      rule: 'no-override-access',
      reason:
        'overrideAccess: true bypasses Payload access control; set overrideAccess: false so the ' +
        'access rules run against the calling user',
    }),
  )

// The one layer whose caller is a stranger. Everywhere else a Local API call runs in a context the
// project already trusts - a hook inside the write that authored it, a scheduled job, a seed - and
// privilege there is legitimate rather than a mistake. A route handler serves whoever reached the URL,
// so what it is allowed to read is the one thing it must never inherit by saying nothing.
const ENDPOINT_PATH: RegExp = /^src\/(?:endpoints\/|app\/(?:.*\/)?route\.[jt]s$)/u

// A route must prove access enforcement rather than inherit Payload's privileged default.
const endpointAccessViolationAt = (
  source: string,
  call: string,
  found: number,
): PayloadViolation | undefined => {
  if (!PAYLOAD_RECEIVER.test(source.slice(0, found))) {
    return undefined
  }
  const topLevel: string | undefined = topLevelOptionsAt(source, call, found, PAYLOAD_RECEIVER)
  if (topLevel !== undefined && hasEffectiveAccessControl(topLevel)) {
    return undefined
  }
  return {
    line: lineOf(source, found),
    rule: 'require-endpoint-access',
    reason:
      `state overrideAccess: false on ${call.slice(1, -1)}() in a route handler; Payload defaults it to ` +
      'true, so an omission runs as an administrator and serves the document to whoever called the ' +
      'route - set overrideAccess: false',
  }
}

// Anchored on the keyword that immediately precedes the specifier rather than on the statement that
// opens it. Requiring the whole statement to fit on one line missed a multi-line brace list, which is
// how a long import is normally written, and requiring `from` missed both a side-effect import and the
// dynamic `import('../x')` form. Comments are already blanked, so a `from` reached here is code.
const RELATIVE_IMPORT: RegExp = /\b(?:from|import)\s*(?:\(\s*)?['"](\.\.\/[^'"]*)['"]/g
// Test helpers live outside the `@/` alias root, and the Payload admin import map is generated. The
// exemption is anchored at a path boundary so `../helpersOfMine` is not excused by `../helpers`.
//
// The ascent repeats, because its LENGTH was never part of that reason. Anchored at exactly one `../`,
// the exemption reached a spec sitting directly under `tests/` and no deeper - so a suite whose
// directories mirror `src/`, which is the ordinary layout, could not import the helpers the exemption
// exists to admit. What still discriminates is the segment the climb LANDS on: `../../../helpers/x` is
// a helper root reached from depth, while `../../../src/helpers/x` climbed into source and is reported.
const RELATIVE_IMPORT_EXEMPT: RegExp = /^(?:\.\.\/)+(?:helpers|importMap)(?:\/|$)/

const findDeepRelativeImports = (source: string): readonly PayloadViolation[] =>
  [...source.matchAll(RELATIVE_IMPORT)].flatMap(
    (match: RegExpExecArray): readonly PayloadViolation[] => {
      const specifier: string = match[1] ?? ''
      return RELATIVE_IMPORT_EXEMPT.test(specifier)
        ? []
        : [
            {
              line: lineOf(source, match.index),
              rule: 'no-deep-relative-imports',
              reason: `use the "@/" path alias instead of the parent-relative import "${specifier}"`,
            },
          ]
    },
  )

/**
 * The rules that are about the language rather than about Payload.
 *
 * Reaching for a parent-relative import instead of the path alias is a defect in any package. Held
 * inside the Payload rule set it ran only where Payload did, so a frontend beside the CMS - the place a
 * deep relative import is most likely, since it has no Payload to anchor on - was never checked.
 * @param source the file's text.
 * @returns one violation per offending line.
 */
export const findSourceViolations = (source: string): readonly PayloadViolation[] => [
  ...findDeepRelativeImports(stripComments(source)),
  ...findFailOpenSecretGuards(source),
  ...findAbsentSecretAcceptances(source),
]

/**
 * The rules that are about Payload itself, which only a Payload package can break.
 * @param source the file's text.
 * @returns one violation per offending line.
 */
export const findPayloadViolations = (source: string): readonly PayloadViolation[] => {
  // Every rule reads the code, never the prose around it. A comment that names a banned construct in
  // order to explain why the code avoids it must not be reported as that construct.
  const code: string = stripComments(source)
  return [
    ...findOpaqueOptions(code),
    ...findUnboundedCalls(code),
    ...findUnthreadedRequests(code),
    ...findIgnoredUsers(code),
    ...findOverrideAccess(code),
    ...findUndeclaredAccess(code),
    ...findUnhardenedAuth(code),
    ...findUnlockableAuth(code),
    ...findAnonymousDraftReads(code),
    ...findUndeclaredVersionReads(code),
    ...findUnrestrictedUploads(code),
    ...findUndecidedSvgHeaders(code),
    ...findUnprotectedPrivilegedFields(code),
    ...findUnreviewedSchemaPush(code),
  ]
}

/**
 * The access decision a route handler has to state rather than inherit.
 *
 * The two rules that already read `overrideAccess` judge a value that is written down: one bans `true`,
 * the other requires `false` beside a `user`. Neither can see an absent property, and absent is the
 * dangerous spelling - Payload defaults `overrideAccess` to `true`, so the call that says nothing is
 * the call that runs as an administrator. Under `src/endpoints` the omission is therefore the
 * violation, which is why this rule reads the path and the others do not.
 * @param filePath the repository-relative path of the file, which decides whether the rule applies.
 * @param source the file's text.
 * @returns one violation per Local API call that leaves the decision to the default.
 */
export const findEndpointViolations = (
  filePath: string,
  source: string,
): readonly PayloadViolation[] => {
  if (!ENDPOINT_PATH.test(filePath)) {
    return []
  }
  // Runs outside `findPayloadViolations`, so it strips its own comments: prose that names a call must
  // not be read as one.
  const code: string = stripComments(source)
  return LOCAL_API_CALLS.flatMap((call: string): readonly PayloadViolation[] =>
    occurrences(code, call)
      .map((found: number): PayloadViolation | undefined =>
        endpointAccessViolationAt(code, call, found),
      )
      .filter(
        (violation: PayloadViolation | undefined): violation is PayloadViolation =>
          violation !== undefined,
      ),
  )
}
