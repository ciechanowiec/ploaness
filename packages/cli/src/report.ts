// Run-log presentation. A verification prints one line per gate as it completes, then the findings of
// every gate that failed, so a long run is readable while it happens and actionable when it ends.
//
// Every line goes to stdout, failures included. The run log is this command's product, and a caller that
// redirects stdout alone must not receive a list of passing gates while each failure leaves on the other
// stream. The exit code, not the stream, carries the verdict.
//
// There are two formats, chosen by whether stdout is a terminal. A terminal gets colour, a symbol per
// verdict, and a placeholder line that is overwritten when the gate finishes, so a slow gate cannot be
// mistaken for a hung one. Everything else - a pipe, a file, CI, an agent reading the log - gets plain
// ASCII whose "[PASS] <id>" token stays greppable and carries no escape sequence to strip.

import type { GateResult } from './exec.js'
import type { Gate } from './gates.js'

const PASS: string = 'PASS'
const FAIL: string = 'FAIL'
const WARN: string = 'WARN'

/** One completed gate, what it found, and how long it took. */
export interface GateOutcome {
  readonly gate: Gate
  readonly result: GateResult
  /** Wall-clock milliseconds, so a long run shows where the time actually went. */
  readonly durationMs: number
}

const CSI: string = `${String.fromCodePoint(0x1b)}[`
const RESET: string = `${CSI}0m`
const BOLD: string = `${CSI}1m`
const DIM: string = `${CSI}2m`
const GREEN: string = `${CSI}32m`
const RED: string = `${CSI}31m`
const YELLOW: string = `${CSI}33m`
const CLEAR_LINE: string = `\r${CSI}2K`

// Referenced by code point for the same reason the typography ban is: a source file that spells the
// character out invites a tool to normalise it into something the terminal renders differently.
const CHECK_MARK: string = String.fromCodePoint(0x2713)
const BALLOT_X: string = String.fromCodePoint(0x2717)

const SYMBOLS: Readonly<Record<string, string>> = {
  [PASS]: CHECK_MARK,
  [FAIL]: BALLOT_X,
  [WARN]: '!',
}

const COLOURS: Readonly<Record<string, string>> = {
  [PASS]: GREEN,
  [FAIL]: RED,
  [WARN]: YELLOW,
}

// NO_COLOR and FORCE_COLOR are the conventions every other tool in the pipeline already honours, so a
// project that has set one does not have to set a ploaness-specific variable as well.
// Read by destructuring rather than by key: the shipped tsconfig forbids dot access on an index
// signature, and the shipped Biome config rewrites a literal key into dot access. Destructuring is the
// one form both accept.
const richOutput = (): boolean => {
  const { NO_COLOR: noColour, FORCE_COLOR: forceColour, TERM: term } = process.env
  if (noColour !== undefined) {
    return false
  }
  if (forceColour !== undefined) {
    return true
  }
  return term !== 'dumb' && process.stdout.isTTY === true
}

const RICH: boolean = richOutput()

// Overwriting a line in place needs a real terminal, which is a narrower condition than colour: a caller
// that sets FORCE_COLOR while piping wants the colours, and would otherwise collect a stray erase
// sequence at the head of every line.
const INTERACTIVE: boolean = RICH && process.stdout.isTTY === true

const write = (text: string): void => {
  process.stdout.write(text)
}

const line = (text: string): void => {
  write(`${text}\n`)
}

const paint = (text: string, colour: string): string => (RICH ? `${colour}${text}${RESET}` : text)

const verdictOf = (result: GateResult): string => {
  if (!result.ok) {
    return FAIL
  }
  return result.findings.length > 0 ? WARN : PASS
}

const MILLISECONDS_PER_SECOND: number = 1000

const elapsed = (milliseconds: number): string =>
  `${(milliseconds / MILLISECONDS_PER_SECOND).toFixed(1)}s`

// Below this width the right-hand column would collide with the summary, so the duration simply follows
// the text instead of being pushed to the margin.
const MINIMUM_COLUMNS: number = 80
const COLUMN_GAP: number = 2

/** Lay out a line with its duration at the right margin, falling back to a plain gap when narrow. */
const spread = (left: string, right: string, decoratedLeft: string): string => {
  const columns: number = process.stdout.columns ?? 0
  const gap: number = columns - left.length - right.length
  if (!RICH || columns < MINIMUM_COLUMNS || gap < COLUMN_GAP) {
    return `${decoratedLeft}${' '.repeat(COLUMN_GAP)}${paint(right, DIM)}`
  }
  return `${decoratedLeft}${' '.repeat(gap)}${paint(right, DIM)}`
}

/** Print the run header naming the mode and how many gates it covers. */
export const reportHeader = (extended: boolean, gateCount: number): void => {
  const mode: string = extended ? 'extended verification' : 'default verification'
  line('')
  line(`  ${paint('ploaness', BOLD)} ${paint(mode, DIM)}  ${gateCount} gates`)
  line('')
}

/** Show that a gate has started, so a slow gate is visibly running rather than apparently hung. */
export const beginGate = (gate: Gate, width: number): void => {
  if (!INTERACTIVE) {
    return
  }
  write(`  ${paint('.', DIM)} ${gate.id.padEnd(width)}  ${paint('running', DIM)}`)
}

/** Print the one-line verdict for a gate that has just finished. */
export const reportGate = (outcome: GateOutcome, width: number): void => {
  const verdict: string = verdictOf(outcome.result)
  const identifier: string = outcome.gate.id.padEnd(width)
  const marker: string = RICH ? (SYMBOLS[verdict] ?? '?') : `[${verdict}]`
  const plain: string = `  ${marker} ${identifier}  ${outcome.result.summary}`
  const decorated: string = `  ${paint(marker, COLOURS[verdict] ?? RESET)} ${identifier}  ${outcome.result.summary}`
  if (INTERACTIVE) {
    write(CLEAR_LINE)
  }
  line(spread(plain, elapsed(outcome.durationMs), decorated))
}

/** Print a closing aside, such as the reminder that one gate is not a verdict. */
export const reportNote = (text: string): void => {
  line('')
  line(`  ${paint(text, DIM)}`)
}

/** Print the findings of every gate that failed, plus any warnings a passing gate raised. */
export const reportFindings = (outcomes: readonly GateOutcome[]): void => {
  for (const outcome of outcomes) {
    const verdict: string = verdictOf(outcome.result)
    if (verdict === PASS) {
      continue
    }
    const heading: string = `${verdict}  ${outcome.gate.id} - ${outcome.gate.title}`
    line('')
    line(`  ${paint(heading, COLOURS[verdict] ?? RESET)}`)
    line(`  ${paint('-'.repeat(heading.length), DIM)}`)
    for (const finding of outcome.result.findings) {
      line(`  ${finding}`)
    }
  }
}

const tally = (outcomes: readonly GateOutcome[], verdict: string): number =>
  outcomes.filter((outcome: GateOutcome): boolean => verdictOf(outcome.result) === verdict).length

/** Print the closing verdict and return the process exit code. */
export const reportVerdict = (
  outcomes: readonly GateOutcome[],
  extended: boolean,
  enforce: boolean,
): number => {
  const failures: readonly GateOutcome[] = outcomes.filter(
    (outcome: GateOutcome): boolean => !outcome.result.ok,
  )
  const total: number = outcomes.reduce(
    (sum: number, outcome: GateOutcome): number => sum + outcome.durationMs,
    0,
  )
  const counts: string = [
    `${tally(outcomes, PASS)} passed`,
    `${tally(outcomes, WARN)} warned`,
    `${failures.length} failed`,
  ].join('  ')
  const mode: string = extended ? 'Extended verification' : 'Default verification'
  line('')
  line(spread(`  ${counts}`, elapsed(total), `  ${paint(counts, DIM)}`))
  if (failures.length === 0) {
    line(`  ${paint(`${mode} passed.`, GREEN)}`)
    return 0
  }
  const names: string = failures.map((outcome: GateOutcome): string => outcome.gate.id).join(', ')
  line(`  ${paint(`${mode} failed: ${names}.`, RED)}`)
  if (!enforce) {
    line(
      `  ${paint('Report-only mode is active, so the exit code is 0. This is not a pass.', DIM)}`,
    )
    return 0
  }
  return 1
}
