import { describe, expect, it } from 'vitest'
import {
  HEARTBEAT_MS,
  heartbeatSlot,
  isProgressLine,
  type PassProgress,
  partFindingLines,
  passFinishLine,
  passProgressLine,
  passStartLine,
} from '../src/sweep-progress.js'

const WIDTHS: PassProgress = {
  engine: 'chromium',
  pass: 'width-sweep',
  total: 71,
  done: 41,
  waiting: 26,
  elapsedMs: 132_000,
}

describe('the progress a running browser suite shows live', () => {
  it('passes on the result of each test, the opening of the run and the sweep progress', () => {
    expect(
      [
        'Running 55 tests using 4 workers',
        '  ✓   1 [sweep-discovery] › tests/e2e/a11y.e2e.spec.ts:63:3 › discovers every route (1.8s)',
        '  ✘  35 [sweep-chromium] › tests/e2e/a11y.e2e.spec.ts:74:5 › every control passes (5.2m)',
        passStartLine('chromium', 'resting', 509, 4),
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

describe('the progress of a sweep pass', () => {
  it('places the pass among the engine passes and says how many items it shares out', () => {
    expect([passStartLine('chromium', 'width-sweep', 71, 4), passStartLine('webkit', 'engine', 509, 4)]).toEqual([
      '[ploaness-sweep] chromium width-sweep (pass 6 of 7): started, 71 items across 4 parallel parts',
      '[ploaness-sweep] webkit engine (pass 1 of 1): started, 509 items across 4 parallel parts',
    ])
  })

  it('counts what is done, under way and waiting, and estimates what is left at the pace so far', () => {
    expect(passProgressLine(WIDTHS)).toBe(
      '[ploaness-sweep] chromium width-sweep (pass 6 of 7): 41/71 done (57%), 4 in progress, 26 waiting · ' +
        '2m 12s elapsed, about 1m 36s left',
    )
  })

  it('does not guess what is left before anything is done', () => {
    expect(passProgressLine({ ...WIDTHS, done: 0, waiting: 67, elapsedMs: 41_000 })).toMatch(
      /0\/71 done \(0%\), 4 in progress, 67 waiting · 41s elapsed, estimating what is left$/u,
    )
  })

  it('reports the whole pass once it is finished', () => {
    expect(passFinishLine('chromium', 'width-sweep', 71, 220_400)).toBe(
      '[ploaness-sweep] chromium width-sweep (pass 6 of 7): finished 71 items in 3m 40s',
    )
  })

  it('shares one heartbeat slot per interval among the parts, whatever moment each reaches it at', () => {
    expect([
      heartbeatSlot(HEARTBEAT_MS * 5),
      heartbeatSlot(HEARTBEAT_MS * 6 - 1),
      heartbeatSlot(HEARTBEAT_MS * 6),
    ]).toEqual([5, 5, 6])
  })
})

describe('the findings a part reports as soon as it ends', () => {
  it('heads the findings with the pass and the part, and lists each as the report words it', () => {
    expect(
      partFindingLines('chromium', 'resting', { index: 2, count: 4 }, [
        '[page-not-stable] story:pages-homepage--post-games @768x1024 (chromium, resting): the page kept changing',
      ]),
    ).toEqual([
      '[ploaness-sweep] chromium resting (pass 2 of 7) part 3 of 4: 1 finding',
      '[ploaness-sweep]   [page-not-stable] story:pages-homepage--post-games @768x1024 (chromium, resting): the page kept changing',
    ])
  })

  it('stays quiet for a part that found nothing', () => {
    expect(partFindingLines('webkit', 'engine', { index: 0, count: 4 }, [])).toEqual([])
  })
})
