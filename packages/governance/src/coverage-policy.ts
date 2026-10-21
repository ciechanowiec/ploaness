// Coverage includes follow member roots; component and test roles retain their separate checks.
import { hasExtension, matchesGlob, normalisedSourceRoot, TYPESCRIPT_SOURCE_EXTENSIONS } from './file-roles.js'
import { memberFiles } from './source-selection.js'
import { escapeForRegex } from './text-escapes.js'

const EXECUTABLE_EXTENSIONS: readonly string[] = TYPESCRIPT_SOURCE_EXTENSIONS.filter(
  (extension: string): boolean => extension !== '.tsx',
)

const coverageRoots = (sourceRoots: readonly string[]): readonly string[] =>
  [...new Set(sourceRoots.map((root: string): string => normalisedSourceRoot(root)))].filter(
    (root: string): boolean => root !== 'tests' && !root.startsWith('tests/'),
  )

const rootPrefix = (root: string): string => (root === '.' ? '' : `${root}/`)

// A source root is a directory name, not a project-supplied glob expression.
const globPrefix = (root: string): string => escapeForRegex(rootPrefix(root)).replaceAll(/['"!]/g, String.raw`\$&`)

/** Patterns for executable TypeScript under a member's effective source roots. */
export const coverageIncludes = (sourceRoots: readonly string[]): readonly string[] =>
  coverageRoots(sourceRoots).flatMap((root: string): readonly string[] =>
    EXECUTABLE_EXTENSIONS.map((extension: string): string => `${globPrefix(root)}**/*${extension}`),
  )

/** Whether a path is measured before project exclusions, retaining invariant test and declaration roles. */
export const isCoverageCandidate = (file: string, sourceRoots: readonly string[]): boolean =>
  hasExtension(file, EXECUTABLE_EXTENSIONS) &&
  !COVERAGE_ROLE_EXCLUDE.some((pattern: string): boolean => matchesGlob(pattern, file)) &&
  coverageRoots(sourceRoots).some((root: string): boolean => file.startsWith(rootPrefix(root)))

/** Owned files remain inside the member even when its source root is the whole directory. */
export const coverageOwnedFiles = (files: readonly string[], siblingPaths: readonly string[]): readonly string[] =>
  memberFiles(files, siblingPaths)

/** Files measured by coverage before project exclusions, respecting member boundaries and invariant roles. */
export const coverageCandidates = (
  files: readonly string[],
  sourceRoots: readonly string[],
  siblingPaths: readonly string[],
): readonly string[] =>
  coverageOwnedFiles(files, siblingPaths).filter((file: string): boolean => isCoverageCandidate(file, sourceRoots))

/** Literal nested-member boundaries passed by the CLI, which owns repository discovery. */
export const coverageBoundaries = (siblingPaths: readonly string[]): readonly string[] =>
  siblingPaths.map((sibling: string): string => `${globPrefix(normalisedSourceRoot(sibling))}**`)

/** Non-executable declarations and the test tree are roles, regardless of the containing source root. */
export const COVERAGE_ROLE_EXCLUDE: readonly string[] = [
  'tests/**',
  '**/node_modules/**',
  '**/*.d.ts',
  '**/*.d.mts',
  '**/*.d.cts',
  '**/*.spec.*',
  '**/*.test.*',
]
