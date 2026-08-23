// Pure commit-message logic, extracted from the check-commit-message.ts CLI entry so it can be unit- and
// coverage-tested without mocking git or the filesystem (the entry keeps all I/O). It enforces
// Conventional Commits headers, subject quality, the shared AI-typography ban, the AI-agent
// attribution ban (no co-author trailer, session id, or generated-by signature naming an agent), and a
// mandatory body explaining WHY for non-trivial changes (>2 files or >50 changed lines).
import { type AgentReferenceMatch, findAgentReferences } from './agent-references.js'
import { findTypographyViolations, type TypographyViolation } from './banned-typography.js'

const TYPES: readonly string[] = [
  'feat',
  'fix',
  'docs',
  'refactor',
  'perf',
  'test',
  'build',
  'ci',
  'chore',
  'revert',
]
const TYPES_LABEL: string = TYPES.join(', ')
const HEADER_PATTERN: RegExp =
  /^(?:feat|fix|docs|refactor|perf|test|build|ci|chore|revert)(?:\([a-z0-9-]+\))?: .+$/
const JUNK_DESCRIPTION: RegExp = /^(?:wip|fixup|misc|stuff|tmp|temp|updates?|changes?|asdf)\b/i
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
  const marker: number = header.indexOf(': ')
  return marker === -1 ? header : header.slice(marker + 2)
}

const validateHeaderFormat = (header: string): readonly string[] =>
  HEADER_PATTERN.test(header)
    ? []
    : [
        `invalid header "${header}": expected "<type>(<scope>): <description>", type one of ${TYPES_LABEL}`,
      ]

const validateSubjectQuality = (header: string): readonly string[] => {
  const description: string = descriptionOf(header)
  const problems: string[] = []
  if (header.length > MAX_HEADER_LENGTH) {
    problems.push(`header is ${header.length} chars; keep it at most ${MAX_HEADER_LENGTH}`)
  }
  if (header.endsWith('.')) {
    problems.push('header must not end with a period')
  }
  if (description.length < MIN_DESCRIPTION_LENGTH) {
    problems.push(
      `description "${description}" is too short; be specific (>= ${MIN_DESCRIPTION_LENGTH} chars)`,
    )
  }
  if (JUNK_DESCRIPTION.test(description)) {
    problems.push(`description "${description}" looks low-effort; describe the actual change`)
  }
  return problems
}

const validateBody = (body: string, requireBody: boolean): readonly string[] =>
  requireBody && body.length === 0
    ? [
        `change touches >${MAX_TRIVIAL_FILES} files or >${MAX_TRIVIAL_LINES} lines; add a body (blank line then prose) explaining WHY`,
      ]
    : []

const typographyProblems = (message: ParsedMessage): readonly string[] =>
  findTypographyViolations(`${message.header}\n${message.body}`).map(
    (found: TypographyViolation): string =>
      `banned ${found.label} (line ${found.line}); use ${found.replacement}`,
  )

const agentReferenceProblems = (message: ParsedMessage): readonly string[] =>
  findAgentReferences(`${message.header}\n${message.body}`).map(
    (found: AgentReferenceMatch): string =>
      `references an AI agent or its session (${found.label}, line ${found.line}); a commit must not attribute the change to an agent, so remove the trailer/signature`,
  )

/**
 * Validates a parsed commit message, returning a human-readable problem per rule violation. Every
 * commit is held to every rule: there is no exemption list, so a git-generated merge, revert, or
 * autosquash subject must be rewritten by hand to conform.
 * @param message the header/body pair from {@link parseMessage}.
 * @param requireBody whether the change is non-trivial and therefore must carry an explanatory body.
 * @returns an empty array when the message passes.
 */
export const validateMessage = (
  message: ParsedMessage,
  requireBody: boolean,
): readonly string[] => [
  ...validateHeaderFormat(message.header),
  ...validateSubjectQuality(message.header),
  ...validateBody(message.body, requireBody),
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
  let lines: number = 0
  for (const row of rows) {
    const [added, deleted] = row.split('\t', 2)
    lines += toCount(added) + toCount(deleted)
  }
  return { files: rows.length, lines }
}

/**
 * Decides whether a diff is large enough to require an explanatory commit body.
 * @param stat the file and line counts from {@link parseNumstat}.
 * @returns true when the change touches more than 2 files or more than 50 lines.
 */
export const isNonTrivial = (stat: DiffStat): boolean =>
  stat.files > MAX_TRIVIAL_FILES || stat.lines > MAX_TRIVIAL_LINES
