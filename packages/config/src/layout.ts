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
import type { Page } from '@playwright/test'
import {
  type FontFaceFacts,
  type LayoutBorder,
  type LayoutBorders,
  type LayoutNode,
  type LayoutRect,
  type LayoutSnapshot,
  type LayoutViewport,
  layoutViewportsWith,
  type MediaFacts,
} from '@ploaness/governance'
import { projectSettings } from './project-settings.js'

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

interface PageBox {
  readonly width: number
  readonly height: number
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
  readonly contains: (other: PageElement) => boolean
  readonly getClientRects: () => ArrayLike<PageRect>
  readonly querySelector: (selectors: string) => PageElement | null
  readonly querySelectorAll: (selectors: string) => ArrayLike<PageElement>
  readonly children: ArrayLike<PageElement>
  readonly getBoundingClientRect: () => PageBox
  readonly cloneNode: (isDeep: boolean) => PageElement
  readonly removeAttribute: (name: string) => void
  readonly setAttribute: (name: string, value: string) => void
  readonly before: (node: PageElement) => void
  readonly remove: () => void
  readonly complete?: boolean
  readonly naturalWidth?: number
  readonly naturalHeight?: number
  readonly currentSrc?: string
}

declare const document: {
  readonly body: PageElement
  readonly documentElement: PageElement
  readonly createRange: () => PageRange
  readonly fonts: Iterable<FontFaceFacts> | undefined
  readonly activeElement: PageElement | null
  readonly querySelector: (selectors: string) => PageElement | null
  readonly querySelectorAll: (selectors: string) => ArrayLike<PageElement>
}
declare const getComputedStyle: (element: PageElement) => PageStyle
declare const Image: new () => {
  readonly setAttribute: (name: string, value: string) => void
  readonly naturalWidth: number
  readonly naturalHeight: number
  readonly decode: () => Promise<void>
}
declare const scrollX: number
declare const scrollY: number

/** The pixel size of each source file an image shows through a `srcset`, by its URL. */
type SourceSizes = ReadonlyMap<string, PageBox>

/** Where an element sits among the measured elements, and the source sizes its media are judged by. */
interface NodeContext {
  readonly index: number
  readonly parent: number
  readonly sources: SourceSizes
}

/** The steps of the page code, each handed the others. */
interface LayoutTools {
  readonly isClosedDetails: (element: PageElement) => boolean
  readonly isHiddenByDisclosure: (element: PageElement, tools: LayoutTools) => boolean
  readonly isOutsideView: (element: PageElement) => boolean
  readonly roundRects: (rects: ArrayLike<PageRect>) => readonly LayoutRect[]
  readonly ownText: (element: PageElement, tools: LayoutTools) => readonly PageText[]
  readonly ownTextRects: (element: PageElement, tools: LayoutTools) => readonly LayoutRect[]
  readonly bordersOf: (style: PageStyle) => LayoutBorders
  readonly lineHeightOf: (style: PageStyle) => number
  readonly labelOf: (element: PageElement, tools: LayoutTools) => string
  readonly paintOrderOf: (style: PageStyle) => Pick<LayoutNode, 'rotate' | 'transform' | 'zIndex'>
  readonly describe: (element: PageElement, context: NodeContext, tools: LayoutTools) => LayoutNode
  readonly reservedBoxOf: (element: PageElement) => PageBox
  readonly contentSizeOf: (box: PageBox, style: PageStyle) => Pick<MediaFacts, 'contentHeight' | 'contentWidth'>
  readonly loadedSourceOf: (
    element: PageElement,
    sources: SourceSizes,
  ) => Pick<MediaFacts, 'isVector' | 'naturalHeight' | 'naturalWidth'>
  readonly mediaOf: (
    element: PageElement,
    style: PageStyle,
    sources: SourceSizes,
    tools: LayoutTools,
  ) => MediaFacts | undefined
  readonly sourceSizesOf: () => Promise<SourceSizes>
  readonly measuredElements: (tools: LayoutTools) => readonly PageElement[]
  readonly fontFacesOf: () => readonly FontFaceFacts[]
  readonly keyOfElement: (element: PageElement, tools: LayoutTools) => string
}

/** An exemption on an element a finding names, or on one of its ancestors. */
export interface TargetExemption {
  readonly key: string
  readonly label: string
  /** The raw attribute value: the rule names. */
  readonly rules: string
  readonly reason: string
}

/** One element a finding names, as the page describes it. */
export interface TargetFacts {
  readonly label: string
  readonly key: string
  /** Every exemption on it or an ancestor, nearest first. */
  readonly exemptions: readonly TargetExemption[]
}

const isClosedDetails = (element: PageElement): boolean =>
  element.tagName.toLowerCase() === 'details' && element.getAttribute('open') === null

// The first direct summary stays visible. Every other branch of a closed disclosure is unpainted,
// even when an inner disclosure is open or a browser reports nonempty rectangles for its text.
const isHiddenByDisclosure = (element: PageElement, tools: LayoutTools): boolean => {
  const parent: PageElement | null = element.parentElement
  if (parent === null) {
    return false
  }
  const isClosedBody: boolean = tools.isClosedDetails(parent) && parent.querySelector(':scope > summary') !== element
  return isClosedBody || tools.isHiddenByDisclosure(parent, tools)
}

// Outside a marked view only the ancestors that hold it are measured; on a page with no mark, every
// element is. The attribute is spelt out because this runs in the page: `payload-view.ts` sets it.
const isOutsideView = (element: PageElement): boolean => {
  const roots: readonly PageElement[] = Array.from(document.querySelectorAll('[data-ploaness-view]'))
  return (
    roots.length > 0 && !roots.some((root: PageElement): boolean => root.contains(element) || element.contains(root))
  )
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

const ownText = (element: PageElement, tools: LayoutTools): readonly PageText[] => {
  if (tools.isClosedDetails(element)) {
    return []
  }
  const textNodeType: number = 3
  return Array.from(element.childNodes).filter(
    (child: PageText): boolean => child.nodeType === textNodeType && (child.textContent ?? '').trim().length > 0,
  )
}

const ownTextRects = (element: PageElement, tools: LayoutTools): readonly LayoutRect[] =>
  tools.ownText(element, tools).flatMap((text: PageText): readonly LayoutRect[] => {
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
    .ownText(element, tools)
    .map((node: PageText): string => node.textContent ?? '')
    .join(' ')
    .replaceAll(/\s+/gu, ' ')
    .trim()
  return text.length === 0 ? `${tag}${name}` : `${tag}${name} "${text.slice(0, maxText)}"`
}

// What decides how an element is painted against the others: its stacking order and any turn.
const paintOrderOf = (style: PageStyle): Pick<LayoutNode, 'rotate' | 'transform' | 'zIndex'> => ({
  zIndex: style.getPropertyValue('z-index'),
  transform: style.getPropertyValue('transform'),
  rotate: style.getPropertyValue('rotate'),
})

const describe = (element: PageElement, context: NodeContext, tools: LayoutTools): LayoutNode => {
  const style: PageStyle = getComputedStyle(element)
  const read = (property: string): string => style.getPropertyValue(property)
  const attribute = (name: string): string => element.getAttribute(name) ?? ''
  const isClipping: boolean = ['hidden', 'clip'].some((value: string): boolean =>
    [read('overflow-x'), read('overflow-y')].includes(value),
  )
  return {
    index: context.index,
    parent: context.parent,
    label: tools.labelOf(element, tools),
    tag: element.tagName.toLowerCase(),
    rects: tools.roundRects(element.getClientRects()),
    textRects: tools.ownTextRects(element, tools),
    lineHeight: tools.lineHeightOf(style),
    text: isClipping ? (element.textContent ?? '').trim() : '',
    display: read('display'),
    visibility: read('visibility'),
    position: read('position'),
    ...tools.paintOrderOf(style),
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
    title: attribute('title'),
    ariaLabel: attribute('aria-label'),
    exemption: element.getAttribute('data-ploaness-layout') ?? undefined,
    exemptionReason: attribute('data-ploaness-layout-reason').trim(),
    fontSize: Number(read('font-size').replace('px', '')) || 0,
    fontFamily: read('font-family'),
    media: tools.mediaOf(element, style, context.sources, tools),
  }
}

// The space a replaced element reserves before its source arrives is the box the same element takes
// with no source at all. A shallow copy with every source removed takes the element's own slot while the
// element is out of layout, and is read and removed again in the same task, so nothing is painted. Laid
// out beside the element instead, a flex or grid row would share its space between the two.
const reservedBoxOf = (element: PageElement): PageBox => {
  const placeholder: PageElement = element.cloneNode(false)
  for (const source of ['src', 'srcset', 'poster', 'srcdoc', 'data']) {
    placeholder.removeAttribute(source)
  }
  placeholder.removeAttribute('id')
  placeholder.setAttribute('alt', '')
  placeholder.setAttribute('aria-hidden', 'true')
  const ownStyle: string | null = element.getAttribute('style')
  placeholder.setAttribute('style', `${ownStyle ?? ''};visibility:hidden`)
  element.setAttribute('style', `${ownStyle ?? ''};display:none`)
  element.before(placeholder)
  const measured: PageBox = placeholder.getBoundingClientRect()
  placeholder.remove()
  if (ownStyle === null) {
    element.removeAttribute('style')
  } else {
    element.setAttribute('style', ownStyle)
  }
  return measured
}

const contentSizeOf = (box: PageBox, style: PageStyle): Pick<MediaFacts, 'contentHeight' | 'contentWidth'> => {
  const pixels = (property: string): number => Number(style.getPropertyValue(property).replace('px', '')) || 0
  const inset = (first: string, second: string): number =>
    pixels(`padding-${first}`) +
    pixels(`padding-${second}`) +
    pixels(`border-${first}-width`) +
    pixels(`border-${second}-width`)
  return {
    contentWidth: Math.round(box.width - inset('left', 'right')),
    contentHeight: Math.round(box.height - inset('top', 'bottom')),
  }
}

// The source an element shows, and its pixel size: the file's own where it was decoded alone.
const loadedSourceOf = (
  element: PageElement,
  sources: SourceSizes,
): Pick<MediaFacts, 'isVector' | 'naturalHeight' | 'naturalWidth'> => {
  const source: string = element.currentSrc ?? element.getAttribute('src') ?? ''
  const file: PageBox = sources.get(source) ?? {
    width: element.naturalWidth ?? 0,
    height: element.naturalHeight ?? 0,
  }
  return {
    isVector: /\.svg(?:[?#]|$)|^data:image\/svg/iu.test(source),
    naturalWidth: file.width,
    naturalHeight: file.height,
  }
}

const mediaOf = (
  element: PageElement,
  style: PageStyle,
  sources: SourceSizes,
  tools: LayoutTools,
): MediaFacts | undefined => {
  const tag: string = element.tagName.toLowerCase()
  if (!['img', 'video', 'iframe', 'embed', 'object'].includes(tag)) {
    return undefined
  }
  const box: PageBox = element.getBoundingClientRect()
  const reserved: PageBox = tools.reservedBoxOf(element)
  return {
    isComplete: tag !== 'img' || element.complete === true,
    ...tools.loadedSourceOf(element, sources),
    ...tools.contentSizeOf(box, style),
    objectFit: style.getPropertyValue('object-fit'),
    reservedWidth: Math.round(reserved.width),
    reservedHeight: Math.round(reserved.height),
  }
}

// An image chosen from a `srcset` reports its natural size divided by the density the browser assigned
// the candidate, which is the candidate's declared width over the slot `sizes` gives it. A server that
// will not enlarge a small original sends fewer pixels than the declared width, so that size understates
// the file. The same URL decoded by an image of its own, with no `srcset`, reports the file's pixels.
const sourceSizesOf = async (): Promise<SourceSizes> => {
  const sources: readonly string[] = [
    ...new Set(
      Array.from(document.body.querySelectorAll('img'))
        .filter(
          (image: PageElement): boolean =>
            image.getAttribute('srcset') !== null || image.parentElement?.tagName.toLowerCase() === 'picture',
        )
        .map((image: PageElement): string => image.currentSrc ?? '')
        .filter((source: string): boolean => source.length > 0),
    ),
  ]
  const sized: readonly (readonly [string, PageBox] | undefined)[] = await Promise.all(
    sources.map(async (source: string): Promise<readonly [string, PageBox] | undefined> => {
      const probe: InstanceType<typeof Image> = new Image()
      probe.setAttribute('src', source)
      try {
        await probe.decode()
        return [source, { width: probe.naturalWidth, height: probe.naturalHeight }]
      } catch {
        return undefined
      }
    }),
  )
  return new Map(
    sized.filter(
      (entry: readonly [string, PageBox] | undefined): entry is readonly [string, PageBox] => entry !== undefined,
    ),
  )
}

// The width sweep measures only geometry, so it skips the media placeholders and the font set.
const noMedia = (): undefined => undefined

const noSourceSizes = (): Promise<SourceSizes> => Promise.resolve(new Map())

const noFontFaces = (): readonly FontFaceFacts[] => []

const fontFacesOf = (): readonly FontFaceFacts[] =>
  Array.from(
    document.fonts ?? [],
    (face: FontFaceFacts): FontFaceFacts => ({
      family: face.family,
      status: face.status,
      weight: face.weight,
      style: face.style,
    }),
  )

// The element list in document order, from `<body>` down. An SVG's own drawing is not layout: the
// `<svg>` element is measured and what it draws inside is not. Shared by the measurement and by the
// outline a failure screenshot draws, so a node index names the same element in both.
const measuredElements = (tools: LayoutTools): readonly PageElement[] => {
  const svgNamespace: string = 'http://www.w3.org/2000/svg'
  return [document.body, ...Array.from(document.body.querySelectorAll('*'))].filter(
    (element: PageElement): boolean =>
      (element.namespaceURI !== svgNamespace || element.parentElement?.namespaceURI !== svgNamespace) &&
      !tools.isHiddenByDisclosure(element, tools) &&
      !tools.isOutsideView(element),
  )
}

/** What the page code answers: a snapshot still waiting for the route it was taken on. */
type MeasuredPage = Omit<LayoutSnapshot, 'route'>

const measureDocument = async (tools: LayoutTools): Promise<MeasuredPage> => {
  // Decoded first, so the measurement below runs in one task with nothing awaited inside it.
  const sources: SourceSizes = await tools.sourceSizesOf()
  const elements: readonly PageElement[] = tools.measuredElements(tools)
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
      return tools.describe(element, { index, parent: index === 0 ? -1 : parentIndex, sources }, tools)
    }),
    fontFaces: tools.fontFacesOf(),
  }
}

// Where an element sits among the measured elements, spelt as `keyOf` spells it in governance: each
// ancestor's tag and position among its measured siblings.
const keyOfElement = (element: PageElement, tools: LayoutTools): string => {
  const parent: PageElement | null = element.parentElement
  const tag: string = element.tagName.toLowerCase()
  if (parent === null || element === document.body) {
    return tag
  }
  const measured: readonly PageElement[] = tools.measuredElements(tools)
  const siblings: readonly PageElement[] = Array.from(parent.children).filter((child: PageElement): boolean =>
    measured.includes(child),
  )
  return `${tools.keyOfElement(parent, tools)}/${tag}:${String(siblings.indexOf(element))}`
}

// One element named for a finding: its label, its key, and every exemption on it or an ancestor,
// nearest first. The focused element when no selector is given.
const describeTarget = (tools: LayoutTools, selector: string | null): TargetFacts | undefined => {
  const target: PageElement | null = selector === null ? document.activeElement : document.querySelector(selector)
  if (target === null || target === document.body) {
    return undefined
  }
  const chain = (element: PageElement | null): readonly TargetExemption[] => {
    if (element === null) {
      return []
    }
    const rules: string | null = element.getAttribute('data-ploaness-layout')
    const own: readonly TargetExemption[] =
      rules === null
        ? []
        : [
            {
              key: tools.keyOfElement(element, tools),
              label: tools.labelOf(element, tools),
              rules,
              reason: (element.getAttribute('data-ploaness-layout-reason') ?? '').trim(),
            },
          ]
    return [...own, ...chain(element.parentElement)]
  }
  return {
    label: tools.labelOf(target, tools),
    key: tools.keyOfElement(target, tools),
    exemptions: chain(target),
  }
}

// Marks the measured elements a failure names, for the screenshot that shows them.
const outlineDocument = (tools: LayoutTools, indices: readonly number[]): void => {
  const marker: string = 'data-ploaness-outline'
  const elements: readonly PageElement[] = tools.measuredElements(tools)
  for (const index of indices) {
    elements[index]?.setAttribute(marker, '')
  }
}

type Step = (...parameters: never[]) => unknown

const STEPS: Readonly<Record<keyof LayoutTools, Step>> = {
  isClosedDetails,
  isHiddenByDisclosure,
  isOutsideView,
  roundRects,
  ownText,
  ownTextRects,
  bordersOf,
  lineHeightOf,
  labelOf,
  paintOrderOf,
  describe,
  reservedBoxOf,
  contentSizeOf,
  loadedSourceOf,
  mediaOf,
  sourceSizesOf,
  measuredElements,
  fontFacesOf,
  keyOfElement,
}

const toolsSource = (steps: Readonly<Record<keyof LayoutTools, Step>>): string =>
  `{${Object.entries(steps)
    .map(([name, step]: readonly [string, unknown]): string => `${name}: ${String(step)}`)
    .join(', ')}}`

const IN_PAGE_SOURCE: string = `(${String(measureDocument)})(${toolsSource(STEPS)})`

const MINIMAL_SOURCE: string = `(${String(measureDocument)})(${toolsSource({
  ...STEPS,
  mediaOf: noMedia,
  sourceSizesOf: noSourceSizes,
  fontFacesOf: noFontFaces,
})})`

const OUTLINE_STYLE: string =
  '[data-ploaness-outline] { outline: 3px solid #e00 !important; outline-offset: 1px !important; }'

/**
 * Measure the page as it stands, at its current viewport.
 * @param page the page, settled on the route and in the state to measure.
 * @param route the location to record the snapshot under.
 * @param isMinimal whether to measure geometry alone, without media and fonts.
 * @returns the snapshot.
 */
export const measurePage = async (page: Page, route: string, isMinimal: boolean = false): Promise<LayoutSnapshot> => {
  const measured: MeasuredPage = await page.evaluate<MeasuredPage>(isMinimal ? MINIMAL_SOURCE : IN_PAGE_SOURCE)
  return { ...measured, route }
}

/**
 * Outline the measured elements a failure names, for the screenshot that shows them.
 * @param page the page, unchanged since it was measured.
 * @param indices the measured-node indices.
 */
export const outlineElements = async (page: Page, indices: readonly number[]): Promise<void> => {
  await page.addStyleTag({ content: OUTLINE_STYLE })
  await page.evaluate(`(${String(outlineDocument)})(${toolsSource(STEPS)}, ${JSON.stringify(indices)})`)
}

/**
 * Describe one element for a finding: the focused element, or the first matching a selector.
 * @param page the page.
 * @param selector the element to describe, or null for the focused element.
 * @returns its label, key and exemptions, or undefined when there is no such element.
 */
export const targetFacts = async (page: Page, selector: string | null): Promise<TargetFacts | undefined> =>
  await page.evaluate<TargetFacts | undefined>(
    `(${String(describeTarget)})(${toolsSource(STEPS)}, ${JSON.stringify(selector)})`,
  )
