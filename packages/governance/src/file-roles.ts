// Identify source, generated, binary, and prose roles so exclusions follow file meaning rather than tool defaults.

/** How much of a file is inspected before deciding it is text. Enough to reach any real header. */
const BINARY_PROBE_BYTES: number = 8192

/** Extensions the Code Rules apply to, used where a rule is about code rather than about any text. */
export const CODE_EXTENSIONS: readonly string[] = [
  '.ts',
  '.tsx',
  '.jsx',
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

/** A role regex evaluated either at the repository root or inside its declaring member. */
export type RolePattern = string | { readonly memberPath: string; readonly pattern: string }

const matchesPattern = (filePath: string, pattern: RolePattern): boolean => {
  if (typeof pattern === 'string') {
    return new RegExp(pattern).test(filePath)
  }
  const prefix: string = `${pattern.memberPath}/`
  return (
    filePath.startsWith(prefix) && new RegExp(pattern.pattern).test(filePath.slice(prefix.length))
  )
}

/**
 * Decide whether a path is excluded by a declared role pattern.
 * @param filePath the repo-relative path.
 * @param patterns the declared exclusion patterns.
 * @returns true when any pattern matches.
 */
export const matchesRole = (filePath: string, patterns: readonly RolePattern[]): boolean =>
  patterns.some((pattern: RolePattern): boolean => matchesPattern(filePath, pattern))

// The glob dialect the coverage settings are written in, which is not the regex dialect `matchesRole`
// reads. `**/` crosses directory boundaries and `*` does not, which is the whole distinction between
// `src/**/*.tsx` and `src/*.tsx`; collapsing the two would silently widen every pattern that uses one.
const GLOB_TOKEN: RegExp = /\*\*\/|\*\*|[*?.+^${}()|[\]\\]/g

const asRegexToken = (token: string): string => {
  switch (token) {
    case '**/': {
      return '(?:[^/]*/)*'
    }
    case '**': {
      return '.*'
    }
    case '*': {
      return '[^/]*'
    }
    case '?': {
      return '[^/]'
    }
    default: {
      return `\\${token}`
    }
  }
}

/**
 * Whether a repo-relative path matches a glob pattern of the kind the coverage settings carry.
 * @param pattern the glob, such as `src/app/**` or `src/**\/*.tsx`.
 * @param filePath the repo-relative path to test.
 * @returns whether the whole path matches the whole pattern.
 */
export const matchesGlob = (pattern: string, filePath: string): boolean =>
  new RegExp(
    `^${pattern.replaceAll(GLOB_TOKEN, (token: string): string => asRegexToken(token))}$`,
  ).test(filePath)

/**
 * Decide whether a path holds code the Code Rules govern.
 * @param filePath the repo-relative path.
 * @param excluded the declared generated-role patterns.
 * @returns true when the file is code and no declared role excludes it.
 */
export const isGovernedCode = (filePath: string, excluded: readonly RolePattern[]): boolean =>
  hasExtension(filePath, CODE_EXTENSIONS) && !matchesRole(filePath, excluded)
