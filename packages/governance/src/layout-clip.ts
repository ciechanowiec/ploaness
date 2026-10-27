// What of an element's boxes a reader can see once every ancestor that clips them has cut them.

import { hasArea, type LayoutNode, type LayoutRect, type LayoutSnapshot } from './layout-snapshot.js'

/**
 * The rectangle two rectangles share; a side crossing its opposite means they share nothing.
 * @param first one rectangle.
 * @param second the other.
 * @returns the shared rectangle, with no area when they are apart.
 */
export const intersectionOf = (first: LayoutRect, second: LayoutRect): LayoutRect => ({
  left: Math.max(first.left, second.left),
  top: Math.max(first.top, second.top),
  right: Math.min(first.right, second.right),
  bottom: Math.min(first.bottom, second.bottom),
})

/**
 * The rectangle around every box of an element that has area.
 * @param node the element.
 * @returns the rectangle, or undefined when no box has area.
 */
export const outerBoxOf = (node: LayoutNode): LayoutRect | undefined => {
  const rects: readonly LayoutRect[] = node.rects.filter((rect: LayoutRect): boolean => hasArea(rect))
  return rects.length === 0
    ? undefined
    : {
        left: Math.min(...rects.map((rect: LayoutRect): number => rect.left)),
        top: Math.min(...rects.map((rect: LayoutRect): number => rect.top)),
        right: Math.max(...rects.map((rect: LayoutRect): number => rect.right)),
        bottom: Math.max(...rects.map((rect: LayoutRect): number => rect.bottom)),
      }
}

const STATIC: string = 'static'

// An ancestor whose overflow is not visible clips along that axis, inside its borders. Unbounded sides
// stay unbounded, so a clip on one axis leaves the other alone.
const clipOf = (node: LayoutNode): LayoutRect | undefined => {
  const box: LayoutRect | undefined = outerBoxOf(node)
  const isClippingX: boolean = node.overflowX !== 'visible'
  const isClippingY: boolean = node.overflowY !== 'visible'
  if (box === undefined || !(isClippingX || isClippingY)) {
    return undefined
  }
  return {
    left: isClippingX ? box.left + node.borders.left.width : Number.NEGATIVE_INFINITY,
    right: isClippingX ? box.right - node.borders.right.width : Number.POSITIVE_INFINITY,
    top: isClippingY ? box.top + node.borders.top.width : Number.NEGATIVE_INFINITY,
    bottom: isClippingY ? box.bottom - node.borders.bottom.width : Number.POSITIVE_INFINITY,
  }
}

// Which ancestors may clip an element: all of them for an element in flow, only those from its
// containing block up for an absolute one, none for a fixed one.
type ClipReach = 'all' | 'none' | 'positioned'

const reachPast = (ancestor: LayoutNode, reach: ClipReach): ClipReach => {
  if (ancestor.position === 'fixed') {
    return 'none'
  }
  if (ancestor.position === 'absolute') {
    return 'positioned'
  }
  if (reach === 'positioned') {
    return ancestor.position === STATIC ? 'positioned' : 'all'
  }
  return reach
}

const clipsAbove = (snapshot: LayoutSnapshot, node: LayoutNode, reach: ClipReach): readonly LayoutRect[] => {
  const parent: LayoutNode | undefined = snapshot.nodes[node.parent]
  if (parent === undefined || reach === 'none') {
    return []
  }
  const clip: LayoutRect | undefined = reach === 'all' || parent.position !== STATIC ? clipOf(parent) : undefined
  return [...(clip === undefined ? [] : [clip]), ...clipsAbove(snapshot, parent, reachPast(parent, reach))]
}

/**
 * Rectangles drawn by an element, cut by every ancestor that clips it. A scroll container's overflow is
 * out of sight until it is scrolled, so what lies past its edge touches and collides with nothing.
 * @param snapshot the measured page.
 * @param node the element the rectangles belong to.
 * @param rects its rectangles: its boxes, its line boxes, or what its content shows.
 * @returns the visible part of each rectangle that keeps any area.
 */
export const visibleRectsOf = (
  snapshot: LayoutSnapshot,
  node: LayoutNode,
  rects: readonly LayoutRect[],
): readonly LayoutRect[] => {
  const clips: readonly LayoutRect[] = clipsAbove(snapshot, node, reachPast(node, 'all'))
  return rects
    .map(
      (rect: LayoutRect): LayoutRect =>
        clips.reduce((clipped: LayoutRect, clip: LayoutRect): LayoutRect => intersectionOf(clipped, clip), rect),
    )
    .filter((rect: LayoutRect): boolean => hasArea(rect))
}

interface TextClip {
  readonly node: LayoutNode
  readonly rects: readonly LayoutRect[]
  readonly reach: ClipReach
}

const HIDDEN_OVERFLOW: ReadonlySet<string> = new Set<string>(['hidden', 'clip'])
const CLIP_TOLERANCE: number = 1

const isCuttingText = (node: LayoutNode, box: LayoutRect, text: LayoutRect): boolean =>
  (HIDDEN_OVERFLOW.has(node.overflowX) &&
    (text.left < box.left - CLIP_TOLERANCE || text.right > box.right + CLIP_TOLERANCE)) ||
  (HIDDEN_OVERFLOW.has(node.overflowY) &&
    (text.top < box.top - CLIP_TOLERANCE || text.bottom > box.bottom + CLIP_TOLERANCE))

const intersectingRects = (rects: readonly LayoutRect[], clip: LayoutRect | undefined): readonly LayoutRect[] =>
  clip === undefined
    ? rects
    : rects
        .map((rect: LayoutRect): LayoutRect => intersectionOf(rect, clip))
        .filter((rect: LayoutRect): boolean => hasArea(rect))

const clippingAncestor = (snapshot: LayoutSnapshot, current: TextClip): LayoutNode | undefined => {
  const parent: LayoutNode | undefined = snapshot.nodes[current.node.parent]
  if (parent === undefined || current.reach === 'none' || current.rects.length === 0) {
    return undefined
  }
  const clip: LayoutRect | undefined =
    current.reach === 'all' || parent.position !== STATIC ? clipOf(parent) : undefined
  if (clip !== undefined && current.rects.some((rect: LayoutRect): boolean => isCuttingText(parent, clip, rect))) {
    return parent
  }
  return clippingAncestor(snapshot, {
    node: parent,
    reach: reachPast(parent, current.reach),
    rects: intersectingRects(current.rects, clip),
  })
}

/**
 * Find the ancestor hiding text a reader cannot scroll into view. Scrollable ancestors first trim
 * the comparison to their visible content, so their off-screen items are not mistaken for lost text.
 * @param snapshot the measured page.
 * @param node the text's element.
 * @param rects its line boxes.
 * @returns the first clipping ancestor, if any.
 */
export const textClippingAncestor = (
  snapshot: LayoutSnapshot,
  node: LayoutNode,
  rects: readonly LayoutRect[],
): LayoutNode | undefined => clippingAncestor(snapshot, { node, rects, reach: reachPast(node, 'all') })
