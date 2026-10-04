// How the touching-box rule measures a pair: by what each side shows the other, and with the page's own
// full-width sections left to meet.
import { describe, expect, it } from 'vitest'
import type { LayoutNode } from '../src/layout-snapshot.js'
import { BODY, defectsOf, GREEN_BORDER, NO_BORDER, nodeOf, RED, rect, TINT } from './layout-fixture.js'

// A footer heading with bottom padding above a row of tinted chips. The heading paints nothing, so a
// reader sees its text, and `textBottom` is where that text ends; its box always ends at 52, where the
// chips start.
const headingAboveChip = (textBottom: number): readonly LayoutNode[] => [
  BODY,
  nodeOf({
    index: 1,
    parent: 0,
    tag: 'h2',
    label: 'h2 "Partners"',
    rects: [rect(0, 0, 200, 52)],
    textRects: [rect(0, 0, 90, textBottom)],
  }),
  nodeOf({ index: 2, parent: 0, tag: 'li', label: 'li.chip', rects: [rect(0, 52, 120, 90)], backgroundColor: TINT }),
]

// Two rows of a divider list: each draws a rule along its top edge and nothing else, and the second row
// starts where the first one's box ends. `textBottom` is where the first row's text ends.
const dividerRows = (textBottom: number): readonly LayoutNode[] => {
  const rule: Partial<LayoutNode> = {
    borders: { top: GREEN_BORDER, right: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER },
  }
  return [
    BODY,
    nodeOf({ index: 1, parent: 0, rects: [rect(0, 0, 200, 40)], textRects: [rect(0, 8, 90, textBottom)], ...rule }),
    nodeOf({ index: 2, parent: 0, rects: [rect(0, 40, 200, 80)], textRects: [rect(0, 48, 90, 70)], ...rule }),
  ]
}

// A heading set with a tight line-height under a tinted line: its text reports a line box taller than the
// heading itself, reaching 6px above the heading's top edge, which sits 8px below the tinted line.
const tightHeading: readonly LayoutNode[] = [
  BODY,
  nodeOf({ index: 1, parent: 0, tag: 'p', label: 'p.season', rects: [rect(0, 0, 200, 20)], backgroundColor: TINT }),
  nodeOf({
    index: 2,
    parent: 0,
    tag: 'h1',
    label: 'h1.club',
    rects: [rect(0, 28, 200, 60)],
    textRects: [rect(0, 22, 120, 66)],
  }),
]

describe('a neighbour that draws nothing toward the other box', () => {
  it('is never measured as reaching past its own box, however tall its line box is', () => {
    expect(defectsOf(tightHeading)).toEqual([])
  })

  it('is measured by its text, so the padding under a heading is space rather than contact', () => {
    expect([defectsOf(headingAboveChip(40)), defectsOf(headingAboveChip(50))]).toEqual([
      [],
      ['/en/account/verify @390px: touching boxes (gap 2px): h2 "Partners"  <->  li.chip'],
    ])
  })

  it('lets a rule drawn above a row meet the row before it while that row keeps its text clear', () => {
    expect([defectsOf(dividerRows(30)), defectsOf(dividerRows(38))]).toEqual([
      [],
      ['/en/account/verify @390px: touching boxes (gap 2px): div#n1  <->  div#n2'],
    ])
  })
})

// Two sections stacked down the page, each spanning `width` of the 390px body.
const bands = (width: number, secondTop: number = 40): readonly LayoutNode[] => [
  BODY,
  nodeOf({ index: 1, parent: 0, rects: [rect(0, 0, width, 40)], backgroundColor: RED }),
  nodeOf({ index: 2, parent: 0, rects: [rect(0, secondTop, width, secondTop + 80)], backgroundColor: RED }),
]

describe('sections that span the page', () => {
  it('may meet edge to edge only when both run the full width of the page', () => {
    expect([defectsOf(bands(390)), defectsOf(bands(380))]).toEqual([
      [],
      ['/en/account/verify @390px: touching boxes (gap 0px): div#n1  <->  div#n2'],
    ])
  })

  it('are still reported when they overlap', () => {
    expect(defectsOf(bands(390, 30))).toEqual(['/en/account/verify @390px: overlapping boxes: div#n1  <->  div#n2'])
  })
})
