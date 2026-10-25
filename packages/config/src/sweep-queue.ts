// The queue the parts of a sweep pass share. Each part takes the next item no part has taken, so a part
// that meets slow items does not hold the pass while the others wait idle. An item is taken by creating
// a directory named by its index, which succeeds for exactly one part. The directory lives in the run's
// output directory, which every run starts empty.
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import path from 'node:path'

const isTakenAlready = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error as { readonly code?: unknown }).code === 'EEXIST'

const isTakenNow = (directory: string, index: number): boolean => {
  try {
    mkdirSync(path.join(directory, String(index)))
    return true
  } catch (error) {
    if (isTakenAlready(error)) {
      return false
    }
    throw error
  }
}

/**
 * Take the first item at or after `from` that no part has taken.
 * @param directory the pass's queue directory, which must exist.
 * @param count how many items the pass has.
 * @param from the index to start looking at.
 * @returns the index taken, or undefined when every item from there on is taken.
 */
export const takeNext = (directory: string, count: number, from: number): number | undefined => {
  if (from >= count) {
    return undefined
  }
  return isTakenNow(directory, from) ? from : takeNext(directory, count, from + 1)
}

/**
 * The first item at or after `from` that no part has taken, without taking it.
 * @param directory the pass's queue directory.
 * @param count how many items the pass has.
 * @param from the index to start looking at.
 * @returns its index, or undefined when every item from there on is taken.
 */
export const firstUntaken = (directory: string, count: number, from: number): number | undefined => {
  if (from >= count) {
    return undefined
  }
  return existsSync(path.join(directory, String(from))) ? firstUntaken(directory, count, from + 1) : from
}

/**
 * How many items of a pass no part has taken.
 * @param directory the pass's queue directory.
 * @param count how many items the pass has.
 * @returns the number not taken.
 */
export const untakenCount = (directory: string, count: number): number => count - readdirSync(directory).length
