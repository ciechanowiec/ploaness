// How a member's settings sit on top of the repository's.
//
// A workspace declares some facts once and some per package. Which is which is not uniform, and reading
// it wrong is silent either way: concatenating two `pretest` commands would run a mangled argv, while
// letting a member REPLACE `sourceRoots` would narrow the scope the harness refuses to narrow.
//
// Layering happens on the RAW blocks, before any default is applied. Merging defaulted objects instead
// would make "declared nothing" indistinguishable from "declared exactly the default", so a repository
// that declared a stricter bundle budget would be silently overwritten by every member that declared
// none.
import { asRecord, isArray } from './json-shapes.js'
import type { DeclaredExclusion } from './settings.js'

/** Keys where a member ADDS to what the repository declared, the way `sourceRoots` always has. */
const ADDITIVE: ReadonlySet<string> = new Set<string>([
  'sourceRoots',
  'unmanagedAssets',
  'typographyExclusions',
  'javascriptAllowlist',
  'coverageExclude',
  'vulnerabilityAllowlist',
  'secretAllowlist',
  'publicAccess',
  'auxiliaryServers',
  'accessibilitySkipRoutes',
  'frameworkGlue',
  'pureLogicRoots',
])

// Keys where only a smaller number is honoured. A member may hold itself to more than the repository
// asked for and never to less, which is the same direction `readSettings` already clamps the shipped
// defaults in.
const STRICTEST_NUMBER: ReadonlySet<string> = new Set<string>([
  'bundleBudgetBytes',
  'maxSuppressions',
])

/** Keys that are one value describing one package, where the member's answer replaces the repository's. */
const REPLACED: ReadonlySet<string> = new Set<string>([
  'pretest',
  'testWrapper',
  'serverUrl',
  'vulnerabilitySeverity',
])

const mergeArrays = (base: unknown, overlay: unknown): unknown => [
  ...(isArray(base) ? base : []),
  ...(isArray(overlay) ? overlay : []),
]

const smaller = (base: unknown, overlay: unknown): unknown => {
  if (typeof base !== 'number') {
    return overlay
  }
  return typeof overlay === 'number' ? Math.min(base, overlay) : base
}

const mergeValue = (key: string, base: unknown, overlay: unknown): unknown => {
  if (ADDITIVE.has(key)) {
    return mergeArrays(base, overlay)
  }
  if (STRICTEST_NUMBER.has(key)) {
    return smaller(base, overlay)
  }
  if (REPLACED.has(key)) {
    return overlay ?? base
  }
  // Everything else is a record of independent entries - `analysisEnv` is the only one today - where a
  // member naming a variable the repository did not should keep both.
  return { ...asRecord(base), ...asRecord(overlay) }
}

/**
 * Fold a member's raw settings block onto the repository's.
 * @param base the repository's raw block.
 * @param overlay the member's raw block.
 * @returns one raw block, still undefaulted.
 */
export const layerSettingBlocks = (
  base: Record<string, unknown>,
  overlay: Record<string, unknown>,
): Record<string, unknown> => {
  const keys: ReadonlySet<string> = new Set<string>([...Object.keys(base), ...Object.keys(overlay)])
  return Object.fromEntries(
    [...keys].map((key: string): readonly [string, unknown] => [
      key,
      Object.hasOwn(base, key) && Object.hasOwn(overlay, key)
        ? mergeValue(key, base[key], overlay[key])
        : (base[key] ?? overlay[key]),
    ]),
  )
}

/**
 * Move a member's exclusion into the repository's path space.
 *
 * The gates that walk the tracked tree run once, at the repository root, while a member declares its
 * exclusions relative to itself. `^src/generated/` written inside `apps/web` therefore matches nothing
 * when the repository-scope gate walks past `apps/web/src/generated/`, and a generated directory a
 * project correctly excused starts failing the typography ban.
 *
 * An UNANCHORED pattern is left alone, deliberately. `importMap\.js$` already matches at any depth, and
 * prefixing it would narrow it to one member - so the rule errs toward a pattern that matches too much
 * at repository scope rather than one that silently stops matching. Too wide is the safe direction here:
 * a repository-scope gate that skips one extra path reports one fewer finding, while a narrowed pattern
 * reports a project for a file it had already accounted for.
 * @param memberPath the member's repo-relative path, `.` for the member at the root.
 * @param entry the exclusion as the member declared it.
 * @returns the exclusion as the repository-scope gates must read it.
 */
export const rebaseExclusion = (
  memberPath: string,
  entry: DeclaredExclusion,
): DeclaredExclusion => {
  if (memberPath === '.') {
    return entry
  }
  if (entry.kind === 'route') {
    return entry
  }
  if (entry.kind === 'glob') {
    return { ...entry, pattern: `${memberPath}/${entry.pattern}` }
  }
  return entry.pattern.startsWith('^')
    ? { ...entry, pattern: `^${memberPath}/${entry.pattern.slice(1)}` }
    : entry
}
