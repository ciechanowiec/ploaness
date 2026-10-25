import { describe, expect, it } from 'vitest'
import {
  BASELINE_VIEWPORTS,
  bisectionWidth,
  breakpointEdges,
  failingRanges,
  pageViewports,
  SWEEP_MAX_WIDTH,
  SWEEP_MIN_WIDTH,
  sweepWidths,
} from '../src/browser-viewports.js'

describe('breakpoint edges', () => {
  it('adds both sides of min-width and max-width conditions, in px, rem and em', () => {
    expect(breakpointEdges(['(min-width: 768px)', 'screen and (max-width: 767.98px)', '(min-width: 40em)'])).toEqual([
      639, 640, 767, 768,
    ])
  })

  it('reads the range syntax Tailwind writes, from either side', () => {
    expect(breakpointEdges(['(width >= 40rem)', '(width < 64rem)', '(1280px < width)', '(width <= 900px)'])).toEqual([
      639, 640, 900, 901, 1023, 1024, 1280, 1281,
    ])
  })

  it('leaves out widths beyond the sweep and conditions on anything but width', () => {
    expect(
      breakpointEdges([
        '(min-width: 200px)',
        '(min-width: 2560px)',
        '(prefers-color-scheme: dark)',
        '(min-height: 600px)',
      ]),
    ).toEqual([])
  })
})

describe('the viewports a page is loaded at', () => {
  it('adds each edge at the height of the nearest baseline viewport, and each declared viewport once', () => {
    const widths: readonly string[] = pageViewports(
      [639, 640],
      [
        { width: 390, height: 844 },
        { width: 1366, height: 768 },
      ],
    ).map((viewport): string => `${String(viewport.width)}x${String(viewport.height)}`)
    expect(widths).toEqual(['390x844', '639x1024', '640x1024', '768x1024', '1280x800', '1366x768'])
    expect(widths).toHaveLength(BASELINE_VIEWPORTS.length + 3)
  })
})

describe('the width sweep', () => {
  it('steps from the narrowest to the widest width by 16 px', () => {
    const widths: readonly number[] = sweepWidths()
    expect([widths[0], widths[1], widths.at(-1), widths.length]).toEqual([SWEEP_MIN_WIDTH, 336, SWEEP_MAX_WIDTH, 101])
  })

  it('bisects until the passing and failing widths are adjacent', () => {
    expect([bisectionWidth(432, 448), bisectionWidth(447, 448), bisectionWidth(448, 432)]).toEqual([
      440,
      undefined,
      440,
    ])
  })

  it('groups failing widths into runs bounded by measured widths', () => {
    expect(failingRanges([441, 448, 464, 640], [432, 440, 441, 448, 464, 480, 624, 640, 656])).toEqual([
      { from: 441, to: 464 },
      { from: 640, to: 640 },
    ])
  })
})
