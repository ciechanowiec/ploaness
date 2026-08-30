// Payload-specific source policy: the rules that exist only because the project is a Payload CMS
// application, and therefore the part of ploaness that a generic JavaScript harness cannot supply.
//
// ploaness governs a language and a framework; this module is the framework half. The rules here target
// Payload defects that a type checker and a generic linter both miss: a Local API read that pulls an
// unbounded relationship graph out of the database, and an access check that is deliberately bypassed.
// The access-control rules - the ones about a decision left UNWRITTEN rather than written wrongly - are
// in `payload-access.ts`, and the source reader both halves are decided by is in `payload-source.ts`.
//
// These rules were previously five GritQL files run as Biome plugins. Biome resolves a plugin path
// relative to the config that declares it, which does not survive being extended from node_modules, so
// they are reimplemented here instead. The move also makes them unit-testable, which they were not.
import {
  findAnonymousDraftReads,
  findUndeclaredAccess,
  findUnhardenedAuth,
  findUnrestrictedUploads,
} from './payload-access.js'
import type { PayloadViolation } from './payload-source.js'
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

// Only a call on an identifier that is recognisably the Payload instance is judged, so an unrelated
// `array.find(...)` is never touched. `req` may itself be reached through a chain - `ctx.req.payload`
// inside a hook is as much the Payload instance as `req.payload` - and excluding a preceding dot meant
// every such call went unjudged. The chain is admitted only in front of `req`, so a property named
// `payload` on some unrelated object is still left alone.
const PAYLOAD_RECEIVER: RegExp = /(?:^|[^\w$.])(?:payload|(?:[\w$]+\.)*req\.payload|this\.payload)$/

const declaresKey = (topLevel: string, key: string): boolean =>
  new RegExp(String.raw`(?:^|,)\s*${key}\s*:`).test(topLevel)

// A shorthand property has no colon, so `declaresKey` cannot see it. The property boundary must be the
// start of the literal or a comma: admitting arbitrary whitespace made the `req` VALUE in
// `request: req` look like a `req` PROPERTY and vouched for a transaction the call never received.
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
  return argumentText?.includes('{') === true ? topLevelSlice(argumentText) : undefined
}

// A top-level spread makes an absent key unknowable, so the rules that ask only whether a key exists
// stay silent. A spread nested inside `data` is elided by `topLevelSlice` and changes none of the
// options these rules judge.
//
// Shared by the two rules that read an options object. They ask different questions - is the read
// bounded, is the request threaded - of the same three facts, and a second copy of the three guards is a
// second place for the receiver pattern to fall out of step with this one.
const optionKeysAt = (
  source: string,
  call: string,
  found: number,
  receiver: RegExp,
): string | undefined => {
  const topLevel: string | undefined = topLevelOptionsAt(source, call, found, receiver)
  return topLevel === undefined || topLevel.includes('...') ? undefined : topLevel
}

const unboundedCallAt = (
  source: string,
  rule: BoundedCallRule,
  found: number,
): PayloadViolation | undefined => {
  const topLevel: string | undefined = optionKeysAt(source, rule.call, found, PAYLOAD_RECEIVER)
  if (
    topLevel === undefined ||
    rule.required.some((key: string): boolean => declaresKey(topLevel, key))
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

const unthreadedCallAt = (
  source: string,
  call: string,
  found: number,
): PayloadViolation | undefined => {
  const topLevel: string | undefined = optionKeysAt(source, call, found, REQUEST_RECEIVER)
  if (topLevel === undefined || declaresProperty(topLevel, 'req')) {
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
    !declaresProperty(topLevel, 'user') ||
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
      `set overrideAccess: false on ${call.slice(1, -1)}() when passing user; Payload otherwise ` +
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
        'overrideAccess: true bypasses Payload access control; pass req so the access rules run, or drop the override',
    }),
  )

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
export const findSourceViolations = (source: string): readonly PayloadViolation[] =>
  findDeepRelativeImports(stripComments(source))

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
    ...findUnboundedCalls(code),
    ...findUnthreadedRequests(code),
    ...findIgnoredUsers(code),
    ...findOverrideAccess(code),
    ...findUndeclaredAccess(code),
    ...findUnhardenedAuth(code),
    ...findAnonymousDraftReads(code),
    ...findUnrestrictedUploads(code),
  ]
}
