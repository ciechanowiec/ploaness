import { describe, expect, it } from 'vitest'
import {
  isHeartbeatDue,
  isProgressLine,
  type SweepProgress,
  sweepProgressLine,
  sweepStartLine,
} from '../src/sweep-progress.js'

const PART: SweepProgress = {
  pass: 'interaction',
  engine: 'chromium',
  shard: { index: 1, count: 4 },
  visited: 23,
  untaken: 80,
  total: 169,
  elapsedMs: 252_400,
}

describe('the progress a running browser suite shows live', () => {
  it('passes on the result of each test, the opening of the run and the sweep heartbeat', () => {
    expect(
      [
        'Running 55 tests using 4 workers',
        '  ✓   1 [sweep-discovery] › tests/e2e/a11y.e2e.spec.ts:63:3 › discovers every route (1.8s)',
        '  ✘  35 [sweep-chromium] › tests/e2e/a11y.e2e.spec.ts:74:5 › every control passes (5.2m)',
        sweepStartLine(PART),
      ].map((line: string): boolean => isProgressLine(line)),
    ).toEqual([true, true, true, true])
  })

  it('keeps the servers and the tests themselves out of the live log', () => {
    expect(
      [
        '[WebServer] ⨯ upstream image response failed for http://localhost:3000/api/media/file/logo.png 500',
        '  ▲ Next.js 16.4.2',
        '[crawl] visited 5 page(s)',
        '      Error: interaction pass findings',
      ].map((line: string): boolean => isProgressLine(line)),
    ).toEqual([false, false, false, false])
  })
})

describe('the heartbeat of a sweep part', () => {
  it('names the pass, the engine and the part, and says how far the pass has got', () => {
    expect([sweepStartLine(PART), sweepProgressLine(PART)]).toEqual([
      '[ploaness-sweep] interaction (chromium) part 2 of 4: started, 169 items in the pass',
      '[ploaness-sweep] interaction (chromium) part 2 of 4: 23 visited here, 80 of 169 not yet taken, 4m 12s',
    ])
    expect(sweepProgressLine({ ...PART, elapsedMs: 41_900 })).toMatch(/, 41s$/u)
  })

  it('beats once a minute has passed since the last one, and not before', () => {
    expect([isHeartbeatDue(1000, 60_999), isHeartbeatDue(1000, 61_000)]).toEqual([false, true])
  })
})
