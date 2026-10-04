import { describe, expect, it } from 'vitest'
import {
  findLayoutDefects,
  LAYOUT_MINIMUM_GAP,
  type LayoutViewport,
  layoutViewportsWith,
} from '../src/layout-defects.js'
import {
  isVisibleColor,
  keyOf,
  type LayoutBorder,
  type LayoutNode,
  type LayoutRect,
  type LayoutSnapshot,
} from '../src/layout-snapshot.js'

// The rules judge a page as the browser reported it, so every case here is the numbers a real page
// produces: whole CSS pixels and computed style strings. The first case is the page that escaped
// every other gate - a confirmation notice and the button after it, rendered with no gap at all.

const TRANSPARENT: string = 'rgba(0, 0, 0, 0)'
const WHITE: string = 'rgb(255, 255, 255)'
const TINT: string = 'rgb(236, 253, 245)'
const RED: string = 'rgb(220, 38, 38)'

const NO_BORDER: LayoutBorder = { width: 0, style: 'none', color: 'rgb(0, 0, 0)' }
const GREEN_BORDER: LayoutBorder = { width: 4, style: 'solid', color: 'rgb(22, 163, 74)' }

const rect = (left: number, top: number, right: number, bottom: number): LayoutRect => ({
  left,
  top,
  right,
  bottom,
})

const nodeOf = (fields: Partial<LayoutNode> & Pick<LayoutNode, 'index' | 'parent'>): LayoutNode => ({
  label: `div#n${String(fields.index)}`,
  tag: 'div',
  rects: [],
  textRects: [],
  lineHeight: 0,
  text: '',
  display: 'block',
  visibility: 'visible',
  position: 'static',
  backgroundColor: TRANSPARENT,
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
  ...fields,
})

const PHONE: LayoutViewport = { width: 390, height: 844 }

const snapshotOf = (nodes: readonly LayoutNode[], viewport: LayoutViewport = PHONE): LayoutSnapshot => ({
  route: '/en/account/verify',
  viewportWidth: viewport.width,
  viewportHeight: viewport.height,
  scrollWidth: viewport.width,
  rootBackground: WHITE,
  nodes,
})

const defectsOf = (nodes: readonly LayoutNode[], minimumGap: number = LAYOUT_MINIMUM_GAP): readonly string[] =>
  findLayoutDefects([snapshotOf(nodes)], minimumGap)

const BODY: LayoutNode = nodeOf({
  index: 0,
  parent: -1,
  tag: 'body',
  rects: [rect(0, 0, 390, 300)],
})

// `<div class="page">` holding a heading, the notice, and `<p class="inline-actions"><a class="button">`.
// The paragraph paints nothing, so the button is the notice's real neighbour. `actionsTop` is where the
// paragraph starts: 100 is flush against the notice, 116 is what a 16px gap on the parent produces.
const verifyPage = (actionsTop: number): readonly LayoutNode[] => [
  BODY,
  nodeOf({ index: 1, parent: 0, label: 'div.page.page-narrow', rects: [rect(16, 0, 374, 160)] }),
  nodeOf({ index: 2, parent: 1, label: 'div.page-heading', rects: [rect(16, 0, 374, 40)] }),
  nodeOf({
    index: 3,
    parent: 2,
    tag: 'h1',
    label: 'h1 "Email confirmation"',
    rects: [rect(16, 0, 374, 40)],
    textRects: [rect(16, 4, 260, 36)],
  }),
  nodeOf({
    index: 4,
    parent: 1,
    label: 'div.notice.notice-success',
    rects: [rect(16, 56, 374, 100)],
    backgroundColor: TINT,
    borders: { top: NO_BORDER, right: NO_BORDER, bottom: NO_BORDER, left: GREEN_BORDER },
  }),
  nodeOf({
    index: 5,
    parent: 4,
    tag: 'p',
    label: 'p "Your email address is confirmed."',
    rects: [rect(32, 66, 358, 90)],
    textRects: [rect(32, 68, 300, 88)],
  }),
  nodeOf({
    index: 6,
    parent: 1,
    tag: 'p',
    label: 'p.inline-actions',
    rects: [rect(16, actionsTop, 374, actionsTop + 40)],
  }),
  nodeOf({
    index: 7,
    parent: 6,
    tag: 'a',
    label: 'a.button "Sign in"',
    rects: [rect(16, actionsTop, 100, actionsTop + 40)],
    textRects: [rect(30, actionsTop + 10, 86, actionsTop + 30)],
    backgroundColor: RED,
  }),
]

describe('the email confirmation page that escaped every other gate', () => {
  it('fails while the notice and the button touch', () => {
    expect(defectsOf(verifyPage(100))).toEqual([
      '/en/account/verify @390px: touching boxes (gap 0px): div.notice.notice-success  <->  a.button "Sign in"',
    ])
  })

  it('passes once the parent lays its children out with a gap', () => {
    expect(defectsOf(verifyPage(116))).toEqual([])
  })
})

// Two siblings stacked vertically: the first from 0 to 40, the second starting at `secondTop`.
const stacked = (
  first: Partial<LayoutNode>,
  second: Partial<LayoutNode>,
  secondTop: number = 40,
): readonly LayoutNode[] => [
  BODY,
  nodeOf({ index: 1, parent: 0, rects: [rect(0, 0, 200, 40)], ...first }),
  nodeOf({ index: 2, parent: 0, rects: [rect(0, secondTop, 200, secondTop + 40)], ...second }),
]

describe('what makes an element boxed', () => {
  it('leaves two siblings alone when neither paints anything', () => {
    expect(defectsOf(stacked({}, {}))).toEqual([])
  })

  it('reads a background the same as the one beneath it as no box at all', () => {
    expect(defectsOf(stacked({ backgroundColor: WHITE }, {}))).toEqual([])
  })

  it('treats a background image as a box whatever its colour', () => {
    expect(defectsOf(stacked({ backgroundImage: 'linear-gradient(red, blue)' }, {}))).toHaveLength(1)
  })

  it('treats a shadow as a box', () => {
    expect(defectsOf(stacked({ boxShadow: 'rgba(0, 0, 0, 0.2) 0px 1px 3px 0px' }, {}))).toHaveLength(1)
  })

  it('counts a border only on the side that faces the neighbour', () => {
    const leftOnly: Partial<LayoutNode> = {
      borders: { top: NO_BORDER, right: NO_BORDER, bottom: NO_BORDER, left: GREEN_BORDER },
    }
    const bottom: Partial<LayoutNode> = {
      borders: { top: NO_BORDER, right: NO_BORDER, bottom: GREEN_BORDER, left: NO_BORDER },
    }
    expect([defectsOf(stacked(leftOnly, {})), defectsOf(stacked(bottom, {}))]).toEqual([
      [],
      ['/en/account/verify @390px: touching boxes (gap 0px): div#n1  <->  div#n2'],
    ])
  })

  it('ignores a border drawn in a transparent colour or with no style', () => {
    const invisible: Partial<LayoutNode> = {
      borders: {
        top: NO_BORDER,
        right: NO_BORDER,
        bottom: { width: 2, style: 'solid', color: TRANSPARENT },
        left: NO_BORDER,
      },
    }
    expect(defectsOf(stacked(invisible, {}))).toEqual([])
  })

  it('compares a tinted box with its parent background, not with the page canvas', () => {
    const tinted: readonly LayoutNode[] = [
      BODY,
      nodeOf({ index: 1, parent: 0, rects: [rect(0, 0, 200, 80)], backgroundColor: TINT }),
      nodeOf({ index: 2, parent: 1, rects: [rect(0, 0, 200, 40)], backgroundColor: TINT }),
      nodeOf({ index: 3, parent: 1, rects: [rect(0, 40, 200, 80)] }),
    ]
    expect(defectsOf(tinted)).toEqual([])
  })
})

describe('how close is too close', () => {
  it('accepts a gap at the minimum', () => {
    expect(defectsOf(stacked({ backgroundColor: RED }, {}, 44))).toEqual([])
  })

  it('rejects a gap one pixel under it', () => {
    expect(defectsOf(stacked({ backgroundColor: RED }, {}, 43))).toEqual([
      '/en/account/verify @390px: touching boxes (gap 3px): div#n1  <->  div#n2',
    ])
  })

  it('rejects the same gap under a stricter minimum a project declared', () => {
    expect(defectsOf(stacked({ backgroundColor: RED }, {}, 44), 8)).toHaveLength(1)
  })

  it('reports overlapping boxes as overlapping rather than as a gap', () => {
    expect(defectsOf(stacked({ backgroundColor: RED }, {}, 30))).toEqual([
      '/en/account/verify @390px: overlapping boxes: div#n1  <->  div#n2',
    ])
  })

  it('judges side by side boxes along the horizontal axis', () => {
    const sideBySide: readonly LayoutNode[] = [
      BODY,
      nodeOf({ index: 1, parent: 0, rects: [rect(0, 0, 100, 40)], backgroundColor: RED }),
      nodeOf({ index: 2, parent: 0, rects: [rect(102, 0, 200, 40)], backgroundColor: RED }),
    ]
    expect(defectsOf(sideBySide)).toEqual(['/en/account/verify @390px: touching boxes (gap 2px): div#n1  <->  div#n2'])
  })

  // An inline link wrapped over two lines has a bounding box covering both lines. Judged on that box it
  // overlaps the code span after it; judged on its two fragments, which is what a reader sees, it does
  // not.
  it('measures an inline element by its line fragments, not by their bounding box', () => {
    const wrapped: readonly LayoutNode[] = [
      BODY,
      nodeOf({
        index: 1,
        parent: 0,
        tag: 'p',
        rects: [rect(0, 0, 300, 40)],
        textRects: [rect(0, 0, 40, 20)],
      }),
      nodeOf({
        index: 2,
        parent: 1,
        tag: 'a',
        display: 'inline',
        rects: [rect(40, 0, 300, 20), rect(0, 20, 120, 40)],
      }),
      nodeOf({
        index: 3,
        parent: 1,
        tag: 'code',
        display: 'inline',
        rects: [rect(130, 20, 180, 40)],
        backgroundColor: TINT,
      }),
    ]
    expect(defectsOf(wrapped)).toEqual([])
  })
})

const touchingRed = (second: Partial<LayoutNode>): readonly LayoutNode[] => stacked({ backgroundColor: RED }, second)

describe('what is not compared', () => {
  // Rows paint nothing, so without this every cell would be compared with the cell below it, and each
  // would fail on the rule the table draws between them.
  it('leaves the rows and cells of a table to the table', () => {
    const ruled: Partial<LayoutNode> = {
      borders: { top: NO_BORDER, right: NO_BORDER, bottom: GREEN_BORDER, left: NO_BORDER },
    }
    const table: readonly LayoutNode[] = [
      BODY,
      nodeOf({ index: 1, parent: 0, tag: 'table', display: 'table', rects: [rect(0, 0, 200, 80)] }),
      nodeOf({
        index: 2,
        parent: 1,
        tag: 'tbody',
        display: 'table-row-group',
        rects: [rect(0, 0, 200, 80)],
      }),
      nodeOf({
        index: 3,
        parent: 2,
        tag: 'tr',
        display: 'table-row',
        rects: [rect(0, 0, 200, 40)],
      }),
      nodeOf({
        index: 4,
        parent: 3,
        tag: 'td',
        display: 'table-cell',
        rects: [rect(0, 0, 200, 40)],
        ...ruled,
      }),
      nodeOf({
        index: 5,
        parent: 2,
        tag: 'tr',
        display: 'table-row',
        rects: [rect(0, 40, 200, 80)],
      }),
      nodeOf({
        index: 6,
        parent: 5,
        tag: 'td',
        display: 'table-cell',
        rects: [rect(0, 40, 200, 80)],
        ...ruled,
      }),
    ]
    expect(defectsOf(table)).toEqual([])
  })

  it('still compares the content inside one table cell', () => {
    const cell: readonly LayoutNode[] = [
      BODY,
      nodeOf({
        index: 1,
        parent: 0,
        tag: 'td',
        display: 'table-cell',
        rects: [rect(0, 0, 200, 80)],
      }),
      nodeOf({ index: 2, parent: 1, rects: [rect(0, 0, 200, 40)], backgroundColor: RED }),
      nodeOf({ index: 3, parent: 1, rects: [rect(0, 40, 200, 80)] }),
    ]
    expect(defectsOf(cell)).toEqual(['/en/account/verify @390px: touching boxes (gap 0px): div#n2  <->  div#n3'])
  })

  it('skips a sibling hidden from assistive technology as decoration', () => {
    expect(defectsOf(touchingRed({ isAriaHidden: true }))).toEqual([])
  })

  it('skips an absolutely positioned layer', () => {
    expect(defectsOf(touchingRed({ position: 'absolute' }))).toEqual([])
  })

  it('skips a fixed layer', () => {
    expect(defectsOf(touchingRed({ position: 'fixed' }))).toEqual([])
  })

  it('skips an invisible sibling', () => {
    expect(defectsOf(touchingRed({ visibility: 'hidden' }))).toEqual([])
  })

  it('skips a sibling with no size', () => {
    expect(defectsOf(touchingRed({ rects: [rect(0, 40, 200, 40)] }))).toEqual([])
  })

  it('looks through display: contents to the children it lays out', () => {
    const contents: readonly LayoutNode[] = [
      BODY,
      nodeOf({ index: 1, parent: 0, rects: [rect(0, 0, 200, 40)], backgroundColor: RED }),
      nodeOf({ index: 2, parent: 0, display: 'contents', backgroundColor: TINT }),
      nodeOf({ index: 3, parent: 2, rects: [rect(0, 40, 200, 80)] }),
    ]
    expect(defectsOf(contents)).toEqual(['/en/account/verify @390px: touching boxes (gap 0px): div#n1  <->  div#n3'])
  })

  it('does not look through a wrapper that carries text of its own', () => {
    const textual: readonly LayoutNode[] = [
      BODY,
      nodeOf({ index: 1, parent: 0, rects: [rect(0, 0, 200, 40)], backgroundColor: RED }),
      nodeOf({
        index: 2,
        parent: 0,
        tag: 'p',
        rects: [rect(0, 60, 200, 100)],
        textRects: [rect(0, 60, 80, 80)],
      }),
      nodeOf({
        index: 3,
        parent: 2,
        tag: 'a',
        rects: [rect(80, 60, 120, 80)],
        backgroundColor: TINT,
      }),
    ]
    expect(defectsOf(textual)).toEqual([])
  })
})

const attachedTab = (exemption: Partial<LayoutNode>, panelTop: number = 40): readonly LayoutNode[] => [
  BODY,
  nodeOf({
    index: 1,
    parent: 0,
    label: 'div.tab',
    rects: [rect(0, 0, 200, 40)],
    backgroundColor: RED,
    ...exemption,
  }),
  nodeOf({
    index: 2,
    parent: 0,
    label: 'div.panel',
    rects: [rect(0, panelTop, 200, panelTop + 80)],
    backgroundColor: TINT,
  }),
]

const ATTACHED: Partial<LayoutNode> = {
  exemption: 'attached',
  exemptionReason: 'the tab joins its panel',
}

describe('an edge shared on purpose', () => {
  it('passes a touching pair when one of them declares it attached, with a reason', () => {
    expect(defectsOf(attachedTab(ATTACHED))).toEqual([])
  })

  it('fails an exemption that states no reason', () => {
    expect(defectsOf(attachedTab({ exemption: 'attached' }))).toEqual([
      '/en/account/verify @390px: ' +
        'layout exemption without a reason on div.tab; state it in data-ploaness-layout-reason',
    ])
  })

  it('fails a value the harness does not know, and does not excuse the pair', () => {
    expect(defectsOf(attachedTab({ exemption: 'joined', exemptionReason: 'tab' }))).toEqual([
      '/en/account/verify @390px: touching boxes (gap 0px): div.tab  <->  div.panel',
      '/en/account/verify @390px: ' +
        'unknown layout exemption data-ploaness-layout="joined" on div.tab; the only value is "attached"',
    ])
  })

  it('fails an exemption that excuses nothing', () => {
    expect(defectsOf(attachedTab(ATTACHED, 60))).toEqual([
      '/en/account/verify: stale layout exemption on div.tab: ' +
        'it excuses no touching or overlapping box at 390px; remove data-ploaness-layout',
    ])
  })

  // A tab bar that sits against its panel on a phone and apart from it on a desktop is the ordinary
  // shape of a responsive layout: the exemption is needed at one width and is not stale.
  it('is not stale when it excuses a pair at one viewport and nothing at another', () => {
    const phone: LayoutSnapshot = snapshotOf(attachedTab(ATTACHED))
    const desktop: LayoutSnapshot = snapshotOf(attachedTab(ATTACHED, 60), {
      width: 1280,
      height: 800,
    })
    expect(findLayoutDefects([phone, desktop], LAYOUT_MINIMUM_GAP)).toEqual([])
  })

  it('names every viewport it was measured at when it is stale at all of them', () => {
    const phone: LayoutSnapshot = snapshotOf(attachedTab(ATTACHED, 60))
    const desktop: LayoutSnapshot = snapshotOf(attachedTab(ATTACHED, 60), {
      width: 1280,
      height: 800,
    })
    expect(findLayoutDefects([phone, desktop], LAYOUT_MINIMUM_GAP)).toEqual([
      '/en/account/verify: stale layout exemption on div.tab: ' +
        'it excuses no touching or overlapping box at 390px, 1280px; remove data-ploaness-layout',
    ])
  })
})

const widthsOf = (viewports: readonly LayoutViewport[]): readonly number[] =>
  viewports.map((viewport: LayoutViewport): number => viewport.width)

describe('the viewports a scan runs at', () => {
  it('keeps the phone and desktop widths when a project adds its own', () => {
    expect(widthsOf(layoutViewportsWith([{ width: 768, height: 1024 }]))).toEqual([390, 1280, 768])
  })

  it('measures a viewport a project repeats only once', () => {
    expect(widthsOf(layoutViewportsWith([{ width: 390, height: 844 }]))).toEqual([390, 1280])
  })

  it('reports a defect at each viewport it appears at', () => {
    const phone: LayoutSnapshot = snapshotOf(verifyPage(100))
    const desktop: LayoutSnapshot = snapshotOf(verifyPage(100), { width: 1280, height: 800 })
    expect(
      findLayoutDefects([phone, desktop], LAYOUT_MINIMUM_GAP).map(
        (line: string): string => line.split(':', 1)[0] ?? '',
      ),
    ).toEqual(['/en/account/verify @390px', '/en/account/verify @1280px'])
  })
})

describe('reading computed colours', () => {
  it.each([
    ['transparent', false],
    ['', false],
    ['rgba(0, 0, 0, 0)', false],
    ['color(srgb 1 0 0 / 0)', false],
    ['rgba(0, 0, 0, 0.5)', true],
    ['rgb(220, 38, 38)', true],
    ['oklch(0.6 0.2 30 / 50%)', true],
  ])('reads %j as visible: %s', (color: string, isVisible: boolean) => {
    expect(isVisibleColor(color)).toBe(isVisible)
  })
})

describe('the key that follows an element across viewports', () => {
  it('names each ancestor by its tag and its position among its siblings', () => {
    const snapshot: LayoutSnapshot = snapshotOf(verifyPage(100))
    const button: LayoutNode | undefined = snapshot.nodes[7]
    expect(button === undefined ? '' : keyOf(snapshot, button)).toBe('body/div:0/p:2/a:0')
  })
})
