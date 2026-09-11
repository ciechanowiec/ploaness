// Layer raw declarations before defaults, preserving inherited constraints and each member's ownership.
import { asRecord, isArray } from './json-shapes.js'
import { type DeclaredExclusion, readRawSettings, type Settings } from './settings.js'

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
  'generatedArtefacts',
  'pureLogicRoots',
])

// Keys where only a smaller number is honoured. A member may hold itself to more than the repository
// asked for and never to less, which is the same direction `readSettings` already clamps the shipped
// defaults in.
const STRICTEST_NUMBER: ReadonlySet<string> = new Set<string>([
  'accessibilityRouteBudget',
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

const isValidCeiling = (key: string, value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isSafeInteger(value) &&
  (key === 'maxSuppressions' ? value >= 0 : value > 0)

const smaller = (key: string, base: unknown, overlay: unknown): unknown => {
  if (!isValidCeiling(key, base)) {
    return isValidCeiling(key, overlay) ? overlay : undefined
  }
  return isValidCeiling(key, overlay) ? Math.min(base, overlay) : base
}

const mergeValue = (key: string, base: unknown, overlay: unknown): unknown => {
  if (ADDITIVE.has(key)) {
    return mergeArrays(base, overlay)
  }
  if (STRICTEST_NUMBER.has(key)) {
    return smaller(key, base, overlay)
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
 * Preserve a regex's package-relative meaning when repository gates read member exclusions.
 * @param memberPath the declaring package's repository-relative path.
 * @param entry the original exclusion.
 * @returns a scoped regex, a rebased glob, or the unchanged root/route declaration.
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
  return { ...entry, memberPath }
}

/**
 * Inherit effective values while retaining only the member's own declarations for reach checks.
 * @param repositoryBlock the root settings before defaults.
 * @param ownBlock the member settings before defaults.
 * @returns effective settings and the member's declared exclusions.
 */
export const readMemberSettings = (
  repositoryBlock: Record<string, unknown>,
  ownBlock: Record<string, unknown>,
): Settings => ({
  ...readRawSettings(layerSettingBlocks(repositoryBlock, ownBlock)),
  declaredExclusions: readRawSettings(ownBlock).declaredExclusions,
})
