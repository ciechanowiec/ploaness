// What a running browser suite says about its progress, and which of its lines the run log shows live.
//
// A full sweep keeps one gate busy for hours, and a gate's report arrives only when it ends. On CI that
// left a log that stopped mid-run with no sign of whether the sweep was moving, and when an agent died
// it gave no clue how far the sweep had got. The suite's own result lines, and a heartbeat each part of
// the sweep prints while it works, are the lines the run log streams as they are written. Everything
// else the suite prints, server logs included, stays in the gate's report.
import type { Shard } from './browser-run.js'

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

/** Where a part of a sweep pass stands. */
export interface SweepProgress {
  readonly pass: string
  readonly engine: string
  readonly shard: Shard
  /** Items this part has visited. */
  readonly visited: number
  /** Items of the whole pass that no part has taken yet. */
  readonly untaken: number
  readonly total: number
  readonly elapsedMs: number
}

const elapsed = (ms: number): string => {
  const seconds: number = Math.floor(ms / MS_PER_SECOND)
  const minutes: number = Math.floor(seconds / SECONDS_PER_MINUTE)
  return minutes === 0
    ? `${String(seconds)}s`
    : `${String(minutes)}m ${String(seconds % SECONDS_PER_MINUTE).padStart(SECONDS_WIDTH, '0')}s`
}

const partOf = (progress: Pick<SweepProgress, 'engine' | 'pass' | 'shard'>): string =>
  `${SWEEP_PROGRESS_MARKER} ${progress.pass} (${progress.engine}) part ${String(progress.shard.index + 1)} of ` +
  String(progress.shard.count)

/**
 * The line a part prints when it starts.
 * @param progress the part, and how many items its pass has.
 * @returns the line.
 */
export const sweepStartLine = (progress: Pick<SweepProgress, 'engine' | 'pass' | 'shard' | 'total'>): string =>
  `${partOf(progress)}: started, ${String(progress.total)} items in the pass`

/**
 * The line a part prints while it works.
 * @param progress where the part stands.
 * @returns the line.
 */
export const sweepProgressLine = (progress: SweepProgress): string =>
  `${partOf(progress)}: ${String(progress.visited)} visited here, ${String(progress.untaken)} of ` +
  `${String(progress.total)} not yet taken, ${elapsed(progress.elapsedMs)}`

/**
 * Whether a part has been quiet long enough to say how far it has got.
 * @param lastMs when it last said so, or started.
 * @param nowMs now.
 * @returns true once a heartbeat interval has passed.
 */
export const isHeartbeatDue = (lastMs: number, nowMs: number): boolean => nowMs - lastMs >= HEARTBEAT_MS
