// File roles: the categories a repository can determine from a file itself and uses to include or
// exclude it from a check.
//
// The typography ban used to carry its own allowlist of ten extensions, which is the wrong shape for a
// rule that reaches "every tracked file the repository does not exclude by role": a `.css`, a `.adoc`,
// a shell script, or a Dockerfile went unscanned, and every new text format arrived unscanned until
// someone remembered to extend the list. A role predicate is default-safe in the opposite direction -
// a new format is covered by construction, and exclusion is the thing that must be stated.

/** How much of a file is inspected before deciding it is text. Enough to reach any real header. */
const BINARY_PROBE_BYTES: number = 8192

/** Extensions the Code Rules apply to, used where a rule is about code rather than about any text. */
export const CODE_EXTENSIONS: readonly string[] = [
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.mjs',
  '.cjs',
  '.css',
  '.scss',
]

/** Extensions whose role is prose, where a code-shaped rule such as a line cap does not apply. */
export const PROSE_EXTENSIONS: readonly string[] = ['.md', '.adoc', '.txt']

/**
 * Decide whether a file is binary, from the file itself rather than from its name.
 * @param bytes the file's leading content.
 * @returns true when a NUL byte appears in the probed span, which no text encoding produces.
 */
export const isBinary = (bytes: Uint8Array): boolean =>
  bytes.subarray(0, BINARY_PROBE_BYTES).includes(0)

/**
 * Decide whether a path carries one of the given extensions.
 * @param filePath the repo-relative path.
 * @param extensions the extensions to test.
 * @returns true when the path ends with one of them.
 */
export const hasExtension = (filePath: string, extensions: readonly string[]): boolean =>
  extensions.some((extension: string): boolean => filePath.endsWith(extension))

/**
 * Decide whether a path is excluded by a declared role pattern.
 * @param filePath the repo-relative path.
 * @param patterns the declared exclusion patterns.
 * @returns true when any pattern matches.
 */
export const matchesRole = (filePath: string, patterns: readonly string[]): boolean =>
  patterns.some((pattern: string): boolean => new RegExp(pattern).test(filePath))

/**
 * Decide whether a path holds code the Code Rules govern.
 * @param filePath the repo-relative path.
 * @param excluded the declared generated-role patterns.
 * @returns true when the file is code and no declared role excludes it.
 */
export const isGovernedCode = (filePath: string, excluded: readonly string[]): boolean =>
  hasExtension(filePath, CODE_EXTENSIONS) && !matchesRole(filePath, excluded)
