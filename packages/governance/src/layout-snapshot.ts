// The plain shape a browser reports about one rendered page, and the painting facts derived from it.
//
// The layout sweep measures inside the page and judges here. Everything a rule needs crosses the
// boundary as data - whole CSS pixels and computed style strings - so the rules run without a browser
// and a spec can state a defect as the numbers that make it one.

/** A box in document coordinates, rounded to whole CSS pixels. */
export interface LayoutRect {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
}

/** One side of an element's computed border. */
export interface LayoutBorder {
  readonly width: number
  readonly style: string
  readonly color: string
}

/** The four computed borders, keyed by the side they draw. */
export interface LayoutBorders {
  readonly top: LayoutBorder
  readonly right: LayoutBorder
  readonly bottom: LayoutBorder
  readonly left: LayoutBorder
}

/** The side of a box that faces a neighbour. */
export type LayoutSide = keyof LayoutBorders

/** What the page reports about one element. */
export interface LayoutNode {
  /** Document order, starting at `<body>`. */
  readonly index: number
  /** The index of the parent element, or -1 for `<body>`. */
  readonly parent: number
  /** A short selector with the element's own text, enough to find it. */
  readonly label: string
  /** The element lowercase tag name. */
  readonly tag: string
  /** One rect per box fragment: an inline element wrapped over two lines reports two. */
  readonly rects: readonly LayoutRect[]
  /** The rects of the element's own non-blank text nodes, not of its descendants'. */
  readonly textRects: readonly LayoutRect[]
  /** The computed `line-height` in CSS pixels, or 0 for `normal`. */
  readonly lineHeight: number
  /** The element's whole text, trimmed. Reported only where a clip could hide part of it. */
  readonly text: string
  readonly display: string
  readonly visibility: string
  readonly position: string
  /** The computed `z-index`: `auto` or an integer. */
  readonly zIndex: string
  /** The computed `transform`: `none` or a `matrix()` or `matrix3d()`. */
  readonly transform: string
  /** The computed `rotate` property, which `transform` does not include: `none` or an angle. */
  readonly rotate: string
  readonly backgroundColor: string
  readonly backgroundImage: string
  readonly boxShadow: string
  readonly borders: LayoutBorders
  /** Whether the element itself carries `aria-hidden="true"`. */
  readonly isAriaHidden: boolean
  /** An inert subtree is an inactive state, such as a carousel's other slides. */
  readonly isInert?: boolean
  /** Whether a `clip` or `clip-path` is set, which is how a visually hidden element is drawn. */
  readonly isClipped: boolean
  readonly overflowX: string
  readonly overflowY: string
  readonly textOverflow: string
  readonly lineClamp: string
  readonly scrollWidth: number
  readonly clientWidth: number
  readonly scrollHeight: number
  readonly clientHeight: number
  readonly title: string
  readonly ariaLabel: string
  /** The value of `data-ploaness-layout`: the rule names it exempts, or undefined when it is absent. */
  readonly exemption: string | undefined
  /** The value of `data-ploaness-layout-reason`, trimmed. */
  readonly exemptionReason: string
  /** The computed `font-size` in CSS pixels. */
  readonly fontSize: number
  /** The computed `font-family` stack. */
  readonly fontFamily: string
  /** What a replaced element reports about its content, or undefined for any other element. */
  readonly media: MediaFacts | undefined
}

/** What an image, video, frame or embed reports about the content it shows. */
export interface MediaFacts {
  /** Whether an image has finished loading; always true for an element that is not an image. */
  readonly isComplete: boolean
  /** Whether the source is a vector image, which has no fixed resolution to judge. */
  readonly isVector: boolean
  /** The pixel size of the loaded source file, unscaled by a `srcset` density; 0 when it has none. */
  readonly naturalWidth: number
  readonly naturalHeight: number
  /** The content box, inside padding and border. */
  readonly contentWidth: number
  readonly contentHeight: number
  readonly objectFit: string
  /** The box the same element takes with no source loaded: the space it reserves before loading. */
  readonly reservedWidth: number
  readonly reservedHeight: number
}

/** One `@font-face` the document declares, and how far it got. */
export interface FontFaceFacts {
  readonly family: string
  readonly status: string
  readonly weight: string
  readonly style: string
}

/** One page measured at one viewport. */
export interface LayoutSnapshot {
  readonly route: string
  readonly viewportWidth: number
  readonly viewportHeight: number
  /** The document's scroll width. */
  readonly scrollWidth: number
  /** The computed background of `<html>`, which is what `<body>` sits on. */
  readonly rootBackground: string
  readonly nodes: readonly LayoutNode[]
  /** Every `@font-face` the document declares. */
  readonly fontFaces: readonly FontFaceFacts[]
}

/** The touching-boxes rule's name, which exempts an edge shared on purpose, such as a tab joined to its panel. */
export const ATTACHED_EXEMPTION: string = 'attached'

// The canvas a page is drawn on when neither `<html>` nor any ancestor paints a background.
const CANVAS_BACKGROUND: string = 'rgb(255, 255, 255)'

const NO_BORDER_STYLES: ReadonlySet<string> = new Set<string>(['none', 'hidden'])

// Computed colours arrive as `rgb(r, g, b)`, `rgba(r, g, b, a)`, or a slash form such as
// `color(srgb r g b / a)`. Only the alpha matters here: whether the colour draws anything at all.
const COMMA_ALPHA: RegExp = /^rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)$/u
const SLASH_ALPHA: RegExp = /\/\s*([\d.]+%?)\s*\)$/u
const PERCENT: string = '%'

const alphaText = (color: string): string | undefined => COMMA_ALPHA.exec(color)?.[1] ?? SLASH_ALPHA.exec(color)?.[1]

const FULL_ALPHAS: ReadonlySet<string> = new Set<string>(['1', `100${PERCENT}`])

/**
 * Whether a computed colour hides what lies beneath it.
 * @param color a computed colour string.
 * @returns true for a colour with no alpha or a full one.
 */
export const isOpaqueColor = (color: string): boolean => {
  const alpha: string | undefined = alphaText(color.trim())
  return isVisibleColor(color) && (alpha === undefined || FULL_ALPHAS.has(alpha))
}

/**
 * Whether a computed colour draws anything.
 * @param color a computed colour string.
 * @returns false for `transparent` and any colour whose alpha is zero.
 */
export const isVisibleColor = (color: string): boolean => {
  const trimmed: string = color.trim()
  if (trimmed === 'transparent' || trimmed === '') {
    return false
  }
  const alpha: string | undefined = alphaText(trimmed)
  return alpha === undefined || Number(alpha.replace(PERCENT, '')) > 0
}

// A computed gradient spells each colour stop as a colour function. An image, a keyword left in the
// value, or a stop of partial alpha may let what lies beneath show through, so only a gradient whose
// every stop is an opaque colour function hides it.
const COLOR_FUNCTION: RegExp = /(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^()]*\)/gu
const UNKNOWN_PAINT: RegExp = /url\(|transparent|currentcolor/u

const isOpaqueGradient = (image: string): boolean => {
  const stops: readonly string[] = image.match(COLOR_FUNCTION) ?? []
  return (
    image.includes('gradient(') &&
    !UNKNOWN_PAINT.test(image) &&
    stops.length > 0 &&
    stops.every((stop: string): boolean => isOpaqueColor(stop))
  )
}

/**
 * Whether an element's own background hides what lies beneath its box.
 * @param node the element.
 * @returns true for an opaque background colour, or a gradient of opaque stops only.
 */
export const isOpaqueBackground = (node: LayoutNode): boolean =>
  isOpaqueColor(node.backgroundColor) || isOpaqueGradient(node.backgroundImage)

/**
 * The background an element sits on: the nearest ancestor that paints one, or the page canvas.
 * @param snapshot the measured page.
 * @param node the element whose surroundings are wanted.
 * @returns a computed colour string.
 */
export const surroundingBackground = (snapshot: LayoutSnapshot, node: LayoutNode): string => {
  const parent: LayoutNode | undefined = snapshot.nodes[node.parent]
  if (parent === undefined) {
    return isVisibleColor(snapshot.rootBackground) ? snapshot.rootBackground : CANVAS_BACKGROUND
  }
  return isVisibleColor(parent.backgroundColor) ? parent.backgroundColor : surroundingBackground(snapshot, parent)
}

/**
 * Whether an element paints a background that stands out from what it sits on.
 * @param snapshot the measured page.
 * @param node the element.
 * @returns true for an image or gradient, and for a visible colour unlike the surrounding one.
 */
export const hasPaintedBackground = (snapshot: LayoutSnapshot, node: LayoutNode): boolean =>
  node.backgroundImage !== 'none' ||
  (isVisibleColor(node.backgroundColor) && node.backgroundColor !== surroundingBackground(snapshot, node))

/**
 * Whether one side of an element draws a border.
 * @param node the element.
 * @param side the side asked about.
 * @returns true when the side has width, a drawn style, and a visible colour.
 */
export const hasBorderOn = (node: LayoutNode, side: LayoutSide): boolean => {
  const border: LayoutBorder = node.borders[side]
  return border.width > 0 && !NO_BORDER_STYLES.has(border.style) && isVisibleColor(border.color)
}

const SIDES: readonly LayoutSide[] = ['top', 'right', 'bottom', 'left']

/**
 * Whether an element paints anything of its own: a background, a border, or a shadow.
 * @param snapshot the measured page.
 * @param node the element.
 * @returns false for a wrapper a reader cannot see.
 */
export const hasPaintedBox = (snapshot: LayoutSnapshot, node: LayoutNode): boolean =>
  hasPaintedBackground(snapshot, node) ||
  node.boxShadow !== 'none' ||
  SIDES.some((side: LayoutSide): boolean => hasBorderOn(node, side))

/**
 * Whether an element or one of its ancestors is hidden from assistive technology.
 * @param snapshot the measured page.
 * @param node the element.
 * @returns true inside an `aria-hidden` subtree.
 */
export const isInAriaHidden = (snapshot: LayoutSnapshot, node: LayoutNode): boolean => {
  const parent: LayoutNode | undefined = snapshot.nodes[node.parent]
  return node.isAriaHidden || (parent !== undefined && isInAriaHidden(snapshot, parent))
}

/**
 * Whether an element or one of its ancestors is clipped away, as a visually hidden element is.
 * @param snapshot the measured page.
 * @param node the element.
 * @returns true inside a clipped subtree.
 */
export const isInClip = (snapshot: LayoutSnapshot, node: LayoutNode): boolean => {
  const parent: LayoutNode | undefined = snapshot.nodes[node.parent]
  return node.isClipped || (parent !== undefined && isInClip(snapshot, parent))
}

// A matrix turns a box when it moves either axis toward the other: `b` and `c` of `matrix(a, b, c, d, e,
// f)`, and the six off-diagonal terms of the column-major `matrix3d`. What is left is scaling and
// translation, under which a bounding rectangle is still the painted box.
const MATRIX: RegExp = /^matrix(3d)?\((.*)\)$/u
const TURN_EPSILON: number = 1e-6

const turnTermsOf = (terms: readonly number[], isSpatial: boolean): readonly (number | undefined)[] => {
  const [, m12, m13, , m21, , m23, , m31, m32] = terms
  return isSpatial ? [m12, m13, m21, m23, m31, m32] : [m12, m13]
}

const isTurnedTransform = (transform: string): boolean => {
  const match: RegExpExecArray | null = MATRIX.exec(transform.trim())
  if (match === null) {
    return false
  }
  const terms: readonly number[] = (match[2] ?? '').split(',').map(Number)
  return turnTermsOf(terms, match[1] !== undefined).some(
    (term: number | undefined): boolean => Math.abs(term ?? 0) > TURN_EPSILON,
  )
}

// The angle is the last word of the computed value, after any axis: `3deg`, `x 10deg`, `0 0 1 3deg`.
const ANGLE_UNIT: RegExp = /(?:deg|g?rad|turn)$/u

const isTurnedRotate = (rotate: string): boolean => {
  const angle: number = Number((rotate.trim().split(/\s+/u).at(-1) ?? '').replace(ANGLE_UNIT, ''))
  return Number.isFinite(angle) && angle !== 0
}

/**
 * Whether an element or an ancestor is rotated or skewed. Its bounding rectangles are then the upright
 * boxes around a turned shape, larger than what it paints, so no gap or overlap measured on them is real.
 * @param snapshot the measured page.
 * @param node the element.
 * @returns true inside a turned subtree.
 */
export const isInTurn = (snapshot: LayoutSnapshot, node: LayoutNode): boolean => {
  const parent: LayoutNode | undefined = snapshot.nodes[node.parent]
  return (
    isTurnedTransform(node.transform) ||
    isTurnedRotate(node.rotate) ||
    (parent !== undefined && isInTurn(snapshot, parent))
  )
}

/**
 * Whether `ancestor` contains `node`.
 * @param snapshot the measured page.
 * @param ancestor the possible ancestor.
 * @param node the possible descendant.
 * @returns true when `ancestor` is a strict ancestor of `node`.
 */
export const isAncestorOf = (snapshot: LayoutSnapshot, ancestor: LayoutNode, node: LayoutNode): boolean => {
  const parent: LayoutNode | undefined = snapshot.nodes[node.parent]
  return parent !== undefined && (parent === ancestor || isAncestorOf(snapshot, ancestor, parent))
}

/**
 * Whether a rect has area once rounded.
 * @param rect the rect.
 * @returns false for a rect with no width or no height.
 */
export const hasArea = (rect: LayoutRect): boolean => rect.right > rect.left && rect.bottom > rect.top

/**
 * Where an element sits in its document: each ancestor's tag and position among its siblings.
 *
 * The same element measured at two viewports of one page has the same key, which is how an exemption
 * is judged across both rather than at each alone.
 * @param snapshot the measured page.
 * @param node the element.
 * @returns a path such as `body/main:0/div:2`.
 */
export const keyOf = (snapshot: LayoutSnapshot, node: LayoutNode): string => {
  const parent: LayoutNode | undefined = snapshot.nodes[node.parent]
  if (parent === undefined) {
    return node.tag
  }
  const position: number = snapshot.nodes
    .filter((sibling: LayoutNode): boolean => sibling.parent === parent.index)
    .indexOf(node)
  return `${keyOf(snapshot, parent)}/${node.tag}:${String(position)}`
}

/**
 * The font faces of a page measured twice, each as loaded as it was in either measurement.
 *
 * A page cannot unload a face it has loaded, but a browser can drop what it holds of one: WebKit, after
 * a stall, can report every face of an unchanged page unloaded again while its text still renders in
 * them. A face loaded in the first measurement is therefore not judged missing in the second. Faces
 * are paired by position, so a font set that changed between the two is taken from the second as it is.
 * @param first the faces of the first measurement.
 * @param second the faces of the second.
 * @returns the faces to judge.
 */
export const heldFontFaces = (
  first: readonly FontFaceFacts[],
  second: readonly FontFaceFacts[],
): readonly FontFaceFacts[] =>
  first.length === second.length
    ? second.map((face: FontFaceFacts, index: number): FontFaceFacts => {
        const earlier: FontFaceFacts | undefined = first[index]
        return earlier?.status === 'loaded' && earlier.family === face.family && face.status === 'unloaded'
          ? { ...face, status: 'loaded' }
          : face
      })
    : second
