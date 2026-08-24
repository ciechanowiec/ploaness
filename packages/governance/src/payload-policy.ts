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

const lastMeaningful = (text: string): string => text.trimEnd().at(LAST_CHARACTER) ?? ''

// Each scanner below answers one question: where does the construct that starts at `index` end? Keeping
// them apart is what lets stripComments read as the dispatch it is rather than as four interleaved
// state machines sharing one cursor.

const blank = (text: string): string => text.replaceAll(/[^\n]/g, ' ')

const endOfLineComment = (source: string, index: number): number => {
  const end: number = source.indexOf('\n', index)
  return end === -1 ? source.length : end
}

const endOfBlockComment = (source: string, index: number): number => {
  const end: number = source.indexOf(BLOCK_COMMENT_END, index + BLOCK_COMMENT_DELIMITER)
  return end === -1 ? source.length : end + BLOCK_COMMENT_DELIMITER
}

const scanStringLiteral = (source: string, quote: string, cursor: number): number => {
  if (cursor >= source.length) {
    return cursor
  }
  const inner: string = source[cursor] ?? ''
  if (inner === '\\') {
    return scanStringLiteral(source, quote, cursor + BLOCK_COMMENT_DELIMITER)
  }
  return inner === quote ? cursor + 1 : scanStringLiteral(source, quote, cursor + 1)
}

const endOfStringLiteral = (source: string, index: number): number => {
  const quote: string = source[index] ?? ''
  return scanStringLiteral(source, quote, index + 1)
}

// A regex literal ends at the first unescaped slash outside a character class, and never spans a line.
// A regex literal's end depends on escapes, newlines, and character-class nesting at once. Splitting
// the three apart would hide the single cursor they share behind three functions that each need the
// others' state.
// Whether the next character sits inside a character class, which is what decides if `/` closes the
// literal or is just a slash the class contains.
const isInClassAfter = (character: string, isInClass: boolean): boolean => {
  if (character === '[') {
    return true
  }
  return character === ']' ? false : isInClass
}

const scanRegexLiteral = (source: string, cursor: number, isInClass: boolean): number => {
  if (cursor >= source.length) {
    return cursor
  }
  const inner: string = source[cursor] ?? ''
  if (inner === '\\') {
    return scanRegexLiteral(source, cursor + BLOCK_COMMENT_DELIMITER, isInClass)
  }
  if (inner === '\n') {
    return cursor
  }
  if (inner === '/' && !isInClass) {
    return cursor + 1
  }
  return scanRegexLiteral(source, cursor + 1, isInClassAfter(inner, isInClass))
}

const endOfRegexLiteral = (source: string, index: number): number =>
  scanRegexLiteral(source, index + 1, false)

/** What a fold step produced, and whether the walk should stop there. */
interface Folded<State> {
  readonly state: State
  readonly stop: boolean
}

/** One comment, string, or regex literal: where it ends, and whether it is erased rather than kept. */
interface Skipped {
  readonly stop: number
  readonly erased: boolean
}

// A line or block comment, if one opens at `index`. Split out of the construct dispatch below so each
// reads as the single question it asks.
const commentAt = (source: string, index: number): Skipped | undefined => {
  if (source[index] !== '/') {
    return undefined
  }
  const next: string = source[index + 1] ?? ''
  if (next === '/') {
    return { stop: endOfLineComment(source, index), erased: true }
  }
  return next === '*' ? { stop: endOfBlockComment(source, index), erased: true } : undefined
}

// A string literal is kept because its contents are the only place a banned construct can legitimately
// appear as data. Everything else here is erased, so prose naming a construct is never read as one.
const constructAt = (source: string, index: number, output: string): Skipped | undefined => {
  const comment: Skipped | undefined = commentAt(source, index)
  if (comment !== undefined) {
    return comment
  }
  const character: string = source[index] ?? ''
  if (QUOTES.has(character)) {
    return { stop: endOfStringLiteral(source, index), erased: false }
  }
  if (character === '/' && VALUE_POSITION.has(lastMeaningful(output))) {
    return { stop: endOfRegexLiteral(source, index), erased: true }
  }
  return undefined
}

// `/*`, `*/`, and `//` are each two characters wide.
const LAST_CHARACTER: number = -1
const NOT_FOUND: number = -1
// A key opens the literal or follows a comma, which is what keeps a colon inside a value out of it.
const TOP_LEVEL_KEY: RegExp = /(?:^|[{,])\s*([a-z_$][\w$]*)\s*:/gi
const BLOCK_COMMENT_DELIMITER: number = 2

// The needles are literal call expressions such as `payload.find(`, so the dot and the parenthesis must
// not be read as pattern syntax.
const escapeForSearch = (needle: string): string =>
  needle.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)
const BLOCK_COMMENT_END: string = '*/'

/**
 * Blank every comment and regular-expression literal to spaces, leaving newlines intact so reported line
 * numbers still point at real source positions. Without this, prose that merely names a banned construct
 * would be reported as the construct itself, which is the difference between a gate that is trusted and
 * one that is worked around.
 * @param source the file contents.
 * @returns the source with comments and regex literals replaced by spaces of equal length.
 */
export const stripComments = (source: string): string => {
  /* eslint-disable functional/no-let -- a whole source file is walked here, so recursion would risk
     the stack; the cursor and the output it builds are confined to this loop and escape as a value */
  let output: string = ''
  let index: number = 0
  /* eslint-enable functional/no-let -- the walk above is the only place this file mutates */
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

const depthAfter = (character: string, depth: number): number => {
  if (OPENERS.has(character)) {
    return depth + 1
  }
  return CLOSERS.has(character) ? depth - 1 : depth
}

/**
 * Walk `source` from `start`, tracking string literals and bracket nesting so that a bracket or a quote
 * inside a string cannot unbalance the scan. Both readers below need exactly this bookkeeping and differ
 * only in what they do with each character, so it lives here once rather than in each of them.
 * @param source the text to walk.
 * @param start the index to begin at.
 * @param fold called for every character outside a string literal; return stop to end the walk.
 * @param initial the state the fold begins with.
 */
const scanDelimited = <State>(
  source: string,
  start: number,
  fold: (state: State, step: ScanStep) => Folded<State>,
  initial: State,
): State => {
  // One cursor carries depth across a character walk. Every split of this loop has to pass that cursor
  // back and forth, which is harder to review than the loop, and this is the code the unbounded-call
  // rules are decided by.
  // eslint-disable-next-line functional/no-let -- one cursor shared by the whole walk
  let cursor: { readonly index: number; readonly depth: number; readonly state: State } = {
    index: start,
    depth: 0,
    state: initial,
  }
  while (cursor.index < source.length) {
    const character: string = source[cursor.index] ?? ''
    // A string literal is jumped over whole rather than tracked character by character, so a bracket or
    // a quote inside it can never reach the depth count.
    if (QUOTES.has(character)) {
      cursor = { ...cursor, index: endOfStringLiteral(source, cursor.index) }
      continue
    }
    const depth: number = depthAfter(character, cursor.depth)
    const folded: Folded<State> = fold(cursor.state, { character, index: cursor.index, depth })
    if (folded.stop) {
      return folded.state
    }
    cursor = { index: cursor.index + 1, depth, state: folded.state }
  }
  return cursor.state
}

/**
 * Read the text between the parenthesis at `open` and its match.
 * @param source the file contents.
 * @param open the index of the opening parenthesis.
 * @returns the argument text, or undefined when the call is unterminated (a parse error another gate reports).
 */
export const balancedArguments = (source: string, open: number): string | undefined => {
  const close: number | undefined = scanDelimited<number | undefined>(
    source,
    open,
    (found: number | undefined, step: ScanStep): Folded<number | undefined> =>
      CLOSERS.has(step.character) && step.depth === 0
        ? { state: step.index, stop: true }
        : { state: found, stop: false },
    undefined,
  )
  return close === undefined ? undefined : source.slice(open + 1, close)
}

/**
 * Reduce an argument list to the characters sitting directly inside its outermost object literal, so a
 * key nested in a `where` clause is not mistaken for a bound declared on the call itself.
 * @param argumentText the text between a call's parentheses.
 * @returns the depth-one characters, with nested structures elided.
 */
export const topLevelSlice = (argumentText: string): string =>
  scanDelimited<string>(
    argumentText,
    0,
    (collected: string, step: ScanStep): Folded<string> => {
      if (OPENERS.has(step.character)) {
        // A nested structure collapses to one space, so its keys cannot be read as top level.
        return { state: collected + (step.depth === 1 ? ' ' : ''), stop: false }
      }
      if (!CLOSERS.has(step.character) && step.depth === 1) {
        return { state: collected + step.character, stop: false }
      }
      return { state: collected, stop: false }
    },
    '',
  )

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

const occurrences = (source: string, needle: string): readonly number[] =>
  [...source.matchAll(new RegExp(escapeForSearch(needle), 'g'))].map(
    (match: RegExpExecArray): number => match.index,
  )

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

const RELATIVE_IMPORT: RegExp =
  /(?:^|\n)[^\S\n]*(?:import|export)[^\n;]*from[^\S\n]+['"](\.\.\/[^'"]*)['"]/g
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
const COLLECTION_CONFIG: RegExp = /:\s*CollectionConfig(?=[=,)\s]|$)/
const GLOBAL_CONFIG: RegExp = /:\s*GlobalConfig(?=[=,)\s]|$)/

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
  { label: 'CollectionConfig', declaration: COLLECTION_CONFIG, operations: COLLECTION_OPERATIONS },
  { label: 'GlobalConfig', declaration: GLOBAL_CONFIG, operations: GLOBAL_OPERATIONS },
]

// The keys sitting directly inside the object literal that opens after `index`. `topLevelSlice` elides
// every nested structure, which is what keeps a field-level `access:` from being read as the
// collection-level one.
const topLevelKeys = (source: string, index: number): readonly string[] => {
  const open: number = source.indexOf('{', index)
  if (open === -1) {
    return []
  }
  const body: string | undefined = balancedArguments(source, open)
  if (body === undefined) {
    return []
  }
  return [...topLevelSlice(`{${body}}`).matchAll(TOP_LEVEL_KEY)].map(
    (match: RegExpExecArray): string => match[1] ?? '',
  )
}

// Where a key sits directly inside the outermost object literal, rather than inside something nested
// in it. Searching the text instead would find a field-level `access` block and read it as the
// collection's own, which is exactly the omission this rule exists to catch.
const depthOneKeyIndex = (text: string, key: string): number => {
  const pattern: RegExp = new RegExp(String.raw`^${key}\s*:`)
  return scanDelimited<number>(
    text,
    0,
    (found: number, step: ScanStep): Folded<number> =>
      step.depth === 1 && pattern.test(text.slice(step.index))
        ? { state: step.index, stop: true }
        : { state: found, stop: false },
    NOT_FOUND,
  )
}

// The operations declared inside the config's own `access` block, as opposed to any nested one.
const declaredOperations = (source: string, index: number): readonly string[] => {
  const open: number = source.indexOf('{', index)
  if (open === -1) {
    return []
  }
  const body: string | undefined = balancedArguments(source, open)
  if (body === undefined) {
    return []
  }
  const wrapped: string = `{${body}}`
  const accessAt: number = depthOneKeyIndex(wrapped, 'access')
  return accessAt === NOT_FOUND ? [] : topLevelKeys(wrapped, accessAt)
}

// The raw text of a depth-one key's value, from the colon to the end of the enclosing literal. Callers
// narrow it further; what matters here is that a nested key of the same name cannot be picked up.
const depthOneValue = (wrapped: string, key: string): string | undefined => {
  const at: number = depthOneKeyIndex(wrapped, key)
  if (at === NOT_FOUND) {
    return undefined
  }
  const colon: number = wrapped.indexOf(':', at)
  return colon === NOT_FOUND ? undefined : wrapped.slice(colon + 1)
}

const wrappedBody = (source: string, index: number): string | undefined => {
  const open: number = source.indexOf('{', index)
  if (open === NOT_FOUND) {
    return undefined
  }
  const body: string | undefined = balancedArguments(source, open)
  return body === undefined ? undefined : `{${body}}`
}

// Payload locks nothing by default: without a login-attempt cap and a lock time, an auth collection
// accepts guesses at whatever rate a client can make them. `auth: true` is the bare enable, so it is
// the case this rule most needs to catch.
const AUTH_HARDENING_KEYS: readonly string[] = ['maxLoginAttempts', 'lockTime']

const findUnhardenedAuth = (source: string): readonly PayloadViolation[] => {
  const marker: number = source.search(COLLECTION_CONFIG)
  const wrapped: string | undefined = marker === NOT_FOUND ? undefined : wrappedBody(source, marker)
  if (wrapped === undefined) {
    return []
  }
  const value: string | undefined = depthOneValue(wrapped, 'auth')
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
          line: lineOf(source, marker),
          rule: 'require-auth-hardening',
          reason:
            `an auth collection must declare ${AUTH_HARDENING_KEYS.join(' and ')}; ` +
            `${missing.join(' and ')} left to the Payload defaults means a login attempt is never ` +
            'capped and an account is never locked',
        },
      ]
}

// A draft is unpublished content. With versions.drafts enabled, `?draft=true` serves it to whoever the
// read rule admits - so a read that is unconditionally true publishes every draft to anyone.
const ALWAYS_TRUE_READ: RegExp = /read\s*:\s*\(\s*\)\s*=>\s*true/
const DRAFTS_ENABLED: RegExp = /drafts\s*:\s*(?:true|\{)/

const isDraftExposed = (wrapped: string): boolean => {
  const versions: string | undefined = depthOneValue(wrapped, 'versions')
  if (versions === undefined || !DRAFTS_ENABLED.test(versions)) {
    return false
  }
  const access: string | undefined = depthOneValue(wrapped, 'access')
  return access !== undefined && ALWAYS_TRUE_READ.test(access)
}

const findAnonymousDraftReads = (source: string): readonly PayloadViolation[] =>
  CONFIG_KINDS.flatMap((kind: ConfigKind): readonly PayloadViolation[] => {
    const marker: number = source.search(kind.declaration)
    const wrapped: string | undefined =
      marker === NOT_FOUND ? undefined : wrappedBody(source, marker)
    if (wrapped === undefined || !isDraftExposed(wrapped)) {
      return []
    }
    return [
      {
        line: lineOf(source, marker),
        rule: 'no-anonymous-draft-reads',
        reason:
          `a ${kind.label} with drafts enabled must not grant an unconditionally true read; ` +
          'an unauthenticated client would fetch unpublished drafts through ?draft=true',
      },
    ]
  })

// Payload fills the missing operations in during sanitisation, so a partial access block is invisible
// the moment the app boots - and its default for a non-auth collection is public read. Checking that
// the word `access` appears somewhere in the file, which is what this rule used to do, accepted a block
// that declared one operation out of four.
const findUndeclaredAccess = (source: string): readonly PayloadViolation[] =>
  CONFIG_KINDS.flatMap((kind: ConfigKind): readonly PayloadViolation[] => {
    const marker: number = source.search(kind.declaration)
    if (marker === -1) {
      return []
    }
    const declared: readonly string[] = declaredOperations(source, marker)
    const missing: readonly string[] = kind.operations.filter(
      (operation: string): boolean => !declared.includes(operation),
    )
    if (missing.length === 0) {
      return []
    }
    return [
      {
        line: lineOf(source, marker),
        rule: 'require-complete-access',
        reason:
          `a ${kind.label} must declare access for ${kind.operations.join(', ')}; ` +
          `${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} left to the Payload ` +
          'defaults, which allow public read',
      },
    ]
  })

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
    ...findUnhardenedAuth(code),
    ...findAnonymousDraftReads(code),
  ]
}
