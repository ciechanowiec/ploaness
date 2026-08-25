// Narrowing a parsed manifest, which arrives as `unknown` and has to be read as an object.
//
// Six modules each carried their own copy of these two functions, and every copy narrowed with a type
// ASSERTION. That is the wrong instrument twice over: an assertion is a claim the compiler accepts
// without checking, and `type-coverage --strict` counts each one as untyped, which is what put a 100%
// score out of reach here. A user-defined type guard says exactly the same thing and IS checked, so the
// narrowing survives a refactor that changes the shape underneath it.
//
// An array narrows to a record, as it did before: `typeof [] === 'object'`, and a manifest key holding
// an array is read by whichever caller cares, not refused here.
import { maskLiterals, stripComments } from './source-text.js'

/** A parsed document, or the reason it could not be parsed. */
export interface ParsedJson {
  readonly value: unknown
  /** Undefined when the text parsed; the parser's own message otherwise. */
  readonly problem: string | undefined
}

// A trailing comma is legal in JSONC and in nothing `JSON.parse` accepts, so it is removed after the
// comments are, when a comma followed only by whitespace and a closing bracket can be recognised.
const TRAILING_COMMA: RegExp = /,(?=\s*[\]}])/g

// Located on a mask rather than on the document, and removed from the document by offset. Run over the
// text itself the pattern reads inside a string too, and a glob such as `{ts,}` in a Biome `includes`
// lost the comma it declared - a silent edit to a parsed value, in the reader every wiring rule uses.
// Removed from the end backwards so each remaining offset still names the character it named.
const withoutTrailingCommas = (text: string): string =>
  [...maskLiterals(text).matchAll(TRAILING_COMMA)]
    .map((match: RegExpExecArray): number => match.index)
    .reduceRight(
      (current: string, at: number): string => current.slice(0, at) + current.slice(at + 1),
      text,
    )

/**
 * Parse JSON that may carry comments and trailing commas.
 *
 * `tsconfig.json` legally carries both, and so does a Biome config - which meant the rules that judge
 * them threw a SyntaxError out of a pure function on a project scaffolded by `create-payload-app`. The
 * gate that caught it is a precondition, so the whole run halted saying only that the gate "could not
 * run". Comments are stripped by the same reader the source rules use rather than by a second regex,
 * because the hard part is not finding `//` but knowing when it is inside a string.
 * @param text the document to read.
 * @returns the parsed value, or the reason it could not be parsed.
 */
export const parseJsonc = (text: string): ParsedJson => {
  try {
    return {
      value: JSON.parse(withoutTrailingCommas(stripComments(text))),
      problem: undefined,
    }
  } catch (error: unknown) {
    return { value: undefined, problem: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Whether a parsed value can be read as an object with string keys.
 * @param raw the value to narrow, typically a fragment of a parsed manifest.
 * @returns whether it is a non-null object.
 */
export const isRecord = (raw: unknown): raw is Record<string, unknown> =>
  typeof raw === 'object' && raw !== null

/**
 * Read a parsed value as an object, or as an empty one when it is not.
 *
 * A malformed value yields no keys rather than an error, so a typo in a manifest leaves a rule reading
 * its defaults instead of failing the whole run. Every default in this package is the strict end of its
 * setting, which is what makes that safe.
 * @param raw the value to read.
 * @returns the value narrowed to an object, or an empty object.
 */
export const asRecord = (raw: unknown): Record<string, unknown> => (isRecord(raw) ? raw : {})

const isStringEntry = (entry: [string, unknown]): entry is [string, string] =>
  typeof entry[1] === 'string'

/**
 * Read a parsed value as an object of strings, dropping every key whose value is not one.
 * @param raw the value to read.
 * @returns the string-valued keys of the value, or an empty object.
 */
export const asStringRecord = (raw: unknown): Record<string, string> =>
  Object.fromEntries(Object.entries(asRecord(raw)).filter(isStringEntry))

/**
 * Whether a parsed value is an array of values still to be narrowed.
 *
 * `Array.isArray` alone narrows an `unknown` to `any[]`, which hands every element back untyped and
 * puts the narrowing beyond the compiler's reach again one step later. This says the same thing and
 * leaves each element `unknown`, so the caller has to state what it expects.
 * @param raw the value to narrow.
 * @returns whether it is an array.
 */
export const isArray = (raw: unknown): raw is readonly unknown[] => Array.isArray(raw)

/**
 * Read a parsed value as text, or as the empty string when it is not text.
 * @param raw the value to read.
 * @returns the string, or an empty one.
 */
export const asText = (raw: unknown): string => (typeof raw === 'string' ? raw : '')

/**
 * Read a parsed value as text, or as undefined when it is not text.
 *
 * Distinct from `asText` because the two answer different questions. An empty string is a value a rule
 * compares against; `undefined` says the value was never declared, which is how a caller states that a
 * rule has nothing to apply. Collapsing the two would turn "ploaness pins no package manager" into
 * "ploaness requires the package manager to be the empty string".
 * @param raw the value to read.
 * @returns the string, or undefined.
 */
export const asOptionalText = (raw: unknown): string | undefined =>
  typeof raw === 'string' ? raw : undefined

/**
 * Read one key of a parsed value.
 * @param raw the value holding the key.
 * @param key the key to read.
 * @returns the value at that key, or undefined when the value is not an object.
 */
export const readKey = (raw: unknown, key: string): unknown => asRecord(raw)[key]

/**
 * Every package a manifest declares, whichever block it sits in.
 *
 * Three modules asked this question and three of them answered it, which is the shape of a drift rather
 * than of a helper: the CLI's preflight copy read the versions as unknowns and its freshness copy read
 * them as strings, so the two disagreed about what a manifest declaring a non-string version had said.
 * It lives here because the question is about the shape of a parsed manifest and not about any one rule.
 * @param packageJson the parsed manifest.
 * @returns the declared name-to-version pairs, a devDependency winning a name declared in both blocks.
 */
export const declaredDependencies = (packageJson: unknown): Record<string, string> => ({
  ...asStringRecord(readKey(packageJson, 'dependencies')),
  ...asStringRecord(readKey(packageJson, 'devDependencies')),
})
