// Orphaned documenting comments: a `/** ... */` block whose next non-blank line opens ANOTHER such
// block, so the first documents nothing and the symbol it was written for carries no doc at all.
//
// This cannot be an eslint-plugin-jsdoc rule, and the reason is structural rather than a gap in that
// plugin. Every rule it ships visits the block ATTACHED to a syntax node, and an orphan is attached to
// nothing: the parser hands a declaration only the LAST block comment before it and discards the
// earlier ones as leading trivia. The defect is invisible to the one analyzer that exists for
// documenting comments, which is why it is a text rule here - the text is the only place it is still
// visible.
//
// It is a real class rather than a hypothetical. Four instances were found in this repository the
// first time anything looked, each one a doc that had been moved above the wrong symbol and left
// there, and each one carried the description of a symbol that was then undocumented.

// Extensions whose comment syntax this rule understands. A stylesheet shares the delimiters but has
// no JSDoc, so two adjacent blocks there are two comments rather than one orphan - which is why this
// list is narrower than CODE_EXTENSIONS.
export const DOCUMENTED_EXTENSIONS: readonly string[] = [
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.mjs',
  '.cjs',
]

const DOC_OPEN: string = '/**'
const BLOCK_CLOSE: string = '*/'

/** The sentinel for "no block is currently open", distinguishable from every 1-based line number. */
const NO_OPEN_BLOCK: number = -1

/** Array indices are 0-based and reported line numbers are 1-based. */
const FIRST_LINE: number = 1

/** The span of one documenting comment, as 1-based inclusive line numbers. */
export interface DocBlock {
  readonly line: number
  readonly endLine: number
}

interface ScanState {
  readonly open: number
  readonly blocks: readonly DocBlock[]
}

const EMPTY_SCAN: ScanState = { open: NO_OPEN_BLOCK, blocks: [] }

// A block that opens and closes on one line, which is the shape most one-sentence docs take. The
// search starts past the opening marker so its own trailing asterisk cannot be read as the close.
const endsOnOpeningLine = (trimmed: string): boolean =>
  trimmed.slice(DOC_OPEN.length).includes(BLOCK_CLOSE)

const afterOpenLine = (state: ScanState, trimmed: string, line: number): ScanState => {
  if (!trimmed.startsWith(DOC_OPEN)) {
    return state
  }
  return endsOnOpeningLine(trimmed)
    ? { open: NO_OPEN_BLOCK, blocks: [...state.blocks, { line, endLine: line }] }
    : { open: line, blocks: state.blocks }
}

const afterBodyLine = (state: ScanState, trimmed: string, line: number): ScanState =>
  trimmed.includes(BLOCK_CLOSE)
    ? { open: NO_OPEN_BLOCK, blocks: [...state.blocks, { line: state.open, endLine: line }] }
    : state

// Every documenting comment in the file, in reading order. Only blocks opened by `/**` at the start of
// a line are collected: a `/**` inside a string or trailing another statement is not a doc block, and
// treating it as one would report a defect at a position that holds none.
const docBlocks = (lines: readonly string[]): readonly DocBlock[] =>
  lines.reduce((state: ScanState, raw: string, index: number): ScanState => {
    const trimmed: string = raw.trim()
    const line: number = index + FIRST_LINE
    return state.open === NO_OPEN_BLOCK
      ? afterOpenLine(state, trimmed, line)
      : afterBodyLine(state, trimmed, line)
  }, EMPTY_SCAN).blocks

// Blank lines are skipped rather than treated as separation. A doc block separated from the next doc
// block by an empty line is orphaned exactly as tightly as one that is not: what makes it an orphan is
// that no declaration follows it, and whitespace is not a declaration.
const opensAnotherBlock = (lines: readonly string[], endLine: number): boolean => {
  const next: string | undefined = lines
    .slice(endLine)
    .find((line: string): boolean => line.trim().length > 0)
  return (next ?? '').trimStart().startsWith(DOC_OPEN)
}

/**
 * Find every documenting comment that is followed by another one rather than by what it documents.
 * @param text the file contents, with lines separated by "\n" or "\r\n".
 * @returns one entry per orphaned block, in reading order.
 */
export const findOrphanedDocBlocks = (text: string): readonly DocBlock[] => {
  const lines: readonly string[] = text.replaceAll('\r\n', '\n').split('\n')
  return docBlocks(lines).filter((block: DocBlock): boolean =>
    opensAnotherBlock(lines, block.endLine),
  )
}
