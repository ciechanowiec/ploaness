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
