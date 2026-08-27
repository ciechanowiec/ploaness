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
import { readKey } from './json-shapes.js'
import { declaresTopLevelKey, topLevelMappingEntries } from './yaml-blocks.js'

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
