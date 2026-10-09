// Identify source, generated, binary, and prose roles so exclusions follow file meaning rather than tool defaults.
import { isUtf8 } from 'node:buffer'

const NUL_BYTE: number = 0
// A PDF can use ASCII for every object and stream and still carry byte offsets that formatting would break.
const PDF_HEADER_BYTES: number = 9
const PDF_HEADER: RegExp = /^%PDF-\d\.\d[\r\n]/
const UTF8: TextDecoder = new TextDecoder()

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
 * Identify binary assets before typography or whitespace checks decode their contents as UTF-8 text.
 * @param bytes the complete file contents; binary payloads can follow arbitrarily long text headers.
 * @returns true for NUL-containing or non-UTF-8 data, or a PDF identified by its format header.
 */
export const isBinary = (bytes: Uint8Array): boolean =>
  bytes.includes(NUL_BYTE) || !isUtf8(bytes) || PDF_HEADER.test(UTF8.decode(bytes.subarray(0, PDF_HEADER_BYTES)))

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
  return filePath.startsWith(prefix) && new RegExp(pattern.pattern).test(filePath.slice(prefix.length))
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
  new RegExp(`^${pattern.replaceAll(GLOB_TOKEN, (token: string): string => asRegexToken(token))}$`).test(filePath)

/**
 * Decide whether a path holds code the Code Rules govern.
 * @param filePath the repo-relative path.
 * @param excluded the declared generated-role patterns.
 * @returns true when the file is code and no declared role excludes it.
 */
export const isGovernedCode = (filePath: string, excluded: readonly RolePattern[]): boolean =>
  hasExtension(filePath, CODE_EXTENSIONS) && !matchesRole(filePath, excluded)
