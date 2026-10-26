// How the parts of a sweep pass record and report their progress. Each part writes a line to the
// engine's progress log per item it finishes, which is how the log, unlike any one part, knows the whole
// pass; and the lines that speak for the whole pass are printed once between the parts, by whichever
// claims them first, so the e2e gate can stream them into the run log while the suite runs.
import { appendFileSync, readFileSync } from 'node:fs'
import {
  heartbeatSlot,
  type PassProgress,
  passFinishLine,
  passProgressLine,
  type Shard,
  type SweepPass,
} from '@ploaness/governance'
import { isClaimedFirst, untakenCount } from './sweep-queue.js'

const MS_PER_SECOND: number = 1000

/** What a part of a pass needs to record and report its progress. */
export interface PassLog {
  readonly pass: SweepPass
  readonly shard: Shard
  readonly engine: string
  readonly progressFile: string
  readonly queue: string
  readonly claims: string
  readonly startedAt: number
}

/**
 * Record an item this part has finished. Seconds since the part started, because the runner's own clock
 * is the shifted one; the parts of every pass in one engine append to one log, a line at a time.
 * @param log the part.
 * @param item what it finished.
 */
export const recordProgress = (log: PassLog, item: string): void => {
  const seconds: string = ((performance.now() - log.startedAt) / MS_PER_SECOND).toFixed(1)
  const part: string = `${String(log.shard.index + 1)}/${String(log.shard.count)}`
  appendFileSync(log.progressFile, `${log.pass} part ${part} ${seconds}s ${item}\n`)
}

const doneCount = (log: PassLog): number => {
  const prefix: string = `${log.pass} part `
  return readFileSync(log.progressFile, 'utf8')
    .split('\n')
    .filter((line: string): boolean => line.startsWith(prefix)).length
}

/**
 * Print where the whole pass stands, when this part is the first to reach the moment to say so: about
 * once a minute while it works, and once when its last item is done.
 * @param log the part.
 * @param total how many items the pass has.
 */
export const reportPass = (log: PassLog, total: number): void => {
  const done: number = doneCount(log)
  const elapsedMs: number = performance.now() - log.startedAt
  if (done >= total) {
    if (isClaimedFirst(log.claims, 'finished')) {
      console.info(passFinishLine(log.engine, log.pass, total, elapsedMs))
    }
    return
  }
  const slot: number = heartbeatSlot(performance.timeOrigin + performance.now())
  if (!isClaimedFirst(log.claims, `beat-${String(slot)}`)) {
    return
  }
  const progress: PassProgress = {
    engine: log.engine,
    pass: log.pass,
    total,
    done,
    waiting: untakenCount(log.queue, total),
    elapsedMs,
  }
  console.info(passProgressLine(progress))
}
