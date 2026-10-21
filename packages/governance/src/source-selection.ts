import { hasExtension, JAVASCRIPT_EXTENSIONS, matchesGlob, matchesRole, type RolePattern } from './file-roles.js'

/** Files owned by this member, excluding every governed member nested below it. */
export const memberFiles = (files: readonly string[], nestedMembers: readonly string[]): readonly string[] =>
  files.filter(
    (file: string): boolean => !nestedMembers.some((member: string): boolean => file.startsWith(`${member}/`)),
  )

/** JavaScript entry points explicitly admitted by the effective file-role policy. */
export const allowedJavaScriptFiles = (
  files: readonly string[],
  allowlist: readonly RolePattern[],
  nestedMembers: readonly string[] = [],
): readonly string[] =>
  memberFiles(files, nestedMembers).filter(
    (file: string): boolean => hasExtension(file, JAVASCRIPT_EXTENSIONS) && matchesRole(file, allowlist),
  )

/** Match generated-file roles without interpreting globs as regular expressions. */
export const matchesAnyGlob = (file: string, patterns: readonly string[]): boolean =>
  patterns.some((pattern: string): boolean => matchesGlob(pattern, file))

/** Only assignment to the runtime's module interface initializes a CommonJS export. */
export const isCommonJsExport = (
  operator: string,
  objectName: string,
  propertyName: string | undefined,
  isRuntimeBinding: boolean,
): boolean =>
  isRuntimeBinding &&
  operator === '=' &&
  (objectName === 'exports' ||
    objectName === 'module.exports' ||
    (objectName === 'module' && propertyName === 'exports'))
