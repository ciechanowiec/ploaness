// Reading source text without parsing it: comment stripping, balanced-delimiter scanning, and the
// depth-aware key lookups that tell a literal's own key from a nested one.
//
// It is the generic half of what was `payload-policy.ts`, extracted when that file reached the size cap
// and then again when a second layer needed it. Three readers share it now: the Payload rules in
// `payload-source.ts`, and the JSONC reader in `json-shapes.ts` - a tsconfig legally carries comments,
// so the rule that judges one has to strip them the same way, and a second stripper is a second set of
// edge cases about string literals nobody would keep in step.
//
// The walk is deliberately conservative. A reader returns undefined wherever the answer is not
// statically decidable, because a false positive in a build-failing gate costs far more than a dynamic
// construct a reviewer would catch anyway.
import { escapeForRegex } from './text-escapes.js'

const OPENERS: ReadonlySet<string> = new Set(['(', '[', '{'])
const CLOSERS: ReadonlySet<string> = new Set([')', ']', '}'])
const QUOTES: ReadonlySet<string> = new Set(["'", '"', '`'])

/** The offset `at` reads to reach the final element. */
export const LAST_CHARACTER: number = -1

/** The value `indexOf` and this module's readers return when there is nothing to point at. */
export const NOT_FOUND: number = -1

/**
 * The one-based line a source offset falls on.
 * @param source the file contents.
 * @param index the offset.
 * @returns the line number, counting from one.
 */
export const lineOf = (source: string, index: number): number =>
  source.slice(0, index).split('\n').length

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

// `/*`, `*/`, and `//` are each two characters wide, and a backslash escape is the character after it.
const DELIMITER_WIDTH: number = 2
const BLOCK_COMMENT_END: string = '*/'

const endOfLineComment = (source: string, index: number): number => {
  const end: number = source.indexOf('\n', index)
  return end === NOT_FOUND ? source.length : end
}

const endOfBlockComment = (source: string, index: number): number => {
  const end: number = source.indexOf(BLOCK_COMMENT_END, index + DELIMITER_WIDTH)
  return end === NOT_FOUND ? source.length : end + DELIMITER_WIDTH
}

// Iterative rather than recursive, for the reason the main walk below is: a single string literal can be
// a whole inlined data URI, and V8 does not eliminate the tail call that a per-character recursion
// leaves on the stack.
const scanStringLiteral = (source: string, quote: string, start: number): number => {
  // eslint-disable-next-line functional/no-let -- one cursor confined to this walk
  let cursor: number = start
  while (cursor < source.length) {
    const inner: string = source[cursor] ?? ''
    if (inner === '\\') {
      cursor += DELIMITER_WIDTH
      continue
    }
    if (inner === quote) {
      return cursor + 1
    }
    cursor += 1
  }
  return cursor
}

const endOfStringLiteral = (source: string, index: number): number => {
  const quote: string = source[index] ?? ''
  return scanStringLiteral(source, quote, index + 1)
}

// A regex literal ends at the first unescaped slash outside a character class, and never spans a line.
// Its end depends on escapes, newlines, and character-class nesting at once; splitting the three apart
// would hide the single cursor they share behind three functions that each need the others' state.
const isInClassAfter = (character: string, isInClass: boolean): boolean => {
  if (character === '[') {
    return true
  }
  return character === ']' ? false : isInClass
}

/** Where a regex scan stands: the next offset to read, and whether it has ended there. */
interface RegexCursor {
  readonly index: number
  readonly isInClass: boolean
  readonly end: number | undefined
}

// One character of the walk, so the loop below carries the cursor and this carries the decisions. A
// newline ends the literal without consuming it (a regex never spans a line); an unescaped slash
// outside a character class ends it and is part of it.
const afterRegexCharacter = (character: string, cursor: RegexCursor): RegexCursor => {
  if (character === '\\') {
    return { ...cursor, index: cursor.index + DELIMITER_WIDTH }
  }
  if (character === '\n') {
    return { ...cursor, end: cursor.index }
  }
  return character === '/' && !cursor.isInClass
    ? { ...cursor, end: cursor.index + 1 }
    : {
        index: cursor.index + 1,
        isInClass: isInClassAfter(character, cursor.isInClass),
        end: undefined,
      }
}

const scanRegexLiteral = (source: string, start: number): number => {
  // eslint-disable-next-line functional/no-let -- one cursor confined to this walk
  let cursor: RegexCursor = { index: start, isInClass: false, end: undefined }
  while (cursor.index < source.length && cursor.end === undefined) {
    cursor = afterRegexCharacter(source[cursor.index] ?? '', cursor)
  }
  return cursor.end ?? cursor.index
}

const endOfRegexLiteral = (source: string, index: number): number =>
  scanRegexLiteral(source, index + 1)

/** What a fold step produced, and whether the walk should stop there. */
export interface Folded<State> {
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
export interface ScanStep {
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
 * inside a string cannot unbalance the scan. Every reader below needs exactly this bookkeeping and they
 * differ only in what they do with each character, so it lives here once rather than in each of them.
 * @param source the text to walk.
 * @param start the index to begin at.
 * @param fold called for every character outside a string literal; return stop to end the walk.
 * @param initial the state the fold begins with.
 */
export const scanDelimited = <State>(
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
        // The outermost opener collapses to one space so its keys cannot run into the previous token;
        // a nested one contributes nothing, which is what elides the structure beneath it.
        return { state: collected + (step.depth === 1 ? ' ' : ''), stop: false }
      }
      if (!CLOSERS.has(step.character) && step.depth === 1) {
        return { state: collected + step.character, stop: false }
      }
      return { state: collected, stop: false }
    },
    '',
  )

/**
 * Every offset at which `needle` occurs literally.
 * @param source the text to search.
 * @param needle the literal to find; its punctuation is not read as pattern syntax.
 * @returns the offsets, in reading order.
 */
export const occurrences = (source: string, needle: string): readonly number[] =>
  [...source.matchAll(new RegExp(escapeForRegex(needle), 'g'))].map(
    (match: RegExpExecArray): number => match.index,
  )

// A key opens the literal or follows a comma, which is what keeps a colon inside a value out of it.
const TOP_LEVEL_KEY: RegExp = /(?:^|[{,])\s*([a-z_$][\w$]*)\s*:/gi

/**
 * The keys sitting directly inside the object literal that opens after `index`.
 * @param source the text to read.
 * @param index where to look for the opening brace.
 * @returns the depth-one key names, with every nested structure elided.
 */
export const topLevelKeys = (source: string, index: number): readonly string[] => {
  const open: number = source.indexOf('{', index)
  if (open === NOT_FOUND) {
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
