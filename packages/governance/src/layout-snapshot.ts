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
  readonly backgroundColor: string
  readonly backgroundImage: string
  readonly boxShadow: string
  readonly borders: LayoutBorders
  /** Whether the element itself carries `aria-hidden="true"`. */
  readonly isAriaHidden: boolean
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
  /** The value of `data-ploaness-layout`, or undefined when the attribute is absent. */
  readonly exemption: string | undefined
  /** The value of `data-ploaness-layout-reason`, trimmed. */
  readonly exemptionReason: string
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
}

/** The only exemption value: an edge shared on purpose, such as a tab joined to its panel. */
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
