// What a running browser suite says about its progress, and which of its lines the run log shows live.
//
// A full sweep keeps one gate busy for hours, and a gate's report arrives only when it ends. On CI that
// left a log that stopped mid-run with no sign of whether the sweep was moving, and when an agent died
// it gave no clue how far the sweep had got. The suite's own result lines, and the lines each pass of
// the sweep prints as it starts, works and finishes, are what the run log streams as they are written.
// Everything else the suite prints, server logs included, stays in the gate's report.
import type { SweepPass } from './browser-run.js'

/** The prefix of every line the sweep prints about its own progress. */
export const SWEEP_PROGRESS_MARKER: string = '[ploaness-sweep]'

/** How often a working part of the sweep says how far it has got. */
export const HEARTBEAT_MS: number = 60_000

const MS_PER_SECOND: number = 1000
const SECONDS_PER_MINUTE: number = 60
const SECONDS_WIDTH: number = 2

// Playwright's list reporter: a result line per test, and the line that opens the run.
const TEST_RESULT: RegExp = /^\s*(?:[-x×✓✘]|ok)\s+\d+\s+\[/u
const RUN_OPENING: RegExp = /^\s*Running \d+ tests? using \d+ workers?/u

/**
 * Whether a line of the browser suite's output belongs in the live run log.
 * @param line one line the suite wrote.
 * @returns true for a test's result, the opening of the run, and the sweep's own progress.
 */
export const isProgressLine = (line: string): boolean =>
  line.includes(SWEEP_PROGRESS_MARKER) || TEST_RESULT.test(line) || RUN_OPENING.test(line)

// The passes in the order a Chromium run takes them; Firefox and WebKit run the engine pass alone.
const CHROMIUM_PASSES: readonly SweepPass[] = [
  'discovery',
  'resting',
  'interaction',
  'disclosures',
  'text-stress',
  'width-sweep',
  'dark-scheme',
]

const PERCENT: number = 100

/** Where a sweep pass stands, counted across all its parallel parts. */
export interface PassProgress {
  readonly engine: string
  readonly pass: SweepPass
  readonly total: number
  /** Items any part has finished. */
  readonly done: number
  /** Items no part has taken yet. */
  readonly waiting: number
  readonly elapsedMs: number
}

const duration = (ms: number): string => {
  const seconds: number = Math.floor(ms / MS_PER_SECOND)
  const minutes: number = Math.floor(seconds / SECONDS_PER_MINUTE)
  return minutes === 0
    ? `${String(seconds)}s`
    : `${String(minutes)}m ${String(seconds % SECONDS_PER_MINUTE).padStart(SECONDS_WIDTH, '0')}s`
}

// Which of an engine's passes this is, so a reader knows how much of the engine's work is behind it.
const headingOf = (engine: string, pass: SweepPass): string => {
  const index: number = CHROMIUM_PASSES.indexOf(pass)
  const position: string =
    index === -1 ? 'pass 1 of 1' : `pass ${String(index + 1)} of ${String(CHROMIUM_PASSES.length)}`
  return `${SWEEP_PROGRESS_MARKER} ${engine} ${pass} (${position})`
}

/**
 * The line a pass prints when it starts.
 * @param engine the browser engine.
 * @param pass the pass.
 * @param total how many items the pass has.
 * @param parts how many parts share them.
 * @returns the line.
 */
export const passStartLine = (engine: string, pass: SweepPass, total: number, parts: number): string =>
  `${headingOf(engine, pass)}: started, ${String(total)} items across ${String(parts)} parallel parts`

/**
 * The line a pass prints while it works: what is done, what is under way, what waits, and how long the
 * rest should take at the pace so far.
 * @param progress where the pass stands.
 * @returns the line.
 */
export const passProgressLine = (progress: PassProgress): string => {
  const { done, total, waiting, elapsedMs }: PassProgress = progress
  const working: number = Math.max(0, total - waiting - done)
  const share: number = total === 0 ? PERCENT : Math.floor((done / total) * PERCENT)
  const left: string =
    done === 0 ? 'estimating what is left' : `about ${duration((elapsedMs / done) * (total - done))} left`
  return (
    `${headingOf(progress.engine, progress.pass)}: ${String(done)}/${String(total)} done (${String(share)}%), ` +
    `${String(working)} in progress, ${String(waiting)} waiting · ${duration(elapsedMs)} elapsed, ${left}`
  )
}

/**
 * The line a pass prints when its last item is done.
 * @param engine the browser engine.
 * @param pass the pass.
 * @param total how many items it had.
 * @param elapsedMs how long it took.
 * @returns the line.
 */
export const passFinishLine = (engine: string, pass: SweepPass, total: number, elapsedMs: number): string =>
  `${headingOf(engine, pass)}: finished ${String(total)} items in ${duration(elapsedMs)}`

/**
 * The interval a moment falls in, which the parts of a pass compete to report once.
 * @param epochMs the moment, by the real clock.
 * @returns the interval's number.
 */
export const heartbeatSlot = (epochMs: number): number => Math.floor(epochMs / HEARTBEAT_MS)
