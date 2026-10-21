// Identify source, generated, binary, and prose roles so exclusions follow file meaning rather than tool defaults.
import { isUtf8 } from 'node:buffer'
import path from 'node:path'
import { globAlternatives } from './glob-alternatives.js'

/** Normalize a declared source directory without allowing it to escape the member. */
export const normalisedSourceRoot = (root: string): string => {
  const normalised: string = path.posix.normalize(root)
  if (normalised === '..' || root.length === 0 || path.posix.isAbsolute(normalised) || normalised.startsWith('../')) {
    throw new TypeError('ploaness.sourceRoots must name directories within the member; use a member-relative path')
  }
  return normalised.endsWith('/') ? normalised.slice(0, -1) : normalised
}

/** Match literal member-relative directories, including the explicitly declared member root. */
export const isWithinSourceRoots = (file: string, roots: readonly string[]): boolean =>
  roots.some((root: string): boolean => {
    const normalised: string = normalisedSourceRoot(root)
    return normalised === '.' || file.startsWith(`${normalised}/`)
  })

const NUL_BYTE: number = 0
// A PDF can use ASCII for every object and stream and still carry byte offsets that formatting would break.
const PDF_HEADER_BYTES: number = 9
const PDF_HEADER: RegExp = /^%PDF-\d\.\d[\r\n]/
const UTF8: TextDecoder = new TextDecoder()

/** TypeScript source formats accepted by the harness, independent of a file's test or generated role. */
export const TYPESCRIPT_SOURCE_EXTENSIONS: readonly string[] = ['.ts', '.tsx', '.mts', '.cts']

/** Extensions the Code Rules apply to, used where a rule is about code rather than about any text. */
export const JAVASCRIPT_EXTENSIONS: readonly string[] = ['.js', '.jsx', '.mjs', '.cjs']

/** Every stylesheet format supported by the stylesheet gate. */
export const STYLESHEET_EXTENSIONS: readonly string[] = ['.css', '.scss']

/** Extensions the Code Rules govern. */
export const CODE_EXTENSIONS: readonly string[] = [
  ...TYPESCRIPT_SOURCE_EXTENSIONS,
  ...JAVASCRIPT_EXTENSIONS,
  ...STYLESHEET_EXTENSIONS,
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
export type RolePattern =
  | string
  | { readonly memberPath: string; readonly pattern: string }
  | { readonly repositoryPath: string; readonly pattern: string }

const matchesPattern = (filePath: string, pattern: RolePattern): boolean => {
  if (typeof pattern === 'string') {
    return new RegExp(pattern).test(filePath)
  }
  if ('repositoryPath' in pattern) {
    return new RegExp(pattern.pattern).test(`${pattern.repositoryPath}/${filePath}`)
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

const GLOB_PARTS: RegExp = /\*\*\/|\*\*|[*?.+^${}()|[\]\\]/g

const regexPart = (part: string): string => {
  switch (part) {
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
      return `\\${part}`
    }
  }
}

/** Match the complete path, allowing brace alternatives and literal framework directory names. */
export const matchesGlob = (pattern: string, filePath: string): boolean =>
  globAlternatives(pattern).some((alternative: string): boolean =>
    new RegExp(`^${alternative.replaceAll(GLOB_PARTS, (part: string): string => regexPart(part))}$`).test(filePath),
  )

/**
 * Decide whether a path holds code the Code Rules govern.
 * @param filePath the repo-relative path.
 * @param excluded the declared generated-role patterns.
 * @returns true when the file is code and no declared role excludes it.
 */
export const isGovernedCode = (filePath: string, excluded: readonly RolePattern[]): boolean =>
  hasExtension(filePath, CODE_EXTENSIONS) && !matchesRole(filePath, excluded)
