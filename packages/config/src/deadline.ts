// A limit on how long a step of the sweep may keep its caller waiting.
//
// A visit can wait on a browser that never answers - an axe run that never returns in one engine - and
// nothing below it bounds that wait, so the part waited out its whole budget and then failed without
// naming the page. A step given a limit hands its caller nothing once the limit passes, and the caller
// reports the page and moves on. The step itself is left to end on its own: the next visit navigates
// the page away, which ends whatever was still waiting on it.
import { setTimeout as sleep } from 'node:timers/promises'

// Resolves once the limit passes, or quietly when the wait is called off because the work finished.
const expiry = async (limitMs: number, signal: AbortSignal): Promise<undefined> => {
  try {
    await sleep(limitMs, undefined, { signal })
  } catch {
    // Called off: the work finished first, and the race has already been decided.
  }
  return undefined
}

/**
 * Wait for some work, but no longer than a limit.
 * @param work the work.
 * @param limitMs how long to wait for it.
 * @returns its result, or undefined when the limit passed first; a failure of the work is its own.
 */
export const withinLimit = async <Result>(work: Promise<Result>, limitMs: number): Promise<Result | undefined> => {
  const timer: AbortController = new AbortController()
  try {
    return await Promise.race([work, expiry(limitMs, timer.signal)])
  } finally {
    timer.abort()
  }
}
