import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { firstUntaken, takeNext, untakenCount } from '../src/sweep-queue.js'

const inQueue = (run: (queue: string) => void): void => {
  const queue: string = mkdtempSync(path.join(tmpdir(), 'ploaness-sweep-queue-'))
  try {
    run(queue)
  } finally {
    rmSync(queue, { recursive: true, force: true })
  }
}

describe('the queue the parts of a sweep pass share', () => {
  it('gives each item to exactly one part, and a part that is held up leaves the rest to the others', () => {
    inQueue((queue: string): void => {
      const slow: number | undefined = takeNext(queue, 5, 0)
      const fast: readonly (number | undefined)[] = [
        takeNext(queue, 5, 0),
        takeNext(queue, 5, 2),
        takeNext(queue, 5, 3),
        takeNext(queue, 5, 4),
        takeNext(queue, 5, 5),
      ]
      expect([slow, ...fast]).toEqual([0, 1, 2, 3, 4, undefined])
      expect(takeNext(queue, 5, 0)).toBeUndefined()
    })
  })

  it('names the first untaken item without taking it, and counts the untaken ones', () => {
    inQueue((queue: string): void => {
      takeNext(queue, 4, 0)
      takeNext(queue, 4, 2)
      expect([firstUntaken(queue, 4, 0), firstUntaken(queue, 4, 0), untakenCount(queue, 4)]).toEqual([1, 1, 2])
      expect(firstUntaken(queue, 4, 3)).toBe(3)
      takeNext(queue, 4, 0)
      takeNext(queue, 4, 0)
      expect([firstUntaken(queue, 4, 0), untakenCount(queue, 4)]).toEqual([undefined, 0])
    })
  })
})
