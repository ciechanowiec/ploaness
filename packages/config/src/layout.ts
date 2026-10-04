// The layout scan's measurement: what a page reports about its own geometry, and the call that judges it.
//
// Every rule lives in `@ploaness/governance`, which judges a plain snapshot. This module is the one piece
// that has to run inside the browser, and the one place the harness's viewports and the project's
// stricter settings meet a page.
//
// WHY THE PAGE CODE IS ASSEMBLED FROM SOURCE TEXT. Playwright ships a page function to the browser as
// its own source, so it can reach nothing at module scope. One function holding the whole measurement
// would pass the callable cap several times over. Each step is therefore a top-level function of its
// own, and `IN_PAGE_SOURCE` joins their texts into one expression that hands each step the others as
// `tools`. A step names another only through that parameter, never directly, because in the page no
// other binding exists.
import { expect, type Page } from '@playwright/test'
import {
  findLayoutDefects,
  type LayoutBorder,
  type LayoutBorders,
  type LayoutNode,
  type LayoutRect,
  type LayoutSnapshot,
  type LayoutViewport,
  layoutViewportsWith,
} from '@ploaness/governance'
import { projectSettings } from './project-settings.js'
import { settleForScan } from './settle.js'

/** The viewports every layout scan runs at, the harness's own first. */
export const LAYOUT_SCAN_VIEWPORTS: readonly LayoutViewport[] = layoutViewportsWith(projectSettings.layoutViewports)

// The browser surface the page code touches, declared rather than taken from lib.dom for the reason
// `settle.ts` records. These names resolve in the page at run time.
interface PageRect {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
}

interface PageStyle {
  readonly getPropertyValue: (property: string) => string
}

interface PageText {
  readonly nodeType: number
  readonly textContent: string | null
}

interface PageRange {
  readonly selectNodeContents: (node: PageText) => void
  readonly getClientRects: () => ArrayLike<PageRect>
}

interface PageElement {
  readonly tagName: string
  readonly id: string
  readonly namespaceURI: string | null
  readonly classList: ArrayLike<string>
  readonly parentElement: PageElement | null
  readonly childNodes: ArrayLike<PageText>
  readonly textContent: string | null
  readonly scrollWidth: number
  readonly clientWidth: number
  readonly scrollHeight: number
  readonly clientHeight: number
  readonly getAttribute: (name: string) => string | null
  readonly getClientRects: () => ArrayLike<PageRect>
  readonly querySelectorAll: (selectors: string) => ArrayLike<PageElement>
}

declare const document: {
  readonly body: PageElement
  readonly documentElement: PageElement
  readonly createRange: () => PageRange
}
declare const getComputedStyle: (element: PageElement) => PageStyle
declare const scrollX: number
declare const scrollY: number

/** The steps of the page code, each handed the others. */
interface LayoutTools {
  readonly roundRects: (rects: ArrayLike<PageRect>) => readonly LayoutRect[]
  readonly ownText: (element: PageElement) => readonly PageText[]
  readonly ownTextRects: (element: PageElement, tools: LayoutTools) => readonly LayoutRect[]
  readonly bordersOf: (style: PageStyle) => LayoutBorders
  readonly lineHeightOf: (style: PageStyle) => number
  readonly labelOf: (element: PageElement, tools: LayoutTools) => string
  readonly describe: (element: PageElement, index: number, parent: number, tools: LayoutTools) => LayoutNode
}

const roundRects = (rects: ArrayLike<PageRect>): readonly LayoutRect[] =>
  Array.from(
    rects,
    (rect: PageRect): LayoutRect => ({
      left: Math.round(rect.left + scrollX),
      top: Math.round(rect.top + scrollY),
      right: Math.round(rect.right + scrollX),
      bottom: Math.round(rect.bottom + scrollY),
    }),
  )

const ownText = (element: PageElement): readonly PageText[] => {
  const textNodeType: number = 3
  return Array.from(element.childNodes).filter(
    (child: PageText): boolean => child.nodeType === textNodeType && (child.textContent ?? '').trim().length > 0,
  )
}

const ownTextRects = (element: PageElement, tools: LayoutTools): readonly LayoutRect[] =>
  tools.ownText(element).flatMap((text: PageText): readonly LayoutRect[] => {
    const range: PageRange = document.createRange()
    range.selectNodeContents(text)
    return tools.roundRects(range.getClientRects())
  })

const bordersOf = (style: PageStyle): LayoutBorders => {
  const side = (name: string): LayoutBorder => ({
    // A computed border width is always a pixel length, `0px` for a side drawn with no border.
    width: Number(style.getPropertyValue(`border-${name}-width`).replace('px', '')),
    style: style.getPropertyValue(`border-${name}-style`),
    color: style.getPropertyValue(`border-${name}-color`),
  })
  return { top: side('top'), right: side('right'), bottom: side('bottom'), left: side('left') }
}

// `normal` reads as NaN, which the rules take as 0: no line height to shrink a text rect to.
const lineHeightOf = (style: PageStyle): number => {
  const lineHeight: number = Number(style.getPropertyValue('line-height').replace('px', ''))
  return Number.isFinite(lineHeight) ? lineHeight : 0
}

// A tag, then the id or the first two classes, then the element's own text: `a.button "Sign in"`.
const labelOf = (element: PageElement, tools: LayoutTools): string => {
  const maxClasses: number = 2
  const maxText: number = 40
  const tag: string = element.tagName.toLowerCase()
  const name: string =
    element.id.length > 0
      ? `#${element.id}`
      : Array.from(element.classList)
          .slice(0, maxClasses)
          .map((className: string): string => `.${className}`)
          .join('')
  const text: string = tools
    .ownText(element)
    .map((node: PageText): string => node.textContent ?? '')
    .join(' ')
    .replaceAll(/\s+/gu, ' ')
    .trim()
  return text.length === 0 ? `${tag}${name}` : `${tag}${name} "${text.slice(0, maxText)}"`
}

const describe = (element: PageElement, index: number, parent: number, tools: LayoutTools): LayoutNode => {
  const style: PageStyle = getComputedStyle(element)
  const read = (property: string): string => style.getPropertyValue(property)
  const isClipping: boolean = ['hidden', 'clip'].some((value: string): boolean =>
    [read('overflow-x'), read('overflow-y')].includes(value),
  )
  return {
    index,
    parent,
    label: tools.labelOf(element, tools),
    tag: element.tagName.toLowerCase(),
    rects: tools.roundRects(element.getClientRects()),
    textRects: tools.ownTextRects(element, tools),
    lineHeight: tools.lineHeightOf(style),
    text: isClipping ? (element.textContent ?? '').trim() : '',
    display: read('display'),
    visibility: read('visibility'),
    position: read('position'),
    backgroundColor: read('background-color'),
    backgroundImage: read('background-image'),
    boxShadow: read('box-shadow'),
    borders: tools.bordersOf(style),
    isAriaHidden: element.getAttribute('aria-hidden') === 'true',
    isClipped: read('clip-path') !== 'none' || !['auto', ''].includes(read('clip')),
    overflowX: read('overflow-x'),
    overflowY: read('overflow-y'),
    textOverflow: read('text-overflow'),
    lineClamp: read('-webkit-line-clamp'),
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth,
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight,
    title: element.getAttribute('title') ?? '',
    ariaLabel: element.getAttribute('aria-label') ?? '',
    exemption: element.getAttribute('data-ploaness-layout') ?? undefined,
    exemptionReason: (element.getAttribute('data-ploaness-layout-reason') ?? '').trim(),
  }
}

/** What the page code answers: a snapshot still waiting for the route it was taken on. */
type MeasuredPage = Omit<LayoutSnapshot, 'route'>

// The element list in document order, from `<body>` down. An SVG's own drawing is not layout: the
// `<svg>` element is measured and what it draws inside is not.
const measureDocument = (tools: LayoutTools): MeasuredPage => {
  const svgNamespace: string = 'http://www.w3.org/2000/svg'
  const elements: readonly PageElement[] = [document.body, ...Array.from(document.body.querySelectorAll('*'))].filter(
    (element: PageElement): boolean =>
      element.namespaceURI !== svgNamespace || element.parentElement?.namespaceURI !== svgNamespace,
  )
  const positions: ReadonlyMap<PageElement, number> = new Map(
    elements.map((element: PageElement, index: number): readonly [PageElement, number] => [element, index]),
  )
  const root: PageElement = document.documentElement
  return {
    viewportWidth: root.clientWidth,
    viewportHeight: root.clientHeight,
    scrollWidth: root.scrollWidth,
    rootBackground: getComputedStyle(root).getPropertyValue('background-color'),
    nodes: elements.map((element: PageElement, index: number): LayoutNode => {
      const parent: PageElement | null = element.parentElement
      const parentIndex: number = parent === null ? -1 : (positions.get(parent) ?? -1)
      return tools.describe(element, index, index === 0 ? -1 : parentIndex, tools)
    }),
  }
}

const STEPS: Readonly<Record<keyof LayoutTools, (...parameters: never[]) => unknown>> = {
  roundRects,
  ownText,
  ownTextRects,
  bordersOf,
  lineHeightOf,
  labelOf,
  describe,
}

const IN_PAGE_SOURCE: string = `(${String(measureDocument)})({${Object.entries(STEPS)
  .map(([name, step]: readonly [string, unknown]): string => `${name}: ${String(step)}`)
  .join(', ')}})`

const routeOf = (page: Page): string => new URL(page.url()).pathname

const measureAt = async (page: Page, viewport: LayoutViewport): Promise<LayoutSnapshot> => {
  await page.setViewportSize(viewport)
  await settleForScan(page)
  const measured: MeasuredPage = await page.evaluate<MeasuredPage>(IN_PAGE_SOURCE)
  return { ...measured, route: routeOf(page) }
}

/**
 * Measure the page as it stands at every required viewport, and report what is wrong with its layout.
 *
 * The page is resized in place rather than reloaded, so whatever state a spec drove it into - a
 * signed-in view, an open dialog - is what gets measured. Its viewport is restored afterwards.
 * @param page the page to measure, already on the route and in the state to judge.
 * @returns one line per layout defect, empty when there is none.
 */
export const layoutDefectsOf = async (page: Page): Promise<readonly string[]> => {
  const original: LayoutViewport | null = page.viewportSize()
  const snapshots: readonly LayoutSnapshot[] = await LAYOUT_SCAN_VIEWPORTS.reduce(
    async (
      measured: Promise<readonly LayoutSnapshot[]>,
      viewport: LayoutViewport,
    ): Promise<readonly LayoutSnapshot[]> => [...(await measured), await measureAt(page, viewport)],
    Promise.resolve<readonly LayoutSnapshot[]>([]),
  )
  if (original !== null) {
    await page.setViewportSize(original)
  }
  return findLayoutDefects(snapshots, projectSettings.layoutMinimumGap)
}

/**
 * Fail the calling test when the page has a layout defect at any required viewport.
 *
 * Call it in a project's own specification for a page the sweep cannot reach - one behind a sign-in,
 * or one whose address exists only once a record does - after driving the page into the state to judge.
 * @param page the page to measure.
 * @returns nothing; it fails the test with one line per defect.
 */
export const expectNoLayoutDefects = async (page: Page): Promise<void> => {
  expect(await layoutDefectsOf(page), `layout defects on ${routeOf(page)}`).toEqual([])
}
