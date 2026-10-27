// Text that overlaps other text, text cut off by its own box, and a page wider than its viewport.
import { intersectionOf, outerBoxOf, textClippingAncestor, visibleRectsOf } from './layout-clip.js'
import {
  hasArea,
  isAncestorOf,
  isInAriaHidden,
  isInClip,
  isInTurn,
  isOpaqueBackground,
  type LayoutNode,
  type LayoutRect,
  type LayoutSnapshot,
} from './layout-snapshot.js'

/**
 * How far two text rects may intersect, in CSS pixels, before they overlap. Glyph boxes of adjacent
 * lines share a pixel row after rounding, which is a rounding artefact rather than a collision.
 */
export const TEXT_OVERLAP_TOLERANCE: number = 1

const HIDDEN_VISIBILITY: ReadonlySet<string> = new Set<string>(['hidden', 'collapse'])

// Form controls keep their value in a text node or render it themselves; neither is page text a
// reader sees laid out by the page.
const CONTROL_TAGS: ReadonlySet<string> = new Set<string>(['textarea', 'select', 'option'])

const CLIPPING_OVERFLOW: ReadonlySet<string> = new Set<string>(['hidden', 'clip'])

// A visually hidden element draws a 1px box and clips its text away on purpose.
const HIDDEN_BOX_LIMIT: number = 1

const isReadableText = (snapshot: LayoutSnapshot, node: LayoutNode): boolean =>
  node.textRects.some((rect: LayoutRect): boolean => hasArea(rect)) &&
  !CONTROL_TAGS.has(node.tag) &&
  !HIDDEN_VISIBILITY.has(node.visibility) &&
  !isInAriaHidden(snapshot, node) &&
  !isInClip(snapshot, node)

// A text rect spans the font's whole content area, its ascent and descent. A line box is `line-height`
// tall and centred on that area, so under a tight line height the content area overhangs it: two lines
// stacked with `line-height: 1` intersect as content areas while their glyphs never meet. The line box
// is what layout places, so it is what is compared. A line height of 0 is `normal`, which never
// shrinks the area.
// The leading is split evenly between the space above the content area and the space below it.
const LEADING_SIDES: number = 2

const lineBoxOf = (rect: LayoutRect, lineHeight: number): LayoutRect => {
  const height: number = rect.bottom - rect.top
  if (lineHeight <= 0 || lineHeight >= height) {
    return rect
  }
  const inset: number = (height - lineHeight) / LEADING_SIDES
  return { ...rect, top: Math.round(rect.top + inset), bottom: Math.round(rect.bottom - inset) }
}

const lineBoxesOf = (node: LayoutNode): readonly LayoutRect[] =>
  node.textRects.map((rect: LayoutRect): LayoutRect => lineBoxOf(rect, node.lineHeight))

const isIntersecting = (first: LayoutRect, second: LayoutRect): boolean => {
  const shared: LayoutRect = intersectionOf(first, second)
  return shared.right - shared.left > TEXT_OVERLAP_TOLERANCE && shared.bottom - shared.top > TEXT_OVERLAP_TOLERANCE
}

const STATIC: string = 'static'

// What of an element's text a reader can see: each line box, cut by every ancestor that clips it.
const visibleLineBoxesOf = (snapshot: LayoutSnapshot, node: LayoutNode): readonly LayoutRect[] =>
  visibleRectsOf(snapshot, node, lineBoxesOf(node))

const ancestorsOf = (snapshot: LayoutSnapshot, node: LayoutNode): readonly LayoutNode[] => {
  const parent: LayoutNode | undefined = snapshot.nodes[node.parent]
  return parent === undefined ? [] : [parent, ...ancestorsOf(snapshot, parent)]
}

const isSelfOrAncestorOf = (snapshot: LayoutSnapshot, candidate: LayoutNode, node: LayoutNode): boolean =>
  candidate === node || isAncestorOf(snapshot, candidate, node)

const stackLevelOf = (node: LayoutNode): number => (node.zIndex === 'auto' ? 0 : Number(node.zIndex) || 0)

const nearestPositioned = (snapshot: LayoutSnapshot, node: LayoutNode, other: LayoutNode): LayoutNode | undefined =>
  [node, ...ancestorsOf(snapshot, node)].find(
    (candidate: LayoutNode): boolean =>
      candidate.position !== STATIC && !isSelfOrAncestorOf(snapshot, candidate, other),
  )

const coversRegion = (outer: LayoutRect, inner: LayoutRect): boolean =>
  outer.left <= inner.left && outer.top <= inner.top && outer.right >= inner.right && outer.bottom >= inner.bottom

// Whether `cover` paints an opaque background over all of `region` without containing `under`.
const isOpaqueOver = (snapshot: LayoutSnapshot, cover: LayoutNode, under: LayoutNode, region: LayoutRect): boolean => {
  const box: LayoutRect | undefined = outerBoxOf(cover)
  return (
    box !== undefined &&
    isOpaqueBackground(cover) &&
    coversRegion(box, region) &&
    !isSelfOrAncestorOf(snapshot, cover, under)
  )
}

// Whether the positioned layer `cover` is painted in is painted after `under`'s text.
const isPaintedAfter = (snapshot: LayoutSnapshot, cover: LayoutNode, under: LayoutNode): boolean => {
  const layer: LayoutNode | undefined = nearestPositioned(snapshot, cover, under)
  if (layer === undefined) {
    return false
  }
  const beneath: LayoutNode | undefined = nearestPositioned(snapshot, under, cover)
  if (beneath === undefined) {
    return stackLevelOf(layer) >= 0
  }
  return (
    stackLevelOf(layer) > stackLevelOf(beneath) ||
    (stackLevelOf(layer) === stackLevelOf(beneath) && layer.index > beneath.index)
  )
}

// Whether `under`'s text at `region` is painted beneath an opaque background of `over` or of one of its
// ancestors, such as an open menu panel laid over the page. In one stacking context every in-flow
// background is painted before any text, so only a positioned layer covers text: it is painted after
// the in-flow content beside it, and after another positioned layer of no higher `z-index` before it in
// the document.
const isCoveredBy = (snapshot: LayoutSnapshot, under: LayoutNode, over: LayoutNode, region: LayoutRect): boolean =>
  [over, ...ancestorsOf(snapshot, over)].some(
    (cover: LayoutNode): boolean =>
      isOpaqueOver(snapshot, cover, under, region) && isPaintedAfter(snapshot, cover, under),
  )

const hasCollidingText = (snapshot: LayoutSnapshot, first: LayoutNode, second: LayoutNode): boolean =>
  visibleLineBoxesOf(snapshot, first).some((left: LayoutRect): boolean =>
    visibleLineBoxesOf(snapshot, second).some((right: LayoutRect): boolean => {
      const region: LayoutRect = intersectionOf(left, right)
      return (
        isIntersecting(left, right) &&
        !isCoveredBy(snapshot, first, second, region) &&
        !isCoveredBy(snapshot, second, first, region)
      )
    }),
  )

/** Two elements whose own text overlaps. */
export interface TextFinding {
  readonly first: LayoutNode
  readonly second: LayoutNode
}

/**
 * Every pair of unrelated elements whose visible text overlaps.
 *
 * Text inside a rotated or skewed subtree is not compared: its rects are the upright boxes around the
 * turned lines, which meet where the glyphs do not.
 * @param snapshot the measured page.
 * @returns one finding per pair, in document order.
 */
export const findOverlappingText = (snapshot: LayoutSnapshot): readonly TextFinding[] => {
  const readable: readonly LayoutNode[] = snapshot.nodes.filter(
    (node: LayoutNode): boolean => isReadableText(snapshot, node) && !isInTurn(snapshot, node),
  )
  return readable.flatMap((first: LayoutNode, index: number): readonly TextFinding[] =>
    readable
      .slice(index + 1)
      .filter(
        (second: LayoutNode): boolean =>
          !(isAncestorOf(snapshot, first, second) || isAncestorOf(snapshot, second, first)) &&
          hasCollidingText(snapshot, first, second),
      )
      .map((second: LayoutNode): TextFinding => ({ first, second })),
  )
}

/** An element whose own box cuts off part of its text. */
export interface ClipFinding {
  readonly node: LayoutNode
  /** The ancestor cutting off the text, absent for overflow of the text's own box. */
  readonly clippedBy?: LayoutNode
  /** True when the element declares truncation but names its full text nowhere a reader can reach. */
  readonly isUnnamedTruncation: boolean
}

const hasHiddenOverflowX = (node: LayoutNode): boolean =>
  CLIPPING_OVERFLOW.has(node.overflowX) && node.scrollWidth > node.clientWidth

const hasHiddenOverflowY = (node: LayoutNode): boolean =>
  CLIPPING_OVERFLOW.has(node.overflowY) && node.scrollHeight > node.clientHeight

const isVisuallyHiddenBox = (node: LayoutNode): boolean =>
  node.clientWidth <= HIDDEN_BOX_LIMIT || node.clientHeight <= HIDDEN_BOX_LIMIT

const declaresTruncation = (node: LayoutNode): boolean =>
  node.textOverflow === 'ellipsis' || (node.lineClamp !== 'none' && node.lineClamp !== '')

const hasFullTextName = (node: LayoutNode): boolean =>
  node.text.length > 0 && [node.title, node.ariaLabel].some((name: string): boolean => name.includes(node.text))

const isInactiveText = (snapshot: LayoutSnapshot, node: LayoutNode): boolean =>
  [node, ...ancestorsOf(snapshot, node)].some(
    (ancestor: LayoutNode): boolean => ancestor.isInert === true || HIDDEN_VISIBILITY.has(ancestor.visibility),
  )

const ancestorClip = (snapshot: LayoutSnapshot, node: LayoutNode): readonly ClipFinding[] => {
  const ancestor: LayoutNode | undefined = textClippingAncestor(snapshot, node, lineBoxesOf(node))
  if (ancestor === undefined || (declaresTruncation(ancestor) && hasFullTextName(ancestor))) {
    return []
  }
  return [{ node, clippedBy: ancestor, isUnnamedTruncation: declaresTruncation(ancestor) }]
}

/**
 * Every element whose text its own box or an ancestor cuts off.
 *
 * Truncation declared with an ellipsis or a line clamp is intentional when the full text is in the
 * element's `title` or `aria-label`; declared without either, it is reported as unnamed.
 * @param snapshot the measured page.
 * @returns one finding per clipping element.
 */
export const findClippedText = (snapshot: LayoutSnapshot): readonly ClipFinding[] =>
  snapshot.nodes
    .filter(
      (node: LayoutNode): boolean =>
        isReadableText(snapshot, node) &&
        !isVisuallyHiddenBox(node) &&
        !isInactiveText(snapshot, node) &&
        !isInTurn(snapshot, node),
    )
    .flatMap((node: LayoutNode): readonly ClipFinding[] => {
      if (!(hasHiddenOverflowX(node) || hasHiddenOverflowY(node))) {
        return ancestorClip(snapshot, node)
      }
      if (!declaresTruncation(node)) {
        return [{ node, isUnnamedTruncation: false }]
      }
      return hasFullTextName(node) ? [] : [{ node, isUnnamedTruncation: true }]
    })

const rightEdge = (node: LayoutNode): number =>
  Math.max(
    ...node.rects.filter((rect: LayoutRect): boolean => hasArea(rect)).map((rect: LayoutRect): number => rect.right),
  )

const isWiderThan = (node: LayoutNode, width: number): boolean =>
  node.rects.some((rect: LayoutRect): boolean => hasArea(rect)) && rightEdge(node) > width

// A scroll container keeps what overflows it inside itself, so nothing beneath it widens the page.
const isContained = (snapshot: LayoutSnapshot, node: LayoutNode): boolean => {
  const parent: LayoutNode | undefined = snapshot.nodes[node.parent]
  return parent !== undefined && (parent.overflowX !== 'visible' || isContained(snapshot, parent))
}

/**
 * The outermost elements that make the page wider than its viewport.
 *
 * An element is reported when it reaches past the viewport and its parent does not, so a wide table is
 * named once rather than with every cell inside it. A fixed element is ignored: it never widens a page.
 * @param snapshot the measured page.
 * @returns the culprits, or an empty list when the page fits or no element can be blamed.
 */
export const findOverflowingElements = (snapshot: LayoutSnapshot): readonly LayoutNode[] =>
  snapshot.nodes.filter((node: LayoutNode): boolean => {
    const parent: LayoutNode | undefined = snapshot.nodes[node.parent]
    return (
      node.position !== 'fixed' &&
      isWiderThan(node, snapshot.viewportWidth) &&
      !isContained(snapshot, node) &&
      (parent === undefined || !isWiderThan(parent, snapshot.viewportWidth))
    )
  })
