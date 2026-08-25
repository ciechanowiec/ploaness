// Shared AI-typography ban: characters a human rarely types but language models love, each mapped to
// the plain ASCII a human would actually write. One source of truth, consumed by both the file gate
// (`conventions`, in packages/cli/src/checks/conventions.ts) and the history gate (`commit-history`, in
// packages/cli/src/checks/history.ts). Every banned character is
// referenced via its code point only, so neither this module nor its callers trip the check on
// themselves.

interface BannedCharacter {
  readonly char: string
  readonly label: string
  readonly replacement: string
}

const STRAIGHT_DOUBLE_QUOTE: string = 'a straight double quote'
const PLAIN_HYPHEN: string = 'a hyphen "-"'

// The code points are named rather than written at each use, because a bare number in the table below
// would be exactly the unexplained literal the standard bans - and this module cannot spell the
// characters out, since its own source is scanned by the rule it implements.
const EM_DASH: number = 0x20_14
const EN_DASH: number = 0x20_13
const ELLIPSIS: number = 0x20_26
const LEFT_DOUBLE_QUOTE: number = 0x20_1c
const RIGHT_DOUBLE_QUOTE: number = 0x20_1d
const LOW_DOUBLE_QUOTE: number = 0x20_1e

const BANNED_CHARACTERS: readonly BannedCharacter[] = [
  { char: String.fromCodePoint(EM_DASH), label: 'em dash (U+2014)', replacement: PLAIN_HYPHEN },
  { char: String.fromCodePoint(EN_DASH), label: 'en dash (U+2013)', replacement: PLAIN_HYPHEN },
  {
    char: String.fromCodePoint(ELLIPSIS),
    label: 'ellipsis (U+2026)',
    replacement: 'three dots "..."',
  },
  {
    char: String.fromCodePoint(LEFT_DOUBLE_QUOTE),
    label: 'left double quote (U+201C)',
    replacement: STRAIGHT_DOUBLE_QUOTE,
  },
  {
    char: String.fromCodePoint(RIGHT_DOUBLE_QUOTE),
    label: 'right double quote (U+201D)',
    replacement: STRAIGHT_DOUBLE_QUOTE,
  },
  {
    char: String.fromCodePoint(LOW_DOUBLE_QUOTE),
    label: 'low double quote (U+201E)',
    replacement: STRAIGHT_DOUBLE_QUOTE,
  },
]

export interface TypographyViolation {
  readonly line: number
  readonly column: number
  readonly label: string
  readonly replacement: string
}

const violationsInLine = (line: string, lineNumber: number): readonly TypographyViolation[] =>
  BANNED_CHARACTERS.flatMap((banned: BannedCharacter): readonly TypographyViolation[] => {
    const column: number = line.indexOf(banned.char)
    return column === -1
      ? []
      : [
          {
            line: lineNumber,
            column: column + 1,
            label: banned.label,
            replacement: banned.replacement,
          },
        ]
  })

/**
 * Scans text for banned AI-typography, reporting 1-based line and column positions.
 * @param text the content to scan, with lines separated by "\n".
 * @returns one violation per banned character found, in reading order.
 */
export const findTypographyViolations = (text: string): readonly TypographyViolation[] =>
  text
    .split('\n')
    .flatMap((line: string, index: number): readonly TypographyViolation[] =>
      violationsInLine(line, index + 1),
    )
