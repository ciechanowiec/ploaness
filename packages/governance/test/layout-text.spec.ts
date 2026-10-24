import { describe, expect, it } from 'vitest'
import { findLayoutDefects, LAYOUT_MINIMUM_GAP } from '../src/layout-defects.js'
import type { LayoutBorder, LayoutNode, LayoutRect, LayoutSnapshot } from '../src/layout-snapshot.js'

// Text that collides with other text, text its own box cuts off, and a page wider than its viewport,
// each stated as the numbers the browser reports.

const NO_BORDER: LayoutBorder = { width: 0, style: 'none', color: 'rgb(0, 0, 0)' }

const rect = (left: number, top: number, right: number, bottom: number): LayoutRect => ({
  left,
  top,
  right,
  bottom,
})

const nodeOf = (fields: Partial<LayoutNode> & Pick<LayoutNode, 'index' | 'parent'>): LayoutNode => ({
  label: `p#n${String(fields.index)}`,
  tag: 'p',
  rects: [],
  textRects: [],
  lineHeight: 0,
  text: '',
  display: 'block',
  visibility: 'visible',
  position: 'static',
  zIndex: 'auto',
  transform: 'none',
  rotate: 'none',
  backgroundColor: 'rgba(0, 0, 0, 0)',
  backgroundImage: 'none',
  boxShadow: 'none',
  borders: { top: NO_BORDER, right: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER },
  isAriaHidden: false,
  isClipped: false,
  overflowX: 'visible',
  overflowY: 'visible',
  textOverflow: 'clip',
  lineClamp: 'none',
  scrollWidth: 0,
  clientWidth: 0,
  scrollHeight: 0,
  clientHeight: 0,
  title: '',
  ariaLabel: '',
  exemption: undefined,
  exemptionReason: '',
  fontSize: 16,
  fontFamily: 'sans-serif',
  media: undefined,
  ...fields,
})

const BODY: LayoutNode = nodeOf({
  index: 0,
  parent: -1,
  tag: 'body',
  label: 'body',
  rects: [rect(0, 0, 390, 400)],
})

const defectsOf = (nodes: readonly LayoutNode[], scrollWidth: number = 390): readonly string[] =>
  findLayoutDefects(
    [
      {
        route: '/news',
        viewportWidth: 390,
        viewportHeight: 844,
        scrollWidth,
        rootBackground: 'rgb(255, 255, 255)',
        nodes,
        fontFaces: [],
      } satisfies LayoutSnapshot,
    ],
    LAYOUT_MINIMUM_GAP,
  )

// A heading pulled up over the paragraph beneath it by a negative margin: the two text runs share
// `overlap` pixel rows.
const collidingText = (overlap: number, second: Partial<LayoutNode> = {}): readonly LayoutNode[] => [
  BODY,
  nodeOf({
    index: 1,
    parent: 0,
    tag: 'h2',
    label: 'h2 "Results"',
    rects: [rect(0, 0, 300, 30)],
    textRects: [rect(0, 0, 120, 30)],
  }),
  nodeOf({
    index: 2,
    parent: 0,
    label: 'p "Saturday fixtures"',
    rects: [rect(0, 30 - overlap, 300, 60 - overlap)],
    textRects: [rect(0, 30 - overlap, 200, 50 - overlap)],
    ...second,
  }),
]

describe('text that overlaps other text', () => {
  it('fails when two runs of text share more than one pixel row', () => {
    expect(defectsOf(collidingText(8))).toEqual([
      '[text-overlap] /news @390x844 (chromium, resting): overlapping text: h2 "Results"  <->  p "Saturday fixtures"',
    ])
  })

  it('accepts a single shared row, which is rounding rather than a collision', () => {
    expect(defectsOf(collidingText(1))).toEqual([])
  })

  it('accepts text inside the element whose own text it sits beside', () => {
    const nested: readonly LayoutNode[] = [
      BODY,
      nodeOf({
        index: 1,
        parent: 0,
        rects: [rect(0, 0, 300, 30)],
        textRects: [rect(0, 0, 120, 30)],
      }),
      nodeOf({
        index: 2,
        parent: 1,
        tag: 'strong',
        rects: [rect(60, 0, 120, 30)],
        textRects: [rect(60, 0, 120, 30)],
      }),
    ]
    expect(defectsOf(nested)).toEqual([])
  })

  it('ignores text hidden from assistive technology', () => {
    expect(defectsOf(collidingText(8, { isAriaHidden: true }))).toEqual([])
  })

  it('ignores text clipped away as visually hidden', () => {
    expect(defectsOf(collidingText(8, { isClipped: true }))).toEqual([])
  })

  it('ignores text that is not visible', () => {
    expect(defectsOf(collidingText(8, { visibility: 'hidden' }))).toEqual([])
  })

  it('ignores the value a form control draws for itself', () => {
    expect(defectsOf(collidingText(8, { tag: 'textarea' }))).toEqual([])
  })
})

const OVERLAP: string =
  '[text-overlap] /news @390x844 (chromium, resting): overlapping text: h2 "Results"  <->  p "Saturday fixtures"'

describe('text in a rotated or skewed subtree', () => {
  it('ignores text whose own transform turns it, as a card dealt at an angle is', () => {
    expect(defectsOf(collidingText(8, { transform: 'matrix(0.995, 0.0998, -0.0998, 0.995, 0, 0)' }))).toEqual([])
  })

  it('ignores text turned by the individual rotate property', () => {
    expect(defectsOf(collidingText(8, { rotate: '3deg' }))).toEqual([])
  })

  it('ignores text inside a turned ancestor', () => {
    const [body, heading, paragraph] = collidingText(8, { parent: 3, index: 2 })
    const card: LayoutNode = nodeOf({ index: 3, parent: 0, rects: [rect(0, 0, 300, 80)], rotate: '-2deg' })
    expect(defectsOf([body as LayoutNode, heading as LayoutNode, paragraph as LayoutNode, card])).toEqual([])
  })

  it('still judges text that is only scaled, moved or turned by zero', () => {
    expect(defectsOf(collidingText(8, { transform: 'matrix(1.5, 0, 0, 1.5, 10, 4)' }))).toEqual([OVERLAP])
    expect(
      defectsOf(collidingText(8, { transform: 'matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 5, 0, 1)' })),
    ).toEqual([OVERLAP])
    expect(defectsOf(collidingText(8, { rotate: '0deg' }))).toEqual([OVERLAP])
  })
})

// A blurb in a scroll area that ends at 60px, above a legend at 62px. The blurb's text runs on to 100px,
// out of sight until the area is scrolled.
const scrolledBlurb = (scroller: Partial<LayoutNode>, blurb: Partial<LayoutNode> = {}): readonly LayoutNode[] => [
  BODY,
  nodeOf({
    index: 1,
    parent: 0,
    label: 'div.blurb-scroller',
    rects: [rect(0, 0, 300, 60)],
    overflowY: 'auto',
    ...scroller,
  }),
  nodeOf({
    index: 2,
    parent: 1,
    label: 'p "Saturday fixtures"',
    rects: [rect(0, 0, 300, 100)],
    textRects: [rect(0, 0, 280, 100)],
    ...blurb,
  }),
  nodeOf({
    index: 3,
    parent: 0,
    label: 'p.legend "Legend"',
    rects: [rect(0, 62, 300, 80)],
    textRects: [rect(0, 62, 100, 80)],
  }),
]

describe('text cut off by an ancestor that clips it', () => {
  it('ignores the part of the text a scroll area keeps out of sight', () => {
    expect(defectsOf(scrolledBlurb({}))).toEqual([])
  })

  it('still reports the overlap when the area lets its content overflow', () => {
    expect(defectsOf(scrolledBlurb({ overflowY: 'visible' }))).toEqual([
      '[text-overlap] /news @390x844 (chromium, resting): overlapping text: p "Saturday fixtures"  <->  p.legend "Legend"',
    ])
  })

  it('clips only along the axis the area clips', () => {
    expect(defectsOf(scrolledBlurb({ overflowX: 'hidden', overflowY: 'visible' }))).toHaveLength(1)
  })

  it('does not clip absolute text by a static ancestor below its containing block', () => {
    expect(defectsOf(scrolledBlurb({}, { position: 'absolute' }))).toHaveLength(1)
    expect(defectsOf(scrolledBlurb({ position: 'relative' }, { position: 'absolute' }))).toEqual([])
  })

  it('does not clip fixed text at all', () => {
    expect(defectsOf(scrolledBlurb({ position: 'relative' }, { position: 'fixed' }))).toHaveLength(1)
  })
})

// An open menu panel laid over the page: the page's heading text runs beneath the panel's link.
const openMenu = (panel: Partial<LayoutNode>, page: Partial<LayoutNode> = {}): readonly LayoutNode[] => [
  BODY,
  nodeOf({
    index: 1,
    parent: 0,
    tag: 'h2',
    label: 'h2 "Results"',
    rects: [rect(0, 40, 300, 70)],
    textRects: [rect(0, 40, 200, 70)],
    ...page,
  }),
  nodeOf({
    index: 2,
    parent: 0,
    label: 'div.menu-panel',
    rects: [rect(0, 30, 390, 200)],
    position: 'absolute',
    backgroundColor: 'rgb(255, 255, 255)',
    ...panel,
  }),
  nodeOf({
    index: 3,
    parent: 2,
    tag: 'a',
    label: 'a "Tickets"',
    rects: [rect(10, 45, 120, 65)],
    textRects: [rect(10, 45, 120, 65)],
  }),
]

const COVERED_OVERLAP: string =
  '[text-overlap] /news @390x844 (chromium, resting): overlapping text: h2 "Results"  <->  a "Tickets"'

describe('text beneath an opaque positioned layer', () => {
  it('ignores page text an opaque panel covers', () => {
    expect(defectsOf(openMenu({}))).toEqual([])
  })

  it('ignores it when the opaque background is drawn inside the positioned layer', () => {
    const [body, heading, panel, link] = openMenu({ backgroundColor: 'rgba(0, 0, 0, 0)' })
    const sheet: LayoutNode = nodeOf({
      index: 4,
      parent: 2,
      rects: [rect(0, 30, 390, 200)],
      backgroundColor: 'rgb(255, 255, 255)',
    })
    const nested: LayoutNode = { ...(link as LayoutNode), parent: 4 }
    expect(defectsOf([body, heading, panel, nested, sheet] as readonly LayoutNode[])).toEqual([])
  })

  it('reports text the layer shows through', () => {
    expect(defectsOf(openMenu({ backgroundColor: 'rgba(255, 255, 255, 0.8)' }))).toEqual([COVERED_OVERLAP])
    expect(defectsOf(openMenu({ backgroundColor: 'rgba(0, 0, 0, 0)' }))).toEqual([COVERED_OVERLAP])
  })

  it('reports text an in-flow background is painted beneath, as text is painted after every one', () => {
    expect(defectsOf(openMenu({ position: 'static' }))).toEqual([COVERED_OVERLAP])
  })

  it('reports text the layer does not cover whole', () => {
    expect(defectsOf(openMenu({ rects: [rect(0, 50, 390, 200)] }))).toEqual([COVERED_OVERLAP])
  })

  it('orders the layer by z-index against a positioned layer around the page text', () => {
    expect(defectsOf(openMenu({}, { position: 'relative', zIndex: '10' }))).toEqual([COVERED_OVERLAP])
    expect(defectsOf(openMenu({ zIndex: '20' }, { position: 'relative', zIndex: '10' }))).toEqual([])
    expect(defectsOf(openMenu({}, { position: 'relative' }))).toEqual([])
  })

  it('reports text over a layer with a negative z-index, which is painted beneath the page', () => {
    expect(defectsOf(openMenu({ zIndex: '-1' }))).toEqual([COVERED_OVERLAP])
  })
})

// A wordmark set with `line-height: 1`: a 26px name line above a 16px tagline line. The browser reports
// each line's whole font content area, 33px and 20px tall, which overhangs the line box above and below.
// `taglineTop` is where the tagline's line box starts: 26 sits it under the name, 16 pulls it up over it.
const wordmark = (taglineTop: number): readonly LayoutNode[] => [
  BODY,
  nodeOf({
    index: 1,
    parent: 0,
    tag: 'span',
    label: 'span.wordmark-name "Canada Soccer"',
    rects: [rect(0, 0, 120, 26)],
    textRects: [rect(0, -3, 120, 30)],
    lineHeight: 26,
  }),
  nodeOf({
    index: 2,
    parent: 0,
    tag: 'span',
    label: 'span.wordmark-tagline "Registration"',
    rects: [rect(0, taglineTop, 100, taglineTop + 16)],
    textRects: [rect(0, taglineTop - 2, 100, taglineTop + 18)],
    lineHeight: 16,
  }),
]

describe('text under a line height tighter than its font', () => {
  it('accepts lines whose content areas overhang each other while their line boxes only meet', () => {
    expect(defectsOf(wordmark(26))).toEqual([])
  })

  it('still fails lines pulled over each other', () => {
    expect(defectsOf(wordmark(16))).toEqual([
      '[text-overlap] /news @390x844 (chromium, resting): ' +
        'overlapping text: span.wordmark-name "Canada Soccer"  <->  span.wordmark-tagline "Registration"',
    ])
  })
})

// A one-line label in a 200px box with its overflow hidden, holding `contentWidth` pixels of text.
const label = (contentWidth: number, fields: Partial<LayoutNode> = {}): readonly LayoutNode[] => [
  BODY,
  nodeOf({
    index: 1,
    parent: 0,
    tag: 'span',
    label: 'span.team-name "Borussia Mönchengladbach"',
    rects: [rect(0, 0, 200, 20)],
    textRects: [rect(0, 0, 200, 20)],
    text: 'Borussia Mönchengladbach',
    overflowX: 'hidden',
    overflowY: 'hidden',
    scrollWidth: contentWidth,
    clientWidth: 200,
    scrollHeight: 20,
    clientHeight: 20,
    ...fields,
  }),
]

describe('text its own box cuts off', () => {
  it('fails when the content is wider than the box that hides it', () => {
    expect(defectsOf(label(240))).toEqual([
      '[clipped-text] /news @390x844 (chromium, resting): ' +
        'clipped text (content 240x20px in a 200x20px box): span.team-name "Borussia Mönchengladbach"',
    ])
  })

  it('fails when the content is taller than the box that hides it', () => {
    expect(defectsOf(label(200, { scrollHeight: 38 }))).toHaveLength(1)
  })

  it('accepts content that fits', () => {
    expect(defectsOf(label(200))).toEqual([])
  })

  it('accepts overflow a reader can scroll to', () => {
    expect(defectsOf(label(240, { overflowX: 'auto', overflowY: 'auto' }))).toEqual([])
  })

  it('accepts an ellipsis whose full text is in the title', () => {
    expect(defectsOf(label(240, { textOverflow: 'ellipsis', title: 'Borussia Mönchengladbach' }))).toEqual([])
  })

  it('accepts a line clamp whose full text is in the accessible name', () => {
    expect(defectsOf(label(200, { scrollHeight: 60, lineClamp: '2', ariaLabel: 'Borussia Mönchengladbach' }))).toEqual(
      [],
    )
  })

  it('fails an ellipsis that names its full text nowhere', () => {
    expect(defectsOf(label(240, { textOverflow: 'ellipsis' }))).toEqual([
      '[clipped-text] /news @390x844 (chromium, resting): ' +
        'truncated text without its full text in title or aria-label: span.team-name "Borussia Mönchengladbach"',
    ])
  })

  it('fails an ellipsis whose title holds only part of the text', () => {
    expect(defectsOf(label(240, { textOverflow: 'ellipsis', title: 'Borussia' }))).toHaveLength(1)
  })

  it('ignores the one-pixel box of a visually hidden element', () => {
    expect(defectsOf(label(240, { clientWidth: 1, clientHeight: 1 }))).toEqual([])
  })
})

describe('a page wider than its viewport', () => {
  const wide: readonly LayoutNode[] = [
    BODY,
    nodeOf({
      index: 1,
      parent: 0,
      tag: 'div',
      label: 'div.fixture-table',
      rects: [rect(0, 0, 412, 100)],
    }),
    nodeOf({ index: 2, parent: 1, tag: 'div', label: 'div.cell', rects: [rect(300, 0, 412, 100)] }),
  ]

  it('names the outermost element that reaches past the viewport, once', () => {
    expect(defectsOf(wide, 412)).toEqual([
      '[overflow] /news @390x844 (chromium, resting): ' +
        'horizontal overflow (page 412px wide in a 390px viewport): div.fixture-table',
    ])
  })

  it('passes a page that fits, whatever its elements do', () => {
    expect(defectsOf(wide, 390)).toEqual([])
  })

  it('does not blame an element inside a scroll container', () => {
    const scrolled: readonly LayoutNode[] = [
      BODY,
      nodeOf({ index: 1, parent: 0, tag: 'div', rects: [rect(0, 0, 390, 100)], overflowX: 'auto' }),
      nodeOf({ index: 2, parent: 1, tag: 'table', rects: [rect(0, 0, 600, 100)] }),
    ]
    expect(defectsOf(scrolled, 400)).toEqual([
      '[overflow] /news @390x844 (chromium, resting): ' +
        'horizontal overflow (page 400px wide in a 390px viewport): document',
    ])
  })

  it('does not blame a fixed layer, which never widens a page', () => {
    const fixed: readonly LayoutNode[] = [
      BODY,
      nodeOf({
        index: 1,
        parent: 0,
        tag: 'div',
        label: 'div.toast',
        position: 'fixed',
        rects: [rect(200, 0, 500, 40)],
      }),
    ]
    expect(defectsOf(fixed, 400)).toEqual([
      '[overflow] /news @390x844 (chromium, resting): ' +
        'horizontal overflow (page 400px wide in a 390px viewport): document',
    ])
  })
})
