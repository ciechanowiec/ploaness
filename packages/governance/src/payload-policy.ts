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
  new RegExp(String.raw`(^|[\s,])${key}\s*:`).test(topLevel)

// An unterminated call, an options variable rather than a literal, or an object spread all make the
// bound impossible to decide statically. Staying silent there keeps the gate free of false positives;
// the reviewer still sees the call.
const unboundedCallAt = (
  source: string,
  rule: BoundedCallRule,
  found: number,
): PayloadViolation | undefined => {
  if (!PAYLOAD_RECEIVER.test(source.slice(0, found))) {
    return undefined
  }
  const argumentText: string | undefined = balancedArguments(source, found + rule.call.length - 1)
  if (argumentText === undefined || !argumentText.includes('{') || argumentText.includes('...')) {
    return undefined
  }
  const topLevel: string = topLevelSlice(argumentText)
  if (rule.required.some((key: string): boolean => declaresKey(topLevel, key))) {
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
    ...findOverrideAccess(code),
    ...findUndeclaredAccess(code),
    ...findUnhardenedAuth(code),
    ...findAnonymousDraftReads(code),
    ...findUnrestrictedUploads(code),
  ]
}
