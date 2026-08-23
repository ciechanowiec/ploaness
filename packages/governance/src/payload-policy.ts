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

// Each scanner below answers one question: where does the construct that starts at `index` end? Keeping
// them apart is what lets stripComments read as the dispatch it is rather than as four interleaved
// state machines sharing one cursor.

const blank = (text: string): string => text.replaceAll(/[^\n]/g, ' ')

const endOfLineComment = (source: string, index: number): number => {
  const end: number = source.indexOf('\n', index)
  return end === -1 ? source.length : end
}

const endOfBlockComment = (source: string, index: number): number => {
  const end: number = source.indexOf('*/', index + 2)
  return end === -1 ? source.length : end + 2
}

const endOfStringLiteral = (source: string, index: number): number => {
  const quote: string = source[index] ?? ''
  let cursor: number = index + 1
  while (cursor < source.length) {
    const inner: string = source[cursor] ?? ''
    if (inner === '\\') {
      cursor += 2
      continue
    }
    cursor += 1
    if (inner === quote) {
      break
    }
  }
  return cursor
}

// A regex literal ends at the first unescaped slash outside a character class, and never spans a line.
// A regex literal's end depends on escapes, newlines, and character-class nesting at once. Splitting
// the three apart would hide the single cursor they share behind three functions that each need the
// others' state.
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one cursor, three interacting rules
const endOfRegexLiteral = (source: string, index: number): number => {
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
  return cursor
}

/** One comment, string, or regex literal: where it ends, and whether it is erased rather than kept. */
interface Skipped {
  readonly stop: number
  readonly erased: boolean
}

// A string literal is kept because its contents are the only place a banned construct can legitimately
// appear as data. Everything else here is erased, so prose naming a construct is never read as one.
// Four guard clauses, one per construct. The count is the number of constructs, and collapsing them
// into a table would trade a readable list for a lookup that says less.
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one guard per construct
const constructAt = (source: string, index: number, output: string): Skipped | undefined => {
  const character: string = source[index] ?? ''
  const next: string = source[index + 1] ?? ''
  if (character === '/' && next === '/') {
    return { stop: endOfLineComment(source, index), erased: true }
  }
  if (character === '/' && next === '*') {
    return { stop: endOfBlockComment(source, index), erased: true }
  }
  if (QUOTES.has(character)) {
    return { stop: endOfStringLiteral(source, index), erased: false }
  }
  if (character === '/' && VALUE_POSITION.has(lastMeaningful(output))) {
    return { stop: endOfRegexLiteral(source, index), erased: true }
  }
  return undefined
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
  while (index < source.length) {
    const skipped: Skipped | undefined = constructAt(source, index, output)
    if (skipped === undefined) {
      output += source[index] ?? ''
      index += 1
      continue
    }
    const text: string = source.slice(index, skipped.stop)
    output += skipped.erased ? blank(text) : text
    index = skipped.stop
  }
  return output
}

/** One character of a delimiter-aware scan, with the bracket depth that holds once it is applied. */
interface ScanStep {
  readonly character: string
  readonly index: number
  readonly depth: number
}

/**
 * Walk `source` from `start`, tracking string literals and bracket nesting so that a bracket or a quote
 * inside a string cannot unbalance the scan. Both readers below need exactly this bookkeeping and differ
 * only in what they do with each character, so it lives here once rather than in each of them.
 * @param source the text to walk.
 * @param start the index to begin at.
 * @param visit called for every character outside a string literal; return false to stop the walk.
 */
// One cursor carrying depth across a character walk. Every split of this loop has to pass that cursor
// back and forth, which is harder to review than the loop, and this is the code the unbounded-call
// rules are decided by.
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one cursor shared by the whole walk
const scanDelimited = (source: string, start: number, visit: (step: ScanStep) => boolean): void => {
  let depth: number = 0
  let index: number = start
  while (index < source.length) {
    const character: string = source[index] ?? ''
    // A string literal is jumped over whole rather than tracked character by character, so a bracket or
    // a quote inside it can never reach the depth count.
    if (QUOTES.has(character)) {
      index = endOfStringLiteral(source, index)
      continue
    }
    index += 1
    if (OPENERS.has(character)) {
      depth += 1
    } else if (CLOSERS.has(character)) {
      depth -= 1
    }
    if (!visit({ character, index: index - 1, depth })) {
      return
    }
  }
}

/**
 * Read the text between the parenthesis at `open` and its match.
 * @param source the file contents.
 * @param open the index of the opening parenthesis.
 * @returns the argument text, or undefined when the call is unterminated (a parse error another gate reports).
 */
export const balancedArguments = (source: string, open: number): string | undefined => {
  let close: number | undefined
  scanDelimited(source, open, (step: ScanStep): boolean => {
    if (CLOSERS.has(step.character) && step.depth === 0) {
      close = step.index
      return false
    }
    return true
  })
  return close === undefined ? undefined : source.slice(open + 1, close)
}

/**
 * Reduce an argument list to the characters sitting directly inside its outermost object literal, so a
 * key nested in a `where` clause is not mistaken for a bound declared on the call itself.
 * @param argumentText the text between a call's parentheses.
 * @returns the depth-one characters, with nested structures elided.
 */
export const topLevelSlice = (argumentText: string): string => {
  let collected: string = ''
  scanDelimited(argumentText, 0, (step: ScanStep): boolean => {
    if (OPENERS.has(step.character)) {
      // A nested structure collapses to one space, so the keys inside it cannot be read as top level.
      collected += step.depth === 1 ? ' ' : ''
    } else if (!CLOSERS.has(step.character) && step.depth === 1) {
      collected += step.character
    }
    return true
  })
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

const occurrences = (source: string, needle: string): readonly number[] => {
  const found: number[] = []
  let searchFrom: number = 0
  for (;;) {
    const at: number = source.indexOf(needle, searchFrom)
    if (at === -1) {
      return found
    }
    found.push(at)
    searchFrom = at + needle.length
  }
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
