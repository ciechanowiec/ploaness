// Where a focus indicator can show. The focus rules compare the page focused and unfocused within one
// region, so the region has to hold the whole indicator: an outline drawn at an offset or a ring drawn as a
// shadow beyond a gap lies outside the element's box, and an indicator another element draws - the card
// around a stretched link, the icon inside a button - lies wherever that element is.
import { FOCUS_RING_WIDTH } from './browser-rules.js'

/** The styles of an element that can show focus, as the browser computes them. */
export interface IndicatorStyle {
  readonly outlineStyle: string
  readonly outlineWidth: string
  readonly outlineOffset: string
  readonly outlineColor: string
  readonly boxShadow: string
  readonly borderColor: string
  readonly backgroundColor: string
  readonly color: string
  readonly textDecorationLine: string
}

// A computed shadow list writes each shadow's lengths together, before or after its colour, so splitting it
// at every comma - a colour's own commas included - leaves each shadow's lengths, and its `inset`, in one
// piece; a piece holding a colour's channels alone has no lengths and reaches nowhere.
const PIXELS: string = 'px'
const HORIZONTAL: number = 0
const VERTICAL: number = 1
const BLUR: number = 2
const SPREAD: number = 3
// The edge of an indicator at a fractional position is drawn into one more pixel.
const ANTIALIASING_PX: number = 1

const pixelsOf = (length: string): number => Number(length.slice(0, -PIXELS.length)) || 0

const pieceReach = (piece: string): number => {
  const tokens: readonly string[] = piece.trim().split(' ')
  if (tokens.includes('inset')) {
    return 0
  }
  const lengths: readonly number[] = tokens
    .filter((token: string): boolean => token.endsWith(PIXELS))
    .map((token: string): number => pixelsOf(token))
  const offset: number = Math.max(Math.abs(lengths[HORIZONTAL] ?? 0), Math.abs(lengths[VERTICAL] ?? 0))
  return Math.max(0, offset + (lengths[BLUR] ?? 0) + (lengths[SPREAD] ?? 0))
}

/**
 * How far beyond its box a focused element's outline and outer shadows reach.
 * @param style the element's computed outline and box shadow while focused.
 * @returns the reach in CSS pixels, never less than `FOCUS_RING_WIDTH`.
 */
export const indicatorReach = (style: IndicatorStyle): number => {
  const outline: number =
    style.outlineStyle === 'none' ? 0 : pixelsOf(style.outlineWidth) + pixelsOf(style.outlineOffset)
  const shadows: readonly number[] =
    style.boxShadow === 'none' ? [] : style.boxShadow.split(',').map((piece: string): number => pieceReach(piece))
  const reach: number = Math.max(0, outline, ...shadows)
  return Math.max(FOCUS_RING_WIDTH, Math.ceil(reach) + (reach > 0 ? ANTIALIASING_PX : 0))
}

/** An element's box in the viewport, in CSS pixels. */
export interface ElementBox {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
}

/** An element where focus can show: its box, and its styles with the focused element focused and not. */
export interface IndicatorElement {
  readonly box: ElementBox
  readonly focused: IndicatorStyle
  readonly unfocused: IndicatorStyle
}

/** A region of the viewport, in whole CSS pixels. */
export interface FocusRegion {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

const INDICATOR_PROPERTIES: readonly (keyof IndicatorStyle)[] = [
  'outlineStyle',
  'outlineWidth',
  'outlineOffset',
  'outlineColor',
  'boxShadow',
  'borderColor',
  'backgroundColor',
  'color',
  'textDecorationLine',
]

const isRestyled = (element: IndicatorElement): boolean =>
  INDICATOR_PROPERTIES.some(
    (property: keyof IndicatorStyle): boolean => element.focused[property] !== element.unfocused[property],
  )

const reachedBox = (element: IndicatorElement): ElementBox => {
  const reach: number = Math.max(indicatorReach(element.focused), indicatorReach(element.unfocused))
  return {
    left: element.box.left - reach,
    top: element.box.top - reach,
    right: element.box.right + reach,
    bottom: element.box.bottom + reach,
  }
}

/**
 * The region of the viewport a focus indicator can show in: the focused element, and each element beside
 * it - an ancestor or a descendant - whose outline, shadow, border, background, text colour or decoration
 * changes with focus, each with as far as its outline and shadows reach.
 * @param focused the focused element.
 * @param related its ancestors and descendants.
 * @param viewport the viewport's size.
 * @param viewport.width its width in CSS pixels.
 * @param viewport.height its height in CSS pixels.
 * @returns the region, or undefined when none of it is in the viewport.
 */
export const focusRegion = (
  focused: IndicatorElement,
  related: readonly IndicatorElement[],
  viewport: { readonly width: number; readonly height: number },
): FocusRegion | undefined => {
  const boxes: readonly ElementBox[] = [
    focused,
    ...related.filter((element: IndicatorElement): boolean => isRestyled(element)),
  ].map((element: IndicatorElement): ElementBox => reachedBox(element))
  const lefts: readonly number[] = boxes.map((box: ElementBox): number => box.left)
  const tops: readonly number[] = boxes.map((box: ElementBox): number => box.top)
  const rights: readonly number[] = boxes.map((box: ElementBox): number => box.right)
  const bottoms: readonly number[] = boxes.map((box: ElementBox): number => box.bottom)
  const left: number = Math.max(0, Math.floor(Math.min(...lefts)))
  const top: number = Math.max(0, Math.floor(Math.min(...tops)))
  const right: number = Math.min(viewport.width, Math.ceil(Math.max(...rights)))
  const bottom: number = Math.min(viewport.height, Math.ceil(Math.max(...bottoms)))
  return right - left < 1 || bottom - top < 1
    ? undefined
    : { x: left, y: top, width: right - left, height: bottom - top }
}
