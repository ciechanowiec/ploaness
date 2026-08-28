import { once } from 'node:events'
import { describe, expect, it } from 'vitest'
import {
  mapWithConcurrency,
  NETWORKED_TOOL_TIMEOUT_MS,
  REGISTRY_CONCURRENCY,
  REQUEST_TIMEOUT_MS,
} from '../src/request-limits.js'

// Occupancy is observed through gates rather than through a counter, because a spec is held to the same
// no-mutation rule the source is and a counter is mutation by definition. Each item announces its start
// by firing one signal and then blocks on another the test holds, so "item three has not begun" is a
// promise that has not settled - decidable without anything being written down.
//
// Built on `AbortController` rather than on a captured `resolve`, for the same reason: capturing a
// resolver out of a promise executor is an assignment, and `Promise.withResolvers` is newer than the
// `lib` target this repository compiles against.
interface Gate {
  readonly begun: Promise<unknown>
  readonly announce: () => void
  readonly release: () => void
  readonly held: Promise<unknown>
}

const gate = (): Gate => {
  const started: AbortController = new AbortController()
  const blocked: AbortController = new AbortController()
  return {
    begun: once(started.signal, 'abort'),
    announce: (): void => {
      started.abort()
    },
    release: (): void => {
      blocked.abort()
    },
    held: once(blocked.signal, 'abort'),
  }
}

const NOT_YET: unique symbol = Symbol('not yet')

/** Whether a promise is still pending after the microtask queue and a timer tick have both drained. */
const isPending = async (subject: Promise<unknown>): Promise<boolean> => {
  const tick: Promise<typeof NOT_YET> = new Promise<typeof NOT_YET>(
    (resolve: (value: typeof NOT_YET) => void): void => {
      setTimeout((): void => {
        resolve(NOT_YET)
      }, 1)
    },
  )
  return (await Promise.race([subject, tick])) === NOT_YET
}

const gates = (count: number): readonly Gate[] => Array.from({ length: count }, (): Gate => gate())

describe('mapWithConcurrency', (): void => {
  it('neverStartsMoreThanTheLimitAtOnce', async (): Promise<void> => {
    const open: readonly Gate[] = gates(4)
    const running: Promise<readonly number[]> = mapWithConcurrency(
      [0, 1, 2, 3],
      2,
      async (item: number): Promise<number> => {
        open[item]?.announce()
        await open[item]?.held
        return item
      },
    )
    await Promise.all([open[0]?.begun, open[1]?.begun])
    // The whole assertion: with the window full, the third item must not have been reached.
    expect(await isPending(open[2]?.begun ?? Promise.resolve())).toBe(true)
    for (const entry of open) {
      entry.release()
    }
    expect(await running).toStrictEqual([0, 1, 2, 3])
  })

  it('startsTheNextItemOnceTheWindowClears', async (): Promise<void> => {
    const open: readonly Gate[] = gates(3)
    const running: Promise<readonly number[]> = mapWithConcurrency(
      [0, 1, 2],
      2,
      async (item: number): Promise<number> => {
        open[item]?.announce()
        await open[item]?.held
        return item
      },
    )
    open[0]?.release()
    open[1]?.release()
    await open[2]?.begun
    open[2]?.release()
    expect(await running).toStrictEqual([0, 1, 2])
  })
})

describe('mapWithConcurrency edge cases', (): void => {
  it('returnsResultsInTheOrderOfTheInputRatherThanOfCompletion', async (): Promise<void> => {
    const slowest: number = 1
    const doubled: readonly number[] = await mapWithConcurrency(
      [1, 2, 3, 4, 5, 6, 7],
      3,
      async (item: number): Promise<number> => {
        await new Promise<void>((resolve: () => void): void => {
          setTimeout(resolve, item === slowest ? 5 : 0)
        })
        return item * 2
      },
    )
    expect(doubled).toStrictEqual([2, 4, 6, 8, 10, 12, 14])
  })

  it('treatsALimitBelowOneAsOneRatherThanStalling', async (): Promise<void> => {
    const open: readonly Gate[] = gates(2)
    const running: Promise<readonly string[]> = mapWithConcurrency(
      ['a', 'b'],
      0,
      async (item: string): Promise<string> => {
        const index: number = item === 'a' ? 0 : 1
        open[index]?.announce()
        await open[index]?.held
        return item
      },
    )
    await open[0]?.begun
    expect(await isPending(open[1]?.begun ?? Promise.resolve())).toBe(true)
    open[0]?.release()
    open[1]?.release()
    expect(await running).toStrictEqual(['a', 'b'])
  })

  it('doesNothingForAnEmptyList', async (): Promise<void> => {
    const done: readonly never[] = await mapWithConcurrency([], REGISTRY_CONCURRENCY, () => {
      throw new Error('work must not run for an empty list')
    })
    expect(done).toStrictEqual([])
  })

  it('propagatesTheFailureOfAnyItem', async (): Promise<void> => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, (item: number): Promise<number> => {
        return item === 3 ? Promise.reject(new Error('registry refused')) : Promise.resolve(item)
      }),
    ).rejects.toThrow('registry refused')
  })
})

describe('the declared bounds', (): void => {
  // The joint, not the value: a tool that makes many requests must outlive one request, or the harness
  // kills it mid-question and reports its own impatience as an unreachable database.
  it('givesANetworkedToolLongerThanASingleRequest', (): void => {
    expect(NETWORKED_TOOL_TIMEOUT_MS).toBeGreaterThan(REQUEST_TIMEOUT_MS)
  })

  it('keepsTheRegistryWindowNarrowEnoughToAvoidRateLimiting', (): void => {
    const widestThatIsStillPolite: number = 16
    expect(REGISTRY_CONCURRENCY).toBeGreaterThanOrEqual(1)
    expect(REGISTRY_CONCURRENCY).toBeLessThanOrEqual(widestThatIsStillPolite)
  })
})
