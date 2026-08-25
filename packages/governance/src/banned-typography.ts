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

const BY_CHARACTER: ReadonlyMap<string, BannedCharacter> = new Map(
  BANNED_CHARACTERS.map((banned: BannedCharacter): readonly [string, BannedCharacter] => [
    banned.char,
    banned,
  ]),
)

// Every occurrence, at its own column, in the order it is read.
//
// This used to run `indexOf` once per banned character, which reported only the FIRST of each on a
// line - so a line with two em dashes produced one finding, and clearing a file took as many runs as
// it had repeats. Walking the line by code point fixes the count and the column together: `indexOf`
// returns a UTF-16 offset, so a column after an emoji named a position the editor does not have.
const violationsInLine = (line: string, lineNumber: number): readonly TypographyViolation[] =>
  // Code points are the unit wanted here: a banned character is one code point, and a column counted
  // in code units names a position no editor agrees with.
  // eslint-disable-next-line @typescript-eslint/no-misused-spread -- see the note above
  [...line].flatMap((character: string, index: number): readonly TypographyViolation[] => {
    const banned: BannedCharacter | undefined = BY_CHARACTER.get(character)
    return banned === undefined
      ? []
      : [
          {
            line: lineNumber,
            column: index + 1,
            label: banned.label,
            replacement: banned.replacement,
          },
        ]
  })

/**
 * Scans text for banned AI-typography, reporting 1-based line and column positions.
 * @param text the content to scan, with lines separated by "\n" or "\r\n".
 * @returns one violation per banned character found, in reading order.
 */
export const findTypographyViolations = (text: string): readonly TypographyViolation[] =>
  text
    .replaceAll('\r\n', '\n')
    .split('\n')
    .flatMap((line: string, index: number): readonly TypographyViolation[] =>
      violationsInLine(line, index + 1),
    )
