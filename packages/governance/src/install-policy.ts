// Install-time configuration: the surface a project can use to undo what the harness pinned.
//
// A pinned version is only a pin while nothing else can change it. `checkTestLibraries` requires an
// exact version in package.json, but an `overrides` entry installs a different one and leaves that
// declaration untouched - so the gate passes while the code runs against a version ploaness never saw.
// The same shape of escape silences the vulnerability gate through `pnpm.auditConfig`.
//
// The reader is deliberately small. It is not a YAML parser: it looks for the two block keys pnpm reads
// at the top level of a workspace file, which is where they must appear to take effect.

/** The install-config keys that can redefine a resolved version. */
const OVERRIDE_KEYS: readonly string[] = ['overrides', 'resolutions']

/** The key naming the dependencies permitted to run an install script. */
const ALLOWLIST_KEY: string = 'onlyBuiltDependencies'

/** A dependency whose resolved version a project has redefined. */
export interface OverrideEntry {
  readonly key: string
  readonly packageName: string
}

const isTopLevelKey = (line: string, key: string): boolean =>
  new RegExp(String.raw`^${key}\s*:`).test(line)

const isIndented = (line: string): boolean => /^\s+\S/.test(line)

// The lines of a top-level block, which run until the next unindented line.
const blockBody = (lines: readonly string[], key: string): readonly string[] => {
  const start: number = lines.findIndex((line: string): boolean => isTopLevelKey(line, key))
  if (start === -1) {
    return []
  }
  const rest: readonly string[] = lines.slice(start + 1)
  const end: number = rest.findIndex(
    (line: string): boolean => line.trim().length > 0 && !isIndented(line),
  )
  return end === -1 ? rest : rest.slice(0, end)
}

const withoutQuotes = (value: string): string => value.replaceAll(/^['"]|['"]$/g, '')

/**
 * Read the package names whose resolved version an install config redefines.
 * @param workspaceFile the contents of pnpm-workspace.yaml, or an empty string when absent.
 * @returns one entry per redefined package, naming the block it came from.
 */
export const findOverrides = (workspaceFile: string): readonly OverrideEntry[] => {
  const lines: readonly string[] = workspaceFile.split('\n')
  return OVERRIDE_KEYS.flatMap((key: string): readonly OverrideEntry[] =>
    blockBody(lines, key)
      .map((line: string): string => line.trim())
      .filter((line: string): boolean => line.length > 0 && !line.startsWith('#'))
      .flatMap((line: string): readonly OverrideEntry[] => {
        const separator: number = line.lastIndexOf(':')
        if (separator === -1) {
          return []
        }
        return [{ key, packageName: withoutQuotes(line.slice(0, separator).trim()) }]
      }),
  )
}

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
  if (
    workspaceFile.split('\n').some((line: string): boolean => isTopLevelKey(line, ALLOWLIST_KEY))
  ) {
    return true
  }
  if (typeof packageJson !== 'object' || packageJson === null) {
    return false
  }
  const pnpm: unknown = (packageJson as Record<string, unknown>)['pnpm']
  return (
    typeof pnpm === 'object' &&
    pnpm !== null &&
    Array.isArray((pnpm as Record<string, unknown>)[ALLOWLIST_KEY])
  )
}

/**
 * Report an audit configuration that would silence the vulnerability gate.
 * @param packageJson the parsed package.json.
 * @returns one message per silencing key found.
 */
export const findSilencedAdvisories = (packageJson: unknown): readonly string[] => {
  if (typeof packageJson !== 'object' || packageJson === null) {
    return []
  }
  const pnpm: unknown = (packageJson as Record<string, unknown>)['pnpm']
  if (typeof pnpm !== 'object' || pnpm === null) {
    return []
  }
  const auditConfig: unknown = (pnpm as Record<string, unknown>)['auditConfig']
  if (typeof auditConfig !== 'object' || auditConfig === null) {
    return []
  }
  return ['ignoreCves', 'ignoreGhsas'].filter((key: string): boolean =>
    Array.isArray((auditConfig as Record<string, unknown>)[key]),
  )
}
