// How a keyboard-focused element's indicator is captured for the focus rules. The page is shot whole with
// the element focused and again with it blurred, and both are compared within the region where focus can
// show: the element and each ancestor or descendant whose look changes with it, as far as their outlines
// and shadows reach (`focusRegion`). A card that rings itself when its stretched link takes focus, or an
// icon that fills in, is judged where it draws. The page functions are self-contained: Playwright ships
// them to the page as text.
import type { Page } from '@playwright/test'
import {
  type ElementBox,
  type FocusRegion,
  focusRegion,
  hasContrastingFocus,
  hasVisibleFocus,
  type IndicatorElement,
  type IndicatorStyle,
} from '@ploaness/governance'

interface StyledElement {
  readonly getBoundingClientRect: () => ElementBox
  readonly parentElement: StyledElement | null
  readonly querySelectorAll: (selector: string) => ArrayLike<StyledElement>
  readonly setAttribute: (name: string, value: string) => void
  readonly removeAttribute: (name: string) => void
  readonly blur?: () => void
}

interface PageBitmap {
  readonly width: number
}

interface PageCanvasContext {
  drawImage: (image: PageBitmap, x: number, y: number) => void
  getImageData: (x: number, y: number, width: number, height: number) => { readonly data: Uint8ClampedArray }
}

declare const document: {
  readonly activeElement: StyledElement | null
  readonly body: StyledElement
  readonly documentElement: StyledElement
  readonly querySelector: (selector: string) => StyledElement | null
}
declare const getComputedStyle: (element: StyledElement) => IndicatorStyle
declare const CSS: { readonly escape: (value: string) => string }
declare const createImageBitmap: (image: Blob) => Promise<PageBitmap & { readonly height: number }>
declare const OffscreenCanvas: new (
  width: number,
  height: number,
) => { getContext: (kind: '2d') => PageCanvasContext | null }

/** The look of the focused element, of its ancestors and of its descendants, in that order. */
interface IndicatorFacts {
  readonly focused: StyledFacts | undefined
  readonly related: readonly StyledFacts[]
}

interface StyledFacts {
  readonly box: ElementBox
  readonly style: IndicatorStyle
}

const FOCUSED_ATTRIBUTE: string = 'data-ploaness-focused'
// Enough for any control; a container holding more is not one whose descendants draw its focus.
const MAX_DESCENDANTS: number = 200

const indicatorFactsInPage = ([selector, maxDescendants]: readonly [string, number]): IndicatorFacts => {
  const focused: StyledElement | null = document.querySelector(selector)
  if (focused === null) {
    return { focused: undefined, related: [] }
  }
  const factsOf = (element: StyledElement): StyledFacts => {
    const style: IndicatorStyle = getComputedStyle(element)
    const box: ElementBox = element.getBoundingClientRect()
    return {
      box: { left: box.left, top: box.top, right: box.right, bottom: box.bottom },
      style: {
        outlineStyle: style.outlineStyle,
        outlineWidth: style.outlineWidth,
        outlineOffset: style.outlineOffset,
        outlineColor: style.outlineColor,
        boxShadow: style.boxShadow,
        borderColor: style.borderColor,
        backgroundColor: style.backgroundColor,
        color: style.color,
        textDecorationLine: style.textDecorationLine,
      },
    }
  }
  const roots: ReadonlySet<StyledElement> = new Set<StyledElement>([document.body, document.documentElement])
  const ancestorsOf = (element: StyledElement | null): readonly StyledElement[] =>
    element === null || roots.has(element) ? [] : [element, ...ancestorsOf(element.parentElement)]
  return {
    focused: factsOf(focused),
    related: [
      ...ancestorsOf(focused.parentElement),
      ...Array.from(focused.querySelectorAll('*')).slice(0, maxDescendants),
    ].map((element: StyledElement): StyledFacts => factsOf(element)),
  }
}

const markFocusedInPage = (name: string): void => {
  document.activeElement?.setAttribute(name, '')
}

const unmarkInPage = (name: string): void => {
  document.querySelector(`[${CSS.escape(name)}]`)?.removeAttribute(name)
}

const blurInPage = (): void => {
  document.activeElement?.blur?.()
}

/**
 * A region of both renderings, decoded to RGBA and carried as base64: an array of numbers crosses from the
 * page one element at a time, which costs far more than the decoding.
 */
interface RegionRenderings {
  readonly focused: string
  readonly unfocused: string
  /** Device pixels per CSS pixel along one side; zero when the browser could not decode the shots. */
  readonly scale: number
}

// The browser decodes the screenshots it took: PNG is its own format, and Node has no decoder for it.
const regionRenderingsInPage = async ([images, region, viewportWidth]: readonly [
  readonly [string, string],
  FocusRegion,
  number,
]): Promise<RegionRenderings> => {
  const regionOf = async (image: string): Promise<{ readonly encoded: string; readonly scale: number }> => {
    const bytes: Uint8Array<ArrayBuffer> = Uint8Array.from(
      atob(image),
      (character: string): number => character.codePointAt(0) ?? 0,
    )
    const bitmap: PageBitmap & { readonly height: number } = await createImageBitmap(
      new Blob([bytes], { type: 'image/png' }),
    )
    const context: PageCanvasContext | null = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d')
    if (context === null) {
      return { encoded: '', scale: 0 }
    }
    context.drawImage(bitmap, 0, 0)
    const scale: number = bitmap.width / viewportWidth
    const { data }: { readonly data: Uint8ClampedArray } = context.getImageData(
      Math.round(region.x * scale),
      Math.round(region.y * scale),
      Math.round(region.width * scale),
      Math.round(region.height * scale),
    )
    // Converted in chunks: one call can take only so many arguments.
    const chunk: number = 32_768
    const binary: string = Array.from(
      { length: Math.ceil(data.length / chunk) },
      (_unused: unknown, index: number): string =>
        String.fromCodePoint(...data.subarray(index * chunk, (index + 1) * chunk)),
    ).join('')
    return { encoded: btoa(binary), scale }
  }
  const [focused, unfocused]: readonly [
    { readonly encoded: string; readonly scale: number },
    { readonly encoded: string; readonly scale: number },
  ] = await Promise.all([regionOf(images[0]), regionOf(images[1])])
  return { focused: focused.encoded, unfocused: unfocused.encoded, scale: Math.min(focused.scale, unfocused.scale) }
}

/** How a keyboard-focused element shows its focus. */
export type FocusVerdict = 'out of view' | 'unchanged' | 'faint' | 'contrasting'

const asIndicator = (focused: StyledFacts, unfocused: StyledFacts | undefined): IndicatorElement => ({
  box: focused.box,
  focused: focused.style,
  unfocused: (unfocused ?? focused).style,
})

const regionOf = (
  focused: IndicatorFacts,
  unfocused: IndicatorFacts,
  viewport: { readonly width: number; readonly height: number },
): FocusRegion | undefined => {
  if (focused.focused === undefined) {
    return undefined
  }
  // A tree that changed between the two readings cannot be paired element by element.
  const isPaired: boolean = focused.related.length === unfocused.related.length
  return focusRegion(
    asIndicator(focused.focused, unfocused.focused),
    isPaired
      ? focused.related.map(
          (facts: StyledFacts, index: number): IndicatorElement => asIndicator(facts, unfocused.related[index]),
        )
      : [],
    viewport,
  )
}

const BASE64: BufferEncoding = 'base64'

/** The page shot focused and blurred, with the look of the elements where focus can show in each. */
interface FocusCapture {
  readonly focusedShot: Uint8Array
  readonly unfocusedShot: Uint8Array
  readonly focusedFacts: IndicatorFacts
  readonly unfocusedFacts: IndicatorFacts
}

const captureFocus = async (page: Page): Promise<FocusCapture> => {
  const facts: readonly [string, number] = [`[${FOCUSED_ATTRIBUTE}]`, MAX_DESCENDANTS]
  await page.evaluate(markFocusedInPage, FOCUSED_ATTRIBUTE)
  const focusedFacts: IndicatorFacts = await page.evaluate(indicatorFactsInPage, facts)
  const focusedShot: Uint8Array = await page.screenshot({ animations: 'disabled', caret: 'hide' })
  await page.evaluate(blurInPage)
  const unfocusedFacts: IndicatorFacts = await page.evaluate(indicatorFactsInPage, facts)
  const unfocusedShot: Uint8Array = await page.screenshot({ animations: 'disabled', caret: 'hide' })
  await page.evaluate(unmarkInPage, FOCUSED_ATTRIBUTE)
  return { focusedShot, unfocusedShot, focusedFacts, unfocusedFacts }
}

const renderingsIn = async (
  page: Page,
  capture: FocusCapture,
  region: FocusRegion,
  viewportWidth: number,
): Promise<RegionRenderings> =>
  await page.evaluate(regionRenderingsInPage, [
    [Buffer.from(capture.focusedShot).toString(BASE64), Buffer.from(capture.unfocusedShot).toString(BASE64)],
    region,
    viewportWidth,
  ] as const)

/**
 * Shoot the page with the active element focused and again blurred, and judge its indicator where it shows.
 * The element is left blurred, as the tab walk expects.
 * @param page the page, with the element focused by keyboard.
 * @param extent the longer side of the element's visible box, which a contrasting indicator must cover half of.
 * @returns how the element shows its focus.
 */
export const judgeFocusIndicator = async (page: Page, extent: number): Promise<FocusVerdict> => {
  const viewport: { readonly width: number; readonly height: number } | null = page.viewportSize()
  const capture: FocusCapture = await captureFocus(page)
  const region: FocusRegion | undefined =
    viewport === null ? undefined : regionOf(capture.focusedFacts, capture.unfocusedFacts, viewport)
  if (viewport === null || region === undefined) {
    return 'out of view'
  }
  const renderings: RegionRenderings = await renderingsIn(page, capture, region, viewport.width)
  if (renderings.scale === 0) {
    throw new Error('the browser could not decode the focus screenshots')
  }
  const focused: Uint8Array = Buffer.from(renderings.focused, BASE64)
  const unfocused: Uint8Array = Buffer.from(renderings.unfocused, BASE64)
  if (!hasVisibleFocus(unfocused, focused)) {
    return 'unchanged'
  }
  return hasContrastingFocus({ focused, unfocused, scale: renderings.scale, extent }) ? 'contrasting' : 'faint'
}
