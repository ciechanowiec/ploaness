// Boxed siblings that touch or overlap.
//
// A box a reader can see - a tinted notice, a bordered card, a button - needs space between it and its
// neighbour, or the two read as one broken shape. Two elements are compared when they are siblings
// once every wrapper that paints nothing has been looked through: `<p><a class="button">` beside a
// notice is the button beside the notice, because the paragraph around it draws nothing a reader sees.
import {
  ATTACHED_EXEMPTION,
  hasArea,
  hasBorderOn,
  hasPaintedBackground,
  hasPaintedBox,
  isInAriaHidden,
  type LayoutNode,
  type LayoutRect,
  type LayoutSide,
  type LayoutSnapshot,
} from './layout-snapshot.js'

/** A pair of siblings judged too close, and the gap that made them so. */
export interface BoxFinding {
  readonly first: LayoutNode
  readonly second: LayoutNode
  /** The gap in whole CSS pixels; negative when the boxes overlap. */
  readonly gap: number
  readonly isOverlap: boolean
  /** The siblings that carried `data-ploaness-layout="attached"` and so excused the pair. */
  readonly exemptedBy: readonly LayoutNode[]
}

// Out of flow: laid over the page rather than beside a sibling, so a gap between them means nothing.
const OUT_OF_FLOW: ReadonlySet<string> = new Set<string>(['absolute', 'fixed'])

const HIDDEN_VISIBILITY: ReadonlySet<string> = new Set<string>(['hidden', 'collapse'])

// A table lays its rows and cells against each other by definition, and draws its rules on them, so a
// cell touching the cell below it is the table rather than a defect. The table itself is compared with
// its own siblings, and the content of each cell with the rest of that cell.
const TABLE_PART: RegExp = /^table-(?!caption$)/u

const isTablePart = (node: LayoutNode): boolean => TABLE_PART.test(node.display)

const childrenOf = (snapshot: LayoutSnapshot, parent: LayoutNode): readonly LayoutNode[] =>
  snapshot.nodes.filter((node: LayoutNode): boolean => node.parent === parent.index)

const hasOwnText = (node: LayoutNode): boolean => node.textRects.length > 0

// A wrapper is looked through when a reader cannot see it: it draws nothing of its own and carries no
// text of its own. `display: contents` has no box at all and is always looked through.
const isTransparentWrapper = (snapshot: LayoutSnapshot, node: LayoutNode): boolean =>
  node.display === 'contents' ||
  (!(hasPaintedBox(snapshot, node) || hasOwnText(node)) && childrenOf(snapshot, node).length > 0)

const isComparable = (node: LayoutNode): boolean =>
  !HIDDEN_VISIBILITY.has(node.visibility) && node.rects.some((rect: LayoutRect): boolean => hasArea(rect))

/**
 * The elements laid out directly under a parent, after looking through wrappers that paint nothing.
 * @param snapshot the measured page.
 * @param parent the element whose children are compared.
 * @returns the siblings, in document order.
 */
export const layoutChildren = (snapshot: LayoutSnapshot, parent: LayoutNode): readonly LayoutNode[] =>
  childrenOf(snapshot, parent).flatMap((child: LayoutNode): readonly LayoutNode[] => {
    if (child.isAriaHidden || OUT_OF_FLOW.has(child.position) || isTablePart(child)) {
      return []
    }
    if (isTransparentWrapper(snapshot, child)) {
      return layoutChildren(snapshot, child)
    }
    return isComparable(child) ? [child] : []
  })

// A group is formed under every element that is not itself looked through, so a flattened wrapper's
// children are compared once, in the group of the first ancestor that is not flattened.
const isGroupRoot = (snapshot: LayoutSnapshot, node: LayoutNode): boolean => {
  const parent: LayoutNode | undefined = snapshot.nodes[node.parent]
  return (
    parent === undefined ||
    OUT_OF_FLOW.has(node.position) ||
    node.isAriaHidden ||
    isTablePart(node) ||
    !isTransparentWrapper(snapshot, node)
  )
}

interface Separation {
  readonly horizontal: number
  readonly vertical: number
}

const separationOf = (first: LayoutRect, second: LayoutRect): Separation => ({
  horizontal: Math.max(second.left - first.right, first.left - second.right),
  vertical: Math.max(second.top - first.bottom, first.top - second.bottom),
})

const gapOf = (separation: Separation): number => Math.max(separation.horizontal, separation.vertical)

const isOverlapping = (separation: Separation): boolean => separation.horizontal < 0 && separation.vertical < 0

const areaRects = (rects: readonly LayoutRect[]): readonly LayoutRect[] =>
  rects.filter((rect: LayoutRect): boolean => hasArea(rect))

const separationsOf = (first: readonly LayoutRect[], second: readonly LayoutRect[]): readonly Separation[] =>
  areaRects(first).flatMap((left: LayoutRect): readonly Separation[] =>
    areaRects(second).map((right: LayoutRect): Separation => separationOf(left, right)),
  )

const isDrawnChild = (child: LayoutNode): boolean =>
  !(child.isAriaHidden || OUT_OF_FLOW.has(child.position) || HIDDEN_VISIBILITY.has(child.visibility))

// What an element shows a reader of its content: its own text and what each child shows, where a child
// that paints a box is seen whole. An element with no text and no children is a leaf such as an image, and
// is seen whole too. Padding around content is part of a box only when the box is drawn.
const contentRects = (snapshot: LayoutSnapshot, node: LayoutNode): readonly LayoutRect[] => {
  const children: readonly LayoutNode[] = childrenOf(snapshot, node).filter((child: LayoutNode): boolean =>
    isDrawnChild(child),
  )
  return children.length === 0 && !hasOwnText(node)
    ? areaRects(node.rects)
    : [
        ...areaRects(node.textRects),
        ...children.flatMap((child: LayoutNode): readonly LayoutRect[] =>
          hasPaintedBox(snapshot, child) ? areaRects(child.rects) : contentRects(snapshot, child),
        ),
      ]
}

// The side of `node` that faces `other`, judged on their outer boxes: the axis with the larger gap is
// the one they are separated along.
const facingSide = (node: LayoutRect, other: LayoutRect): LayoutSide => {
  const separation: Separation = separationOf(node, other)
  if (separation.vertical >= separation.horizontal) {
    return node.top < other.top ? 'bottom' : 'top'
  }
  return node.left < other.left ? 'right' : 'left'
}

const outerBox = (node: LayoutNode): LayoutRect => {
  const rects: readonly LayoutRect[] = node.rects.filter((rect: LayoutRect): boolean => hasArea(rect))
  return {
    left: Math.min(...rects.map((rect: LayoutRect): number => rect.left)),
    top: Math.min(...rects.map((rect: LayoutRect): number => rect.top)),
    right: Math.max(...rects.map((rect: LayoutRect): number => rect.right)),
    bottom: Math.max(...rects.map((rect: LayoutRect): number => rect.bottom)),
  }
}

// Boxed toward a neighbour: a background or a shadow is visible on every side, a border only on the
// side it is drawn. Overlapping boxes have no facing side, so anything painted counts.
const isBoxedToward = (snapshot: LayoutSnapshot, node: LayoutNode, other: LayoutNode, isOverlap: boolean): boolean =>
  isOverlap
    ? hasPaintedBox(snapshot, node)
    : hasPaintedBackground(snapshot, node) ||
      node.boxShadow !== 'none' ||
      hasBorderOn(node, facingSide(outerBox(node), outerBox(other)))

const isAttached = (node: LayoutNode): boolean => node.exemption === ATTACHED_EXEMPTION

// Two bands that each span the full width of the page and sit one above the other are the page's
// sections - a header above a hero, the two tones of a footer - so their shared edge is the page's own
// structure. A gap between them would draw a stripe of the canvas across the page rather than separate
// two shapes. Boxes inside a column do not span the page, so a notice and a button stay judged.
const isFullWidth = (snapshot: LayoutSnapshot, node: LayoutNode): boolean => {
  const page: LayoutNode | undefined = snapshot.nodes.find((candidate: LayoutNode): boolean => candidate.parent < 0)
  if (page === undefined || areaRects(page.rects).length === 0) {
    return false
  }
  const pageBox: LayoutRect = outerBox(page)
  const box: LayoutRect = outerBox(node)
  return box.left <= pageBox.left && box.right >= pageBox.right
}

const isStackedBandPair = (snapshot: LayoutSnapshot, pair: readonly [LayoutNode, LayoutNode]): boolean =>
  pair.every((node: LayoutNode): boolean => isFullWidth(snapshot, node))

interface MeasuredPair {
  readonly separations: readonly Separation[]
  readonly isBoxed: boolean
}

// Each side is measured by what it shows the other: its box where it is drawn toward it, its content
// where it is not, so a heading's padding is not read as the heading touching the chips below it.
const measurePair = (snapshot: LayoutSnapshot, first: LayoutNode, second: LayoutNode): MeasuredPair => {
  const isBoxOverlap: boolean = separationsOf(first.rects, second.rects).some((separation: Separation): boolean =>
    isOverlapping(separation),
  )
  const isFirstBoxed: boolean = isBoxedToward(snapshot, first, second, isBoxOverlap)
  const isSecondBoxed: boolean = isBoxedToward(snapshot, second, first, isBoxOverlap)
  return {
    separations: separationsOf(
      isFirstBoxed ? first.rects : contentRects(snapshot, first),
      isSecondBoxed ? second.rects : contentRects(snapshot, second),
    ),
    isBoxed: isFirstBoxed || isSecondBoxed,
  }
}

const judgePair = (
  snapshot: LayoutSnapshot,
  pair: readonly [LayoutNode, LayoutNode],
  minimumGap: number,
): readonly BoxFinding[] => {
  const [first, second] = pair
  const { separations, isBoxed }: MeasuredPair = measurePair(snapshot, first, second)
  const isOverlap: boolean = separations.some((separation: Separation): boolean => isOverlapping(separation))
  const gap: number = Math.min(...separations.map((separation: Separation): number => gapOf(separation)))
  const isClose: boolean = separations.length > 0 && (isOverlap || gap < minimumGap)
  const isBand: boolean = !isOverlap && isStackedBandPair(snapshot, pair)
  return isBoxed && isClose && !isBand
    ? [
        {
          first,
          second,
          gap,
          isOverlap,
          exemptedBy: pair.filter((node: LayoutNode): boolean => isAttached(node)),
        },
      ]
    : []
}

// Two inline boxes sit in the same run of text, where line height rather than a gap separates them: a
// code span on one line and a link on the line above it touch exactly as two lines of text do.
const isInlinePair = (first: LayoutNode, second: LayoutNode): boolean =>
  first.display === 'inline' && second.display === 'inline'

const pairsOf = (siblings: readonly LayoutNode[]): readonly (readonly [LayoutNode, LayoutNode])[] =>
  siblings.flatMap((first: LayoutNode, index: number): readonly (readonly [LayoutNode, LayoutNode])[] =>
    siblings
      .slice(index + 1)
      .filter((second: LayoutNode): boolean => !isInlinePair(first, second))
      .map((second: LayoutNode): readonly [LayoutNode, LayoutNode] => [first, second]),
  )

/**
 * Every pair of boxed siblings closer than the minimum gap, exempted or not.
 * @param snapshot the measured page.
 * @param minimumGap the smallest gap, in CSS pixels, that keeps two boxes apart.
 * @returns one finding per pair, each saying whether an exemption excused it.
 */
export const findTouchingBoxes = (snapshot: LayoutSnapshot, minimumGap: number): readonly BoxFinding[] =>
  snapshot.nodes
    .filter((node: LayoutNode): boolean => isGroupRoot(snapshot, node) && !isInAriaHidden(snapshot, node))
    .flatMap((parent: LayoutNode): readonly BoxFinding[] =>
      pairsOf(layoutChildren(snapshot, parent)).flatMap(
        (pair: readonly [LayoutNode, LayoutNode]): readonly BoxFinding[] => judgePair(snapshot, pair, minimumGap),
      ),
    )
