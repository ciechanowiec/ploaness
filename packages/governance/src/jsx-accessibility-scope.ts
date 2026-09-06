import { hasExtension, matchesGlob } from './file-roles.js'
import { analysisBoundaries } from './workspace-policy.js'

/** The application JSX file types, shared by native analysis and Biome deduplication. */
export const JSX_EXTENSIONS: readonly string[] = ['.tsx', '.jsx']

/** Existing application-lint exclusions, expressed once for both analyzer owners. */
export const APPLICATION_JSX_IGNORES: readonly string[] = [
  '.next/**',
  '**/node_modules/**',
  'coverage/**',
  'pgadmin/**',
  '.*/**',
]

/** Biome overrides apply only where the application's native JSX analyzer takes responsibility. */
export const jsxAnalysisPatterns = (): readonly string[] => [
  ...JSX_EXTENSIONS.map((extension: string): string => `**/*${extension}`),
  ...APPLICATION_JSX_IGNORES.map((pattern: string): string => `!${pattern}`),
]

/**
 * Select committable JSX files without crossing a member or generated-file boundary.
 * @param files the current working-tree inventory, including new source.
 * @param generated the member's generated-file roles.
 * @param siblings other governed members, relative to this member.
 * @returns the deduplicated paths the native analyzer must actually read.
 */
export const jsxAccessibilityFiles = (
  files: readonly string[],
  generated: readonly string[],
  siblings: readonly string[],
): readonly string[] => {
  const ignored: readonly string[] = [
    ...APPLICATION_JSX_IGNORES,
    ...generated,
    ...analysisBoundaries(siblings),
  ]
  return [...new Set(files)].filter(
    (file: string): boolean =>
      hasExtension(file, JSX_EXTENSIONS) &&
      !ignored.some((pattern: string): boolean => matchesGlob(pattern, file)),
  )
}

/** Consumer configuration cannot shadow the harness, including in nested directories. */
export const isOxlintConfig = (file: string): boolean =>
  /(?:^|\/)(?:\.oxlintrc(?:\.[^/]*)?|\.oxlintignore|oxlint\.config\.[^/]+)$/u.test(file)
