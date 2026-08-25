// Run-log presentation. A verification prints one line per gate as it completes, then any failure
// findings or passing update report, so a long run is readable while it happens and actionable when it ends.
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

/** One completed gate, what it found, and how long it took. */
export interface GateOutcome {
  readonly gate: Gate
  readonly result: GateResult
  /** Wall-clock milliseconds, so a long run shows where the time actually went. */
  readonly durationMs: number
}

// The control sequence introducer, named rather than written as a bare number at its use.
const ESCAPE: number = 0x1b
const CSI: string = `${String.fromCodePoint(ESCAPE)}[`
const RESET: string = `${CSI}0m`
const BOLD: string = `${CSI}1m`
const DIM: string = `${CSI}2m`
const GREEN: string = `${CSI}32m`
const RED: string = `${CSI}31m`
const CLEAR_LINE: string = `\r${CSI}2K`

// Referenced by code point for the same reason the typography ban is: a source file that spells the
// character out invites a tool to normalise it into something the terminal renders differently.
const HEAVY_CHECK_MARK: number = 0x27_13
const BALLOT_X_MARK: number = 0x27_17
const CHECK_MARK: string = String.fromCodePoint(HEAVY_CHECK_MARK)
const BALLOT_X: string = String.fromCodePoint(BALLOT_X_MARK)

const SYMBOLS: Readonly<Record<string, string>> = {
  [PASS]: CHECK_MARK,
  [FAIL]: BALLOT_X,
}

const COLOURS: Readonly<Record<string, string>> = {
  [PASS]: GREEN,
  [FAIL]: RED,
}

// NO_COLOR and FORCE_COLOR are the conventions every other tool in the pipeline already honours, so a
// project that has set one does not have to set a ploaness-specific variable as well.
const hasRichOutput = (): boolean => {
  if (process.env['NO_COLOR'] !== undefined) {
    return false
  }
  if (process.env['FORCE_COLOR'] !== undefined) {
    return true
  }
  return process.env['TERM'] !== 'dumb' && process.stdout.isTTY
}

const IS_RICH: boolean = hasRichOutput()

// Overwriting a line in place needs a real terminal, which is a narrower condition than colour: a caller
// that sets FORCE_COLOR while piping wants the colours, and would otherwise collect a stray erase
// sequence at the head of every line.
const IS_INTERACTIVE: boolean = IS_RICH && process.stdout.isTTY

const write = (text: string): void => {
  process.stdout.write(text)
}

const line = (text: string): void => {
  write(`${text}\n`)
}

const paint = (text: string, colour: string): string =>
  IS_RICH ? `${colour}${text}${RESET}` : text

const verdictOf = (result: GateResult): string => (result.ok ? PASS : FAIL)

const MILLISECONDS_PER_SECOND: number = 1000

const elapsed = (milliseconds: number): string =>
  `${(milliseconds / MILLISECONDS_PER_SECOND).toFixed(1)}s`

// Below this width the right-hand column would collide with the summary, so the duration simply follows
// the text instead of being pushed to the margin.
const MINIMUM_COLUMNS: number = 80
const COLUMN_GAP: number = 2

/** Lay out a line with its duration at the right margin, falling back to a plain gap when narrow. */
const spread = (left: string, right: string, decoratedLeft: string): string => {
  const columns: number = process.stdout.columns
  const gap: number = columns - left.length - right.length
  if (!IS_RICH || columns < MINIMUM_COLUMNS || gap < COLUMN_GAP) {
    return `${decoratedLeft}${' '.repeat(COLUMN_GAP)}${paint(right, DIM)}`
  }
  return `${decoratedLeft}${' '.repeat(gap)}${paint(right, DIM)}`
}

/** Print the run header naming the mode and how many gates it covers. */
export const reportHeader = (isExtended: boolean, gateCount: number): void => {
  const mode: string = isExtended ? 'extended verification' : 'default verification'
  line('')
  line(`  ${paint('ploaness', BOLD)} ${paint(mode, DIM)}  ${String(gateCount)} gates`)
  line('')
}

/** Show that a gate has started, so a slow gate is visibly running rather than apparently hung. */
export const beginGate = (gate: Gate, width: number): void => {
  if (!IS_INTERACTIVE) {
    return
  }
  write(`  ${paint('.', DIM)} ${gate.id.padEnd(width)}  ${paint('running', DIM)}`)
}

// A gate prints its findings or update report where it ran, not at the end of the run. Extended
// verification is thirty-eight gates and several minutes; deferring the detail puts it minutes away from
// the line that announced it. The closing verdict still names every failed gate.
const reportGateFindings = (outcome: GateOutcome): void => {
  const verdict: string = verdictOf(outcome.result)
  if (outcome.result.findings.length === 0) {
    return
  }
  const heading: string = outcome.result.ok
    ? `${outcome.gate.id} - update report`
    : `${verdict}  ${outcome.gate.id} - ${outcome.gate.title}`
  const colour: string = outcome.result.ok ? DIM : (COLOURS[verdict] ?? RESET)
  line('')
  line(`  ${paint(heading, colour)}`)
  line(`  ${paint('-'.repeat(heading.length), DIM)}`)
  for (const finding of outcome.result.findings) {
    line(`  ${finding}`)
  }
  line('')
}

/** Print the one-line verdict for a gate that has just finished, and its findings when it did not pass. */
export const reportGate = (outcome: GateOutcome, width: number): void => {
  const verdict: string = verdictOf(outcome.result)
  const identifier: string = outcome.gate.id.padEnd(width)
  const marker: string = IS_RICH ? (SYMBOLS[verdict] ?? '?') : `[${verdict}]`
  const plain: string = `  ${marker} ${identifier}  ${outcome.result.summary}`
  const decorated: string = `  ${paint(marker, COLOURS[verdict] ?? RESET)} ${identifier}  ${outcome.result.summary}`
  if (IS_INTERACTIVE) {
    write(CLEAR_LINE)
  }
  line(spread(plain, elapsed(outcome.durationMs), decorated))
  reportGateFindings(outcome)
}

/**
 * Say why the run stopped, and how many gates it did not reach.
 *
 * Silence here would read as the run having finished, which is the one thing it did not do: the count
 * is what tells a reader that the gates below the failing one were not merely quiet.
 * @param gate the gate that failed.
 * @param skipped how many gates were not reached.
 * @param isPrecondition whether this gate stops a run in either mode, which is a different thing to
 *   say than that the run was enforcing.
 */
export const reportHalt = (gate: Gate, skipped: number, isPrecondition: boolean): void => {
  const headline: string = `halted at ${gate.id}: ${String(skipped)} gate(s) not run`
  const aside: string = isPrecondition
    ? `nothing below a failing ${gate.id} can be judged, so even a report-only run stops here`
    : 'repair the finding above and rerun; nothing below a failing gate has been verified'
  line('')
  line(`  ${paint(headline, COLOURS[FAIL] ?? RESET)}`)
  line(`  ${paint(aside, DIM)}`)
}

/** Print a closing aside, such as the reminder that one gate is not a verdict. */
export const reportNote = (text: string): void => {
  line('')
  line(`  ${paint(text, DIM)}`)
}

const tally = (outcomes: readonly GateOutcome[], verdict: string): number =>
  outcomes.filter((outcome: GateOutcome): boolean => verdictOf(outcome.result) === verdict).length

/** Print the closing verdict and return the process exit code. */
export const reportVerdict = (
  outcomes: readonly GateOutcome[],
  isExtended: boolean,
  isEnforced: boolean,
): number => {
  const failures: readonly GateOutcome[] = outcomes.filter(
    (outcome: GateOutcome): boolean => !outcome.result.ok,
  )
  const total: number = outcomes.reduce(
    (sum: number, outcome: GateOutcome): number => sum + outcome.durationMs,
    0,
  )
  const counts: string = [
    `${String(tally(outcomes, PASS))} passed`,
    `${String(failures.length)} failed`,
  ].join('  ')
  const mode: string = isExtended ? 'Extended verification' : 'Default verification'
  line('')
  line(spread(`  ${counts}`, elapsed(total), `  ${paint(counts, DIM)}`))
  if (failures.length === 0) {
    const passedText: string = `${mode} passed.`
    line(`  ${paint(passedText, GREEN)}`)
    return 0
  }
  const names: string = failures.map((outcome: GateOutcome): string => outcome.gate.id).join(', ')
  const failedText: string = `${mode} failed: ${names}.`
  line(`  ${paint(failedText, RED)}`)
  if (!isEnforced) {
    line(
      `  ${paint('Report-only mode is active, so the exit code is 0. This is not a pass.', DIM)}`,
    )
    return 0
  }
  return 1
}
