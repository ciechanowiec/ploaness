import { matchesGlob } from './file-roles.js'
import { globAlternatives } from './glob-alternatives.js'
import { asRecord, isArray } from './json-shapes.js'

const GLOB_SETTINGS: ReadonlySet<string> = new Set(['coverageExclude', 'frameworkGlue', 'generatedArtefacts'])

const consumeDirectory = (tokens: readonly string[], directories: readonly string[]): readonly string[] => {
  if (directories.length === 0) {
    return tokens.length === 0 ? [] : [tokens.join('/')]
  }
  const part: string | undefined = tokens[0]
  if (part === '**') {
    return [...consumeDirectory(tokens, directories.slice(1)), ...consumeDirectory(tokens.slice(1), directories)]
  }
  return part !== undefined && matchesGlob(part, directories[0] ?? '')
    ? consumeDirectory(tokens.slice(1), directories.slice(1))
    : []
}

/** Restrict a repository glob to one member without changing the directory it was declared against. */
export const memberGlobs = (pattern: string, memberPath: string): readonly string[] =>
  memberPath === '.'
    ? [pattern]
    : [
        ...new Set(
          globAlternatives(pattern).flatMap((alternative: string): readonly string[] =>
            consumeDirectory(alternative.split('/'), memberPath.split('/')),
          ),
        ),
      ]

/** Restrict a repository source directory to the portion owned by a member. */
export const memberDirectories = (directory: string, memberPath: string): readonly string[] => {
  if (memberPath === '.') {
    return [directory]
  }
  if (directory === '.' || directory === memberPath || memberPath.startsWith(`${directory}/`)) {
    return ['.']
  }
  return directory.startsWith(`${memberPath}/`) ? [directory.slice(memberPath.length + 1)] : []
}

const projectEntries = (raw: unknown, memberPath: string, isDirectory: boolean): readonly unknown[] =>
  (isArray(raw) ? raw : []).flatMap((entry: unknown): readonly unknown[] => {
    const record: Record<string, unknown> = asRecord(entry)
    const pattern: unknown = typeof entry === 'string' ? entry : record['pattern']
    if (typeof pattern !== 'string') {
      return []
    }
    const projected: readonly string[] = isDirectory
      ? memberDirectories(pattern, memberPath)
      : memberGlobs(pattern, memberPath)
    return projected.map((value: string): unknown =>
      typeof entry === 'string' ? value : { ...record, pattern: value },
    )
  })

const memberAssets = (raw: unknown, memberPath: string): readonly unknown[] => {
  const entries: readonly unknown[] = isArray(raw) ? raw : []
  if (memberPath === '.') {
    return entries
  }
  return entries.flatMap((entry: unknown): readonly unknown[] => {
    const record: Record<string, unknown> = asRecord(entry)
    const assetPath: unknown = record['path']
    const prefix: string = `${memberPath}/`
    return typeof assetPath === 'string' && assetPath.startsWith(prefix)
      ? [{ ...record, path: assetPath.slice(prefix.length) }]
      : []
  })
}

/** Project only filesystem declarations; scalar constraints retain ordinary inheritance. */
export const memberSettingBlock = (block: Record<string, unknown>, memberPath: string): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(block).flatMap(([key, value]: [string, unknown]): readonly (readonly [string, unknown])[] => {
      if (key === 'javascriptAllowlist' || key === 'typographyExclusions') {
        return []
      }
      if (key === 'unmanagedAssets') {
        return [[key, memberAssets(value, memberPath)]]
      }
      if (key === 'sourceRoots' || key === 'pureLogicRoots' || GLOB_SETTINGS.has(key)) {
        return [[key, projectEntries(value, memberPath, !GLOB_SETTINGS.has(key))]]
      }
      return [[key, value]]
    }),
  )
