// Install-time configuration: the surface a project can use to undo what the harness pinned.
//
// A pinned version is only a pin while nothing else can change it. `checkTestLibraries` requires an
// exact version in package.json, but an `overrides` entry installs a different one and leaves that
// declaration untouched - so the gate passes while the code runs against a version ploaness never saw.
// The same shape of escape silences the vulnerability gate through `pnpm.auditConfig`.
//
// The reader lives in `yaml-blocks.ts`. It is deliberately small and not a YAML parser: it looks for the
// block keys pnpm reads at the top level of a workspace file, which is where they must appear to take
// effect.

import { HARNESS_PACKAGE, isHarnessPackage } from './harness-package.js'
import { readKey } from './json-shapes.js'
import {
  declaresTopLevelKey,
  topLevelListItems,
  topLevelMappingEntries,
  topLevelScalar,
} from './yaml-blocks.js'

/**
 * The install-config keys that can redefine a resolved version.
 *
 * Exported because `version-policy.ts` reads the same four keys out of package.json, where they are an
 * escape from a pin rather than a workspace-wide one. It carried its own copy of this list, in a module
 * that already imports this one - two arrays that had to stay equal, in the same gate.
 */
export const OVERRIDE_KEYS: readonly string[] = [
  'overrides',
  'resolutions',
  'patchedDependencies',
  'packageExtensions',
]

/** The key naming the dependencies permitted to run an install script. */
const ALLOWLIST_KEY: string = 'onlyBuiltDependencies'

/** The `pnpm.auditConfig` keys that drop an advisory the vulnerability gate would otherwise report. */
const SILENCING_KEYS: readonly string[] = ['ignoreCves', 'ignoreGhsas']

/** A dependency whose resolved version a project has redefined. */
export interface OverrideEntry {
  readonly key: string
  readonly packageName: string
  /** What the override resolves to, which decides whether it redefines a version or an artefact. */
  readonly specifier: string
}

/**
 * Read the package names whose resolved version an install config redefines.
 * @param workspaceFile the contents of pnpm-workspace.yaml, or an empty string when absent.
 * @returns one entry per redefined package, naming the block it came from.
 */
export const findOverrides = (workspaceFile: string): readonly OverrideEntry[] =>
  OVERRIDE_KEYS.flatMap((key: string): readonly OverrideEntry[] =>
    topLevelMappingEntries(workspaceFile, key).map(
      ([packageName, specifier]: readonly [string, string]): OverrideEntry => ({
        key,
        packageName,
        specifier,
      }),
    ),
  )

/**
 * Decide whether an install config names the dependencies allowed to run an install script.
 * @param workspaceFile the contents of pnpm-workspace.yaml, or an empty string when absent.
 * @param packageJson the parsed package.json, where pnpm also accepts the key.
 * @returns true when the allowlist is declared in either place.
 */
export const declaresInstallScriptAllowlist = (
  workspaceFile: string,
  packageJson: unknown,
): boolean => {
  if (declaresTopLevelKey(workspaceFile, ALLOWLIST_KEY)) {
    return true
  }
  return Array.isArray(readKey(readKey(packageJson, 'pnpm'), ALLOWLIST_KEY))
}

/**
 * Report an audit configuration that would silence the vulnerability gate.
 * @param packageJson the parsed package.json.
 * @returns one message per silencing key found.
 */
export const findSilencedAdvisories = (packageJson: unknown): readonly string[] => {
  const auditConfig: unknown = readKey(readKey(packageJson, 'pnpm'), 'auditConfig')
  return SILENCING_KEYS.filter((key: string): boolean => Array.isArray(readKey(auditConfig, key)))
}

/**
 * The package a `name@version` key or specifier names.
 *
 * Split on the LAST `@`, because a scoped name begins with the same character: `@types/node@26.4.1`
 * is the package `@types/node`. Exported because `version-policy.ts` reads a patch key of the same
 * shape and carried its own copy of this split.
 * @param specifier the key or entry, with or without a version.
 * @returns the package name alone.
 */
export const packageNameOf = (specifier: string): string => {
  const at: number = specifier.lastIndexOf('@')
  return at > 0 ? specifier.slice(0, at) : specifier
}

// pnpm refuses a release younger than its floor - a day, by observation - so a compromised publish is
// usually pulled before anything installs it. That guard has a soft edge: unless `minimumReleaseAgeStrict`
// is on, an exact version pinned below the floor is installed anyway, and pnpm records an exclusion for
// it in the workspace file to make the install repeatable. The exclusion is written by the tool, for a
// version nobody decided to exempt, on one easily missed line of install output. Strict turns that into
// a refusal, which is the answer the floor exists to give.
const STRICT_KEY: string = 'minimumReleaseAgeStrict'
const EXCLUDE_KEY: string = 'minimumReleaseAgeExclude'

// The harness is the one exclusion a project may hold. A ploaness release is what a consumer's failing
// gates wait on, since the pins moving is what unblocks it, and a day's wait on the tool that decides the
// verdict is a day of every consumer failing on a pin none of them can move. Everything else stays
// behind the floor, so the exclusion list cannot become the way around a `held` line in the deps report.
const isPermittedExclusion = (entry: string): boolean => isHarnessPackage(packageNameOf(entry))

const strictViolation = (workspaceFile: string): readonly string[] =>
  topLevelScalar(workspaceFile, STRICT_KEY) === 'true'
    ? []
    : [
        `pnpm-workspace.yaml ${STRICT_KEY}: must be true; without it pnpm installs a release younger ` +
          'than its floor and writes an exclusion for it into this file rather than refusing',
      ]

const exclusionViolations = (workspaceFile: string): readonly string[] =>
  topLevelListItems(workspaceFile, EXCLUDE_KEY)
    .filter((entry: string): boolean => !isPermittedExclusion(entry))
    .map(
      (entry: string): string =>
        `pnpm-workspace.yaml ${EXCLUDE_KEY}: names ${entry}, which is not a ${HARNESS_PACKAGE} ` +
        `package; only ${HARNESS_PACKAGE} and @${HARNESS_PACKAGE}/* may be excluded from the ` +
        'release-age floor, so wait for the release to age instead',
    )

/**
 * Report every way an install config weakens pnpm's release-age floor.
 *
 * Two rules. `minimumReleaseAgeStrict` must be `true`, so a too-young exact pin fails the install
 * instead of being quietly exempted. And `minimumReleaseAgeExclude` may name only the harness
 * packages, with or without a version, because a ploaness release is the one thing a project is
 * entitled to take the day it ships.
 * @param workspaceFile the contents of pnpm-workspace.yaml, or an empty string when absent.
 * @returns one message per defect, the strict setting first.
 */
export const findReleaseAgeViolations = (workspaceFile: string): readonly string[] => [
  ...strictViolation(workspaceFile),
  ...exclusionViolations(workspaceFile),
]
