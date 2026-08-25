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
// `model`, `argument-hint` and `disable-model-invocation` are as real as the rest: leaving them out
// reported a valid manifest as carrying an unknown key, which is a rule teaching a project to write a
// worse file.
const ALLOWED_KEYS: ReadonlySet<string> = new Set([
  'name',
  'description',
  'license',
  'allowed-tools',
  'argument-hint',
  'disable-model-invocation',
  'model',
  'metadata',
])
const KEBAB_CASE: RegExp = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const FRONTMATTER: RegExp = /^---\n([\s\S]*?)\n---/
const TOP_LEVEL_KEY: RegExp = /^([\w-]+):[ \t]?(.*)$/
// A folded or literal block scalar carries its text on the lines beneath the key, indented. Reading
// only the key's own line yielded ">-" as the description, which then failed every check below it -
// and a block scalar is simply how a description longer than one line is written.
const BLOCK_SCALAR: RegExp = /^[>|][-+]?\d*$/
const CONTINUATION: RegExp = /^\s+\S/
// The description must tell the agent WHEN to reach for the skill; a "when ..." clause is that signal.
// The word is not required to end there: "whenever the user asks" says exactly the same thing, and a
// trailing word boundary rejected the single most common way of phrasing it.
const WHEN_TO_USE: RegExp = /\bwhen/i

interface Frontmatter {
  readonly present: boolean
  readonly keys: ReadonlyMap<string, string>
  readonly keyNames: readonly string[]
}

// Parse only flat, top-level `key: value` lines (column 0). Indented lines under a nested key such as
// `metadata:` start with whitespace, fail TOP_LEVEL_KEY, and are ignored - so nesting is never flagged.
// How many of the lines after a block-scalar key belong to it: every indented one, up to the next key.
const continuationCount = (rest: readonly string[]): number => {
  const end: number = rest.findIndex((line: string): boolean => !CONTINUATION.test(line))
  return end === -1 ? rest.length : end
}

// A key's value, folded together with the indented lines beneath it when the value is a block scalar.
const valueAt = (lines: readonly string[], index: number, raw: string): string => {
  if (!BLOCK_SCALAR.test(raw)) {
    return raw
  }
  const rest: readonly string[] = lines.slice(index + 1)
  return rest
    .slice(0, continuationCount(rest))
    .map((line: string): string => line.trim())
    .join(' ')
}

const parseFrontmatter = (content: string): Frontmatter => {
  // Line endings are normalised first. The pattern below is written with `\n`, so a CRLF manifest
  // matched nothing at all and was reported as having no frontmatter - a message that sends the author
  // looking at the three dashes, which were never the problem.
  const match: RegExpExecArray | null = FRONTMATTER.exec(content.replaceAll('\r\n', '\n'))
  if (match === null) {
    return { present: false, keys: new Map<string, string>(), keyNames: [] }
  }
  const lines: readonly string[] = (match[1] ?? '').split('\n')
  const entries: readonly (readonly [string, string])[] = lines
    .map((line: string, index: number): readonly [RegExpExecArray | null, number] => [
      TOP_LEVEL_KEY.exec(line),
      index,
    ])
    .filter(
      (
        entry: readonly [RegExpExecArray | null, number],
      ): entry is readonly [RegExpExecArray, number] => entry[0] !== null,
    )
    .map((entry: readonly [RegExpExecArray, number]): readonly [string, string] => [
      entry[0][1] ?? '',
      valueAt(lines, entry[1], (entry[0][2] ?? '').trim()).trim(),
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
