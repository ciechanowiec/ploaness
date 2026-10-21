// Decode workspace configuration without coupling policy to filesystem reads or YAML presentation.
import { parseDocument, stringify } from 'yaml'
import { isArray, isRecord } from './json-shapes.js'

const WORKSPACE_FILE: string = 'pnpm-workspace.yaml'
const MAX_ALIAS_COUNT: number = 100

const invalidValue = (key: string, expected: string): TypeError =>
  new TypeError(`${WORKSPACE_FILE} ${key}: must be ${expected}; correct the workspace configuration`)

const isMapping = (value: unknown): value is Record<string, unknown> => {
  if (!isRecord(value)) {
    return false
  }
  const prototype: unknown = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/** Read a workspace mapping, rejecting malformed evidence rather than treating it as absent. */
export const readWorkspaceDocument = (file: string): Readonly<Record<string, unknown>> => {
  try {
    const document: ReturnType<typeof parseDocument> = parseDocument(file)
    if (document.errors.length > 0 || document.warnings.length > 0) {
      throw new TypeError([...document.errors, ...document.warnings].map((error): string => error.message).join('; '))
    }
    const value: unknown = document.toJS({ maxAliasCount: MAX_ALIAS_COUNT })
    if (document.contents === null) {
      return {}
    }
    if (!isMapping(value)) {
      throw invalidValue('document', 'a mapping')
    }
    return value
  } catch (error: unknown) {
    const reason: string = error instanceof Error ? error.message : String(error)
    throw new TypeError(`${WORKSPACE_FILE}: ${reason}; correct the YAML before verification`, { cause: error })
  }
}

/** Whether a workspace mapping declares a key, including an explicitly empty sequence. */
export const declaresTopLevelKey = (file: string, key: string): boolean =>
  Object.hasOwn(readWorkspaceDocument(file), key)

/** Canonical YAML lines for a declared value, independent of its original indentation or flow style. */
export const topLevelBlockLines = (file: string, key: string): readonly string[] => {
  const value: unknown = readWorkspaceDocument(file)[key]
  return value === undefined ? [] : stringify(value).trimEnd().split('\n')
}

/** Strip surrounding quote characters from a non-YAML token, such as a container image reference. */
export const withoutQuotes = (value: string): string => value.replaceAll(/^['"]|['"]$/g, '')

/** Read a scalar without changing the existing string-valued policy interface. */
export const topLevelScalar = (file: string, key: string): string | undefined => {
  const value: unknown = readWorkspaceDocument(file)[key]
  if (value === undefined) {
    return undefined
  }
  if (typeof value !== 'string' && typeof value !== 'boolean' && typeof value !== 'number') {
    throw invalidValue(key, 'a scalar')
  }
  return String(value)
}

/** Read every sequence entry; an invalid entry cannot silently disappear from policy. */
export const topLevelListItems = (file: string, key: string): readonly string[] => {
  const value: unknown = readWorkspaceDocument(file)[key]
  if (value === undefined) {
    return []
  }
  if (!(isArray(value) && value.every((entry: unknown): entry is string => typeof entry === 'string'))) {
    throw invalidValue(key, 'a sequence of strings')
  }
  return value
}

// Package extensions carry nested dependency mappings. Preserve that value without flattening its
// children into independent override entries; scalar specifiers remain exactly what pnpm reads.
const plainValue = (_key: string, value: unknown): unknown => {
  if (isRecord(value) && !isArray(value) && !isMapping(value)) {
    throw invalidValue('override', 'a plain mapping or sequence')
  }
  return value
}

const entryValue = (value: unknown): string => {
  try {
    return typeof value === 'string' ? value : JSON.stringify(value, plainValue)
  } catch (error: unknown) {
    throw new TypeError(`${WORKSPACE_FILE}: override values must be plain, acyclic values; correct the YAML`, {
      cause: error,
    })
  }
}

/** Read one override entry per mapping key, preserving structured values and complete specifiers. */
export const topLevelMappingEntries = (file: string, key: string): readonly (readonly [string, string])[] => {
  const value: unknown = readWorkspaceDocument(file)[key]
  if (value === undefined) {
    return []
  }
  if (!isMapping(value)) {
    throw invalidValue(key, 'a mapping')
  }
  return Object.entries(value).map(([name, specifier]: readonly [string, unknown]): readonly [string, string] => [
    name,
    entryValue(specifier),
  ])
}
