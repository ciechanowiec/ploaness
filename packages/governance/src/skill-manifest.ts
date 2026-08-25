// Skill-manifest policy: the pure rules that validate a Claude Code SKILL.md's frontmatter contract.
// The `skills` gate in packages/cli/src/checks/references.ts walks the filesystem.
//
// Scope is deliberately the HIGH-SIGNAL, false-positive-free subset of an agentic-skill linter: the
// frontmatter Claude Code actually relies on to DISCOVER and INVOKE a skill. Body style (line length,
// prose-vs-commands, token budget) is intentionally NOT checked - a SKILL.md is a knowledge file with
// lookup tables and code examples, not a command manifesto, so those rules would reject valid skills.

/** A SKILL.md frontmatter defect that would impair the skill's discovery or invocation. */
export interface SkillViolation {
  readonly rule: 'frontmatter' | 'name' | 'description' | 'keys'
  readonly reason: string
}

/** Inputs for {@link findSkillManifestViolations}: the file's text and its parent directory name. */
interface SkillManifestInputs {
  readonly content: string
  readonly directoryName: string
}

// The frontmatter keys Claude Code recognises; anything else is dead metadata that should not accrue.
const ALLOWED_KEYS: ReadonlySet<string> = new Set([
  'name',
  'description',
  'license',
  'allowed-tools',
  'metadata',
])
const KEBAB_CASE: RegExp = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const FRONTMATTER: RegExp = /^---\n([\s\S]*?)\n---/
const TOP_LEVEL_KEY: RegExp = /^([\w-]+):[ \t]?(.*)$/
// The description must tell the agent WHEN to reach for the skill; a "when ..." clause is that signal.
const WHEN_TO_USE: RegExp = /\bwhen\b/i

interface Frontmatter {
  readonly present: boolean
  readonly keys: ReadonlyMap<string, string>
  readonly keyNames: readonly string[]
}

// Parse only flat, top-level `key: value` lines (column 0). Indented lines under a nested key such as
// `metadata:` start with whitespace, fail TOP_LEVEL_KEY, and are ignored - so nesting is never flagged.
const parseFrontmatter = (content: string): Frontmatter => {
  const match: RegExpExecArray | null = FRONTMATTER.exec(content)
  if (match === null) {
    return { present: false, keys: new Map<string, string>(), keyNames: [] }
  }
  const entries: readonly (readonly [string, string])[] = (match[1] ?? '')
    .split('\n')
    .map((line: string): RegExpExecArray | null => TOP_LEVEL_KEY.exec(line))
    .filter((entry: RegExpExecArray | null): entry is RegExpExecArray => entry !== null)
    .map((entry: RegExpExecArray): readonly [string, string] => [
      entry[1] ?? '',
      (entry[2] ?? '').trim(),
    ])
  return {
    present: true,
    keys: new Map(entries),
    keyNames: entries.map((entry: readonly [string, string]): string => entry[0]),
  }
}

const checkName = (name: string | undefined, directoryName: string): readonly SkillViolation[] => {
  if (name === undefined) {
    return [{ rule: 'name', reason: 'frontmatter has no "name" key' }]
  }
  const kebab: readonly SkillViolation[] = KEBAB_CASE.test(name)
    ? []
    : [{ rule: 'name', reason: `name "${name}" must be kebab-case` }]
  const directoryViolations: readonly SkillViolation[] =
    name === directoryName
      ? []
      : [{ rule: 'name', reason: `name "${name}" must equal parent directory "${directoryName}"` }]
  return [...kebab, ...directoryViolations]
}

const checkDescription = (description: string | undefined): readonly SkillViolation[] => {
  if (description === undefined || description.length === 0) {
    return [{ rule: 'description', reason: 'frontmatter has no "description" key' }]
  }
  if (!WHEN_TO_USE.test(description)) {
    return [
      {
        rule: 'description',
        reason: 'description must say when to use the skill ("when ..." clause)',
      },
    ]
  }
  return []
}

const checkKeys = (keyNames: readonly string[]): readonly SkillViolation[] =>
  keyNames
    .filter((key: string): boolean => !ALLOWED_KEYS.has(key))
    .map(
      (key: string): SkillViolation => ({
        rule: 'keys',
        reason: `unknown frontmatter key "${key}"`,
      }),
    )

/**
 * Return every frontmatter defect in a SKILL.md: missing frontmatter, a missing/non-kebab-case name, a
 * name that does not match its directory, a description that omits a when-to-use clause, or an unknown
 * key. An empty array means the skill's frontmatter contract is sound.
 */
export const findSkillManifestViolations = (
  inputs: SkillManifestInputs,
): readonly SkillViolation[] => {
  const frontmatter: Frontmatter = parseFrontmatter(inputs.content)
  if (!frontmatter.present) {
    return [{ rule: 'frontmatter', reason: 'file must open with valid "---" frontmatter' }]
  }
  return [
    ...checkName(frontmatter.keys.get('name'), inputs.directoryName),
    ...checkDescription(frontmatter.keys.get('description')),
    ...checkKeys(frontmatter.keyNames),
  ]
}
