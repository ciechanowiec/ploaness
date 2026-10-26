// How far a focused element's own indicator reaches beyond its box. The focus rules compare the element
// focused and unfocused within its box and a margin, so the margin has to hold the whole indicator: an
// outline drawn at an offset, or a ring drawn as a shadow beyond a gap of the page's background, lies
// outside a fixed margin and would be judged as if it were not there.
import { FOCUS_RING_WIDTH } from './browser-rules.js'

/** The focused element's outline and shadows, as the browser computes them. */
export interface IndicatorStyle {
  readonly outlineStyle: string
  readonly outlineWidth: string
  readonly outlineOffset: string
  readonly boxShadow: string
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
