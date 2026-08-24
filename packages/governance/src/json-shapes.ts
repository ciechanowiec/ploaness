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
