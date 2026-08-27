// Write denial for generated files.
//
// A generated file changes only as the output of its generator, and the regeneration check already
// fails on a hand edit. That check reports the damage after the fact; the denial stops the edit from
// being made, which is the difference between a build that fails and work that was never wasted.
//
// The standard scopes this to "where the runtime used by AI agents supports the denial", so a rule here
// binds one runtime and cannot bind them all. That is conformance rather than a shortfall, and the gate
// says so rather than implying a guarantee it does not have.
import { asRecord, isArray, readKey } from './json-shapes.js'

/** The artefacts Payload derives from the configuration. Declared once and consumed by every rule. */
export const GENERATED_ARTEFACTS: readonly string[] = [
  'src/payload-types.ts',
  'src/app/(payload)/admin/importMap.js',
  'src/payload-generated-schema.ts',
]

/**
 * The deny rules a runtime must carry for a set of generated artefacts.
 *
 * The artefacts are a parameter rather than the constant above so the rule stays a statement about a
 * SET of generated paths rather than about Payload's three. What ploaness governs is one such set; the
 * ploaness repository denies its own regenerated asset bodies through the same shaped list, written by
 * hand in `.claude/settings.json` because nothing here runs `ploaness sync`. Closing over the constant
 * would have made the rule untestable against any set but that one.
 * @param artefacts the repo-relative paths a generator owns.
 * @returns the Edit and Write denials the runtime settings must carry.
 */
export const requiredDenyRules = (artefacts: readonly string[]): readonly string[] =>
  artefacts.flatMap((artefact: string): readonly string[] => [
    `Edit(${artefact})`,
    `Write(${artefact})`,
  ])

const stringsAt = (settings: unknown, section: string, key: string): readonly string[] => {
  const inner: unknown = readKey(readKey(settings, section), key)
  return isArray(inner)
    ? inner.filter((entry: unknown): entry is string => typeof entry === 'string')
    : []
}

/**
 * Merge the required deny rules into an existing runtime settings object.
 * @param existing the parsed settings, or undefined when the file does not exist.
 * @param artefacts the repo-relative paths a generator owns.
 * @returns the settings to write, preserving every key the project owns.
 */
export const applyDenyRules = (
  existing: unknown,
  artefacts: readonly string[],
): Record<string, unknown> => {
  const base: Record<string, unknown> = { ...asRecord(existing) }
  const permissions: Record<string, unknown> = { ...asRecord(base['permissions']) }
  const deny: readonly string[] = stringsAt(base, 'permissions', 'deny')
  const merged: readonly string[] = [
    ...deny,
    ...requiredDenyRules(artefacts).filter((rule: string): boolean => !deny.includes(rule)),
  ]
  return { ...base, permissions: { ...permissions, deny: merged } }
}

/**
 * Report every required denial the runtime settings do not carry, and every re-permission of one.
 * @param settings the parsed runtime settings, or undefined when absent.
 * @param localSettings the parsed machine-local overrides, or undefined when absent.
 * @param artefacts the repo-relative paths a generator owns.
 * @returns one message per missing denial or re-permitted artefact.
 */
export const findDenialViolations = (
  settings: unknown,
  localSettings: unknown,
  artefacts: readonly string[],
): readonly string[] => {
  const required: readonly string[] = requiredDenyRules(artefacts)
  const deny: readonly string[] = stringsAt(settings, 'permissions', 'deny')
  const missing: readonly string[] = required
    .filter((rule: string): boolean => !deny.includes(rule))
    .map((rule: string): string => `no write denial for ${rule}; run \`ploaness sync\` to add it`)
  // A local override that re-permits a denied artefact undoes the denial on the one machine where it
  // matters most, and it is untracked, so nothing else would ever report it.
  const allowed: readonly string[] = stringsAt(localSettings, 'permissions', 'allow')
  const rePermitted: readonly string[] = allowed
    .filter((rule: string): boolean => required.includes(rule))
    .map(
      (rule: string): string =>
        `local settings re-permit ${rule}, which the project denies; remove the local allow entry`,
    )
  return [...missing, ...rePermitted]
}

/**
 * The generated paths a repository denies, across every member that has any.
 *
 * The runtime reads one settings file, at the repository root, while the artefacts are named relative
 * to the member that generates them. A rule written for one member would therefore bind nothing in a
 * workspace. For a single member at the root the union is the artefact list unchanged, which is what
 * keeps a single-package project's settings file byte-identical.
 * @param memberPaths the repo-relative paths of the members that own generated artefacts.
 * @param artefacts the member-relative paths a generator owns.
 * @returns every repo-relative path the runtime must deny, in member order.
 */
export const deniedPathsFor = (
  memberPaths: readonly string[],
  artefacts: readonly string[],
): readonly string[] =>
  memberPaths.flatMap((memberPath: string): readonly string[] =>
    artefacts.map((artefact: string): string =>
      memberPath === '.' ? artefact : `${memberPath}/${artefact}`,
    ),
  )
