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
