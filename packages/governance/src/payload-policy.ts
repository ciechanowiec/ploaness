// Payload-specific source policy: the rules that exist only because the project is a Payload CMS
// application, and therefore the part of ploaness that a generic JavaScript harness cannot supply.
//
// ploaness governs a language and a framework; this module is the framework half. The rules target
// Payload defects that a type checker and a generic linter both miss: a
// Local API read that pulls an unbounded relationship graph out of the database, and an access-control
// decision that is skipped or left unwritten.
//
// These rules were previously five GritQL files run as Biome plugins. Biome resolves a plugin path
// relative to the config that declares it, which does not survive being extended from node_modules, so
// they are reimplemented here instead. The move also makes them unit-testable, which they were not.
//
// Matching walks the source with a balanced-delimiter scan that skips string literals, rather than a
// naive regular expression, so a multi-line or nested call reads correctly. It is deliberately
// conservative: a rule fires only on a literal, statically decidable call shape, because a false
// positive in a build-failing gate costs far more than a dynamic call a reviewer would catch anyway.

/** A Payload usage defect found in project source. */
export interface PayloadViolation {
  readonly line: number
  readonly rule: string
  readonly reason: string
}

const OPENERS: ReadonlySet<string> = new Set(['(', '[', '{'])
const CLOSERS: ReadonlySet<string> = new Set([')', ']', '}'])
const QUOTES: ReadonlySet<string> = new Set(["'", '"', '`'])

const lineOf = (source: string, index: number): number => source.slice(0, index).split('\n').length

// A `/` begins a regular-expression literal only where a value may start. Tracking that lets the comment
// scanner skip a literal such as /https:\/\// without mistaking its escaped slashes for a comment.
const VALUE_POSITION: ReadonlySet<string> = new Set([
  '(',
  ',',
  '=',
  ':',
  '[',
  '!',
  '&',
  '|',
  '?',
  '{',
  '}',
  ';',
  '+',
  '-',
  '*',
  '%',
  '<',
  '>',
  '~',
  '^',
])

const lastMeaningful = (text: string): string => {
  for (let index: number = text.length - 1; index >= 0; index -= 1) {
    const character: string = text[index] ?? ''
    if (!/\s/.test(character)) {
      return character
    }
  }
  return ''
}

/**
 * Blank every comment and regular-expression literal to spaces, leaving newlines intact so reported line
 * numbers still point at real source positions. Without this, prose that merely names a banned construct
 * would be reported as the construct itself, which is the difference between a gate that is trusted and
 * one that is worked around.
 * @param source the file contents.
 * @returns the source with comments and regex literals replaced by spaces of equal length.
 */
export const stripComments = (source: string): string => {
  let output: string = ''
  let index: number = 0
  const blank = (text: string): string => text.replaceAll(/[^\n]/g, ' ')
  while (index < source.length) {
    const character: string = source[index] ?? ''
    const next: string = source[index + 1] ?? ''
    if (character === '/' && next === '/') {
      const end: number = source.indexOf('\n', index)
      const stop: number = end === -1 ? source.length : end
      output += blank(source.slice(index, stop))
      index = stop
      continue
    }
    if (character === '/' && next === '*') {
      const end: number = source.indexOf('*/', index + 2)
      const stop: number = end === -1 ? source.length : end + 2
      output += blank(source.slice(index, stop))
      index = stop
      continue
    }
    if (QUOTES.has(character)) {
      let cursor: number = index + 1
      while (cursor < source.length) {
        const inner: string = source[cursor] ?? ''
        if (inner === '\\') {
          cursor += 2
          continue
        }
        if (inner === character) {
          cursor += 1
          break
        }
        cursor += 1
      }
      output += source.slice(index, cursor)
      index = cursor
      continue
    }
    if (character === '/' && VALUE_POSITION.has(lastMeaningful(output))) {
      let cursor: number = index + 1
      let inClass: boolean = false
      while (cursor < source.length) {
        const inner: string = source[cursor] ?? ''
        if (inner === '\\') {
          cursor += 2
          continue
        }
        if (inner === '\n') {
          break
        }
        if (inner === '[') {
          inClass = true
        } else if (inner === ']') {
          inClass = false
        } else if (inner === '/' && !inClass) {
          cursor += 1
          break
        }
        cursor += 1
      }
      output += blank(source.slice(index, cursor))
      index = cursor
      continue
    }
    output += character
    index += 1
  }
  return output
}

/**
 * Read the text between the parenthesis at `open` and its match, tracking nesting and skipping string
 * literals so a bracket or quote inside a string cannot unbalance the scan.
 * @param source the file contents.
 * @param open the index of the opening parenthesis.
 * @returns the argument text, or undefined when the call is unterminated (a parse error another gate reports).
 */
export const balancedArguments = (source: string, open: number): string | undefined => {
  let depth: number = 0
  let quote: string | undefined
  for (let index: number = open; index < source.length; index += 1) {
    const character: string = source[index] ?? ''
    if (quote !== undefined) {
      if (character === '\\') {
        index += 1
      } else if (character === quote) {
        quote = undefined
      }
      continue
    }
    if (QUOTES.has(character)) {
      quote = character
      continue
    }
    if (OPENERS.has(character)) {
      depth += 1
      continue
    }
    if (CLOSERS.has(character)) {
      depth -= 1
      if (depth === 0) {
        return source.slice(open + 1, index)
      }
    }
  }
  return undefined
}

/**
 * Reduce an argument list to the characters sitting directly inside its outermost object literal, so a
 * key nested in a `where` clause is not mistaken for a bound declared on the call itself.
 * @param argumentText the text between a call's parentheses.
 * @returns the depth-one characters, with nested structures elided.
 */
export const topLevelSlice = (argumentText: string): string => {
  let depth: number = 0
  let quote: string | undefined
  let collected: string = ''
  for (let index: number = 0; index < argumentText.length; index += 1) {
    const character: string = argumentText[index] ?? ''
    if (quote !== undefined) {
      if (character === '\\') {
        index += 1
      } else if (character === quote) {
        quote = undefined
      }
      continue
    }
    if (QUOTES.has(character)) {
      quote = character
      continue
    }
    if (OPENERS.has(character)) {
      depth += 1
      if (depth === 1) {
        collected += ' '
      }
      continue
    }
    if (CLOSERS.has(character)) {
      depth -= 1
      continue
    }
    if (depth === 1) {
      collected += character
    }
  }
  return collected
}

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
// `array.find(...)` is never touched.
const PAYLOAD_RECEIVER: RegExp = /(?:^|[^\w$.])(?:payload|req\.payload|this\.payload)$/

const declaresKey = (topLevel: string, key: string): boolean =>
  new RegExp(String.raw`(^|[\s,])${key}\s*:`).test(topLevel)

const findUnboundedCalls = (source: string): readonly PayloadViolation[] => {
  const violations: PayloadViolation[] = []
  for (const rule of BOUNDED_CALLS) {
    let searchFrom: number = 0
    for (;;) {
      const found: number = source.indexOf(rule.call, searchFrom)
      if (found === -1) {
        break
      }
      searchFrom = found + rule.call.length
      if (!PAYLOAD_RECEIVER.test(source.slice(0, found))) {
        continue
      }
      const argumentText: string | undefined = balancedArguments(
        source,
        found + rule.call.length - 1,
      )
      // An unterminated call, an options variable rather than a literal, or an object spread all make the
      // bound impossible to decide statically. Staying silent there keeps the gate free of false
      // positives; the reviewer still sees the call.
      if (
        argumentText === undefined ||
        !argumentText.includes('{') ||
        argumentText.includes('...')
      ) {
        continue
      }
      const topLevel: string = topLevelSlice(argumentText)
      if (!rule.required.some((key: string): boolean => declaresKey(topLevel, key))) {
        violations.push({ line: lineOf(source, found), rule: rule.rule, reason: rule.reason })
      }
    }
  }
  return violations
}

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

const RELATIVE_IMPORT: RegExp = /(?:^|\n)\s*(?:import|export)[^\n;]*?from\s+['"](\.\.\/[^'"]*)['"]/g
// Test helpers live outside the `@/` alias root, and the Payload admin import map is generated.
const RELATIVE_IMPORT_EXEMPT: RegExp = /\.\.\/(?:helpers|importMap)/

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

// A collection that declares no `access` inherits Payload's defaults, which for a non-auth collection
// means public read. That is a security decision, so ploaness requires it to be written down rather than
// arrived at by omission.
const COLLECTION_CONFIG: RegExp = /:\s*CollectionConfig\s*(?!\[)(?=[=,)\s]|$)/
const DECLARES_ACCESS: RegExp = /(^|[\s,{])access\s*:/

const findUndeclaredAccess = (source: string): readonly PayloadViolation[] => {
  const marker: number = source.search(COLLECTION_CONFIG)
  if (marker === -1 || DECLARES_ACCESS.test(source)) {
    return []
  }
  return [
    {
      line: lineOf(source, marker),
      rule: 'require-collection-access',
      reason:
        'a CollectionConfig must declare access explicitly; omitting it inherits Payload defaults, which allow public read',
    },
  ]
}

/**
 * Return every Payload usage defect in one source file: an unbounded Local API read, a bypassed access
 * check, a parent-relative import, or a collection that leaves access control to Payload's defaults.
 * @param source the file contents.
 * @returns one violation per defect, grouped by rule.
 */
export const findPayloadViolations = (source: string): readonly PayloadViolation[] => {
  // Every rule reads the code, never the prose around it. A comment that names a banned construct in
  // order to explain why the code avoids it must not be reported as that construct.
  const code: string = stripComments(source)
  return [
    ...findUnboundedCalls(code),
    ...findOverrideAccess(code),
    ...findDeepRelativeImports(code),
    ...findUndeclaredAccess(code),
  ]
}
