// Pure commit-message logic, extracted from the check-commit-message.ts CLI entry so it can be unit- and
// coverage-tested without mocking git or the filesystem (the entry keeps all I/O). It enforces
// Conventional Commits headers, subject quality, the shared AI-typography ban, the AI-agent
// attribution ban (no co-author trailer, session id, or generated-by signature naming an agent), and a
// mandatory body explaining WHY for non-trivial changes (>2 files or >50 changed lines).
import { type AgentReferenceMatch, findAgentReferences } from './agent-references.js'
import { findTypographyViolations, type TypographyViolation } from './banned-typography.js'

// The governing standard's own list, in its own order. `revert` is deliberately absent: git writes a
// revert commit with a `Revert "..."` subject, and the standard requires that subject be replaced by a
// conforming one by hand rather than given a type of its own.
const TYPES: readonly string[] = [
  'build',
  'chore',
  'ci',
  'docs',
  'feat',
  'fix',
  'perf',
  'refactor',
  'test',
]
const TYPES_LABEL: string = TYPES.join(', ')
// Built from TYPES rather than written out again. The two were separate literals, and they drifted:
// the alternation is what actually decided a verdict, so a type removed from the list above stayed
// accepted here. A pattern derived from the list cannot disagree with it.
const HEADER_PATTERN: RegExp = new RegExp(
  String.raw`^(?:${TYPES.join('|')})(?:\([a-z0-9-]+\))?: .+$`,
)
// The standard says the subject "contains none of these words", so the match is unanchored. It was
// anchored to the first word, which accepted `fix: clear the tmp directory` - a subject the standard
// rejects. The list is the standard's own; `update` and `change` are not on it and are not added,
// because unanchored they would reject a legitimate `chore(deps): update the pinned biome version`.
const JUNK_DESCRIPTION: RegExp = /\b(?:wip|tmp|temp|misc|stuff|asdf|fixup)\b/i
// What separates the type (and optional scope) from the subject.
const HEADER_SEPARATOR: string = ': '
// A numstat row reports added and deleted counts before the path.
const NUMSTAT_COLUMNS: number = 2
const MAX_HEADER_LENGTH: number = 72
const MIN_DESCRIPTION_LENGTH: number = 15
const MAX_TRIVIAL_FILES: number = 2
const MAX_TRIVIAL_LINES: number = 50
const SCISSORS: string = '# ------------------------ >8 ------------------------'

export interface ParsedMessage {
  readonly header: string
  readonly body: string
}

export interface DiffStat {
  readonly files: number
  readonly lines: number
}

/**
 * Splits a raw commit message into header and body, dropping git comment lines and any verbose-diff
 * section below the scissors marker.
 * @param raw the full commit-message file contents.
 * @returns the first non-blank line as `header` and the remaining prose as `body` (both may be empty).
 */
export const parseMessage = (raw: string): ParsedMessage => {
  const lines: readonly string[] = (raw.split(SCISSORS)[0] ?? '')
    .split('\n')
    .filter((line: string): boolean => !line.startsWith('#'))
  const headerIndex: number = lines.findIndex((line: string): boolean => line.trim().length > 0)
  if (headerIndex === -1) {
    return { header: '', body: '' }
  }
  return {
    header: lines[headerIndex] ?? '',
    body: lines
      .slice(headerIndex + 1)
      .join('\n')
      .trim(),
  }
}

const descriptionOf = (header: string): string => {
  const marker: number = header.indexOf(HEADER_SEPARATOR)
  return marker === -1 ? header : header.slice(marker + HEADER_SEPARATOR.length)
}

const validateHeaderFormat = (header: string): readonly string[] =>
  HEADER_PATTERN.test(header)
    ? []
    : [
        `invalid header "${header}": expected "<type>(<scope>): <description>", type one of ${TYPES_LABEL}`,
      ]

// One predicate per rule, each returning the problem it found or nothing. The alternative - pushing
// into a mutable list - reads the same but hides how many rules there are behind a wall of ifs.
type SubjectRule = (header: string, description: string) => string | undefined

const SUBJECT_RULES: readonly SubjectRule[] = [
  (header: string): string | undefined =>
    header.length > MAX_HEADER_LENGTH
      ? `header is ${String(header.length)} chars; keep it at most ${String(MAX_HEADER_LENGTH)}`
      : undefined,
  (header: string): string | undefined =>
    header.endsWith('.') ? 'header must not end with a period' : undefined,
  (_header: string, description: string): string | undefined =>
    description.length < MIN_DESCRIPTION_LENGTH
      ? `description "${description}" is too short; be specific (>= ${String(MIN_DESCRIPTION_LENGTH)} chars)`
      : undefined,
  (_header: string, description: string): string | undefined =>
    JUNK_DESCRIPTION.test(description)
      ? `description "${description}" looks low-effort; describe the actual change`
      : undefined,
]

const validateSubjectQuality = (header: string): readonly string[] => {
  const description: string = descriptionOf(header)
  return SUBJECT_RULES.flatMap((rule: SubjectRule): readonly string[] => {
    const problem: string | undefined = rule(header, description)
    return problem === undefined ? [] : [problem]
  })
}

const validateBody = (body: string, isBodyRequired: boolean): readonly string[] =>
  isBodyRequired && body.length === 0
    ? [
        `change touches >${String(MAX_TRIVIAL_FILES)} files or >${String(MAX_TRIVIAL_LINES)} lines; ` +
          'add a body (blank line then prose) explaining WHY',
      ]
    : []

const typographyProblems = (message: ParsedMessage): readonly string[] =>
  findTypographyViolations(`${message.header}\n${message.body}`).map(
    (found: TypographyViolation): string =>
      `banned ${found.label} (line ${String(found.line)}); use ${found.replacement}`,
  )

const agentReferenceProblems = (message: ParsedMessage): readonly string[] =>
  findAgentReferences(`${message.header}\n${message.body}`).map(
    (found: AgentReferenceMatch): string =>
      `references an AI agent or its session (${found.label}, line ${String(found.line)}); a commit must ` +
      'not attribute the change to an agent, so remove the trailer/signature',
  )

/**
 * Validates a parsed commit message, returning a human-readable problem per rule violation. Every
 * commit is held to every rule: there is no exemption list, so a git-generated merge, revert, or
 * autosquash subject must be rewritten by hand to conform.
 * @param message the header/body pair from {@link parseMessage}.
 * @param isBodyRequired whether the change is non-trivial and therefore must carry an explanatory body.
 * @returns an empty array when the message passes.
 */
export const validateMessage = (
  message: ParsedMessage,
  isBodyRequired: boolean,
): readonly string[] => [
  ...validateHeaderFormat(message.header),
  ...validateSubjectQuality(message.header),
  ...validateBody(message.body, isBodyRequired),
  ...typographyProblems(message),
  ...agentReferenceProblems(message),
]

const toCount = (raw: string | undefined): number => {
  const parsed: number = Number(raw)
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * Parses `git --numstat` output into a file count and a total changed-line count.
 * @param numstat the raw stdout of a `--numstat` diff (tab-separated added/deleted/path rows).
 * @returns the number of changed files and the sum of added plus deleted lines (binary rows count 0).
 */
export const parseNumstat = (numstat: string): DiffStat => {
  const rows: readonly string[] = numstat
    .split('\n')
    .filter((row: string): boolean => row.length > 0)
  const lines: number = rows.reduce((total: number, row: string): number => {
    const [added, deleted] = row.split('\t', NUMSTAT_COLUMNS)
    return total + toCount(added) + toCount(deleted)
  }, 0)
  return { files: rows.length, lines }
}

/**
 * Decides whether a diff is large enough to require an explanatory commit body.
 * @param stat the file and line counts from {@link parseNumstat}.
 * @returns true when the change touches more than 2 files or more than 50 lines.
 */
export const isNonTrivial = (stat: DiffStat): boolean =>
  stat.files > MAX_TRIVIAL_FILES || stat.lines > MAX_TRIVIAL_LINES
