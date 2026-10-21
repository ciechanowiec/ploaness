import { matchesGlob } from './file-roles.js'
import { memberFiles } from './source-selection.js'

/** Select owned files from the same ordered include/exclude contract the scaffold declares. */
export const biomeSelection = (
  files: readonly string[],
  includes: readonly string[],
  nestedMembers: readonly string[],
): readonly string[] =>
  memberFiles(files, nestedMembers).filter((file: string): boolean => {
    const positive: readonly string[] = includes.filter((pattern: string): boolean => !pattern.startsWith('!'))
    const negative: readonly string[] = includes
      .filter((pattern: string): boolean => pattern.startsWith('!'))
      .map((pattern: string): string => pattern.slice(1))
    return (
      positive.some((pattern: string): boolean => matchesGlob(pattern, file)) &&
      !negative.some((pattern: string): boolean => matchesGlob(pattern, file) || matchesGlob(`${pattern}/**`, file))
    )
  })
