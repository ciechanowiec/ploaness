import { describe, expect, it } from 'vitest'
import { withinLimit } from '../src/deadline.js'

const LIMIT_MS: number = 50
const LONG_AFTER_MS: number = 2000

const after = async <Result>(ms: number, result: Result): Promise<Result> =>
  await new Promise<Result>((resolve): void => {
    setTimeout(resolve, ms, result)
  })

describe('a limit on how long a step may keep its caller waiting', () => {
  it('hands back the result of work that finishes within the limit', async () => {
    expect(await withinLimit(after(1, 'visited'), LIMIT_MS)).toBe('visited')
  })

  it('stops waiting for work that never finishes, and hands back nothing', async () => {
    expect(await withinLimit(new Promise<string>((): void => undefined), LIMIT_MS)).toBeUndefined()
  })

  it('stops waiting for work that would finish only long after the limit', async () => {
    const started: number = performance.now()
    expect(await withinLimit(after(LONG_AFTER_MS, 'late'), LIMIT_MS)).toBeUndefined()
    expect(performance.now() - started).toBeLessThan(LONG_AFTER_MS)
  })

  it('passes on the failure of work that fails within the limit', async () => {
    await expect(withinLimit(Promise.reject(new Error('the page crashed')), LIMIT_MS)).rejects.toThrow(
      'the page crashed',
    )
  })
})
