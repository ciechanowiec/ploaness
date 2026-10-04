// The layout sweep's verdict on one page, measured at every viewport the harness requires.
//
// Each defect is one line naming the route, the viewport, the rule, and the elements, so a failure says
// where to look without a screenshot. Exemptions are judged across all the viewports of a page at once:
// an edge attached at a phone width and apart at a desktop one is the ordinary shape of a responsive
// layout, so an exemption is stale only when it excuses nothing at any of them.
import { type BoxFinding, findTouchingBoxes } from './layout-boxes.js'
import { ATTACHED_EXEMPTION, keyOf, type LayoutNode, type LayoutSnapshot } from './layout-snapshot.js'
import {
  type ClipFinding,
  findClippedText,
  findOverflowingElements,
  findOverlappingText,
  type TextFinding,
} from './layout-text.js'

/** A viewport every scan runs at. */
export interface LayoutViewport {
  readonly width: number
  readonly height: number
}

/** The viewports the harness requires: a phone and a desktop. A project may add more, never remove. */
export const LAYOUT_VIEWPORTS: readonly LayoutViewport[] = [
  { width: 390, height: 844 },
  { width: 1280, height: 800 },
]

/** The smallest gap, in CSS pixels, between a boxed element and its sibling. A project may raise it. */
export const LAYOUT_MINIMUM_GAP: number = 4

/** The attribute a project writes on an element whose edge is shared on purpose. */
export const LAYOUT_EXEMPTION_ATTRIBUTE: string = 'data-ploaness-layout'

/** The attribute carrying the reason for that exemption. */
export const LAYOUT_REASON_ATTRIBUTE: string = 'data-ploaness-layout-reason'

const PAIR_SEPARATOR: string = '  <->  '

const where = (snapshot: LayoutSnapshot): string => `${snapshot.route} @${String(snapshot.viewportWidth)}px`

const boxLine = (snapshot: LayoutSnapshot, finding: BoxFinding): string => {
  const kind: string = finding.isOverlap
    ? 'overlapping boxes'
    : `touching boxes (gap ${String(Math.max(0, finding.gap))}px)`
  return `${where(snapshot)}: ${kind}: ${finding.first.label}${PAIR_SEPARATOR}${finding.second.label}`
}

const textLine = (snapshot: LayoutSnapshot, finding: TextFinding): string =>
  `${where(snapshot)}: overlapping text: ${finding.first.label}${PAIR_SEPARATOR}${finding.second.label}`

const clipLine = (snapshot: LayoutSnapshot, finding: ClipFinding): string => {
  const node: LayoutNode = finding.node
  const kind: string = finding.isUnnamedTruncation
    ? 'truncated text without its full text in title or aria-label'
    : `clipped text (content ${String(node.scrollWidth)}x${String(node.scrollHeight)}px in a ` +
      `${String(node.clientWidth)}x${String(node.clientHeight)}px box)`
  return `${where(snapshot)}: ${kind}: ${node.label}`
}

const overflowLines = (snapshot: LayoutSnapshot): readonly string[] => {
  if (snapshot.scrollWidth <= snapshot.viewportWidth) {
    return []
  }
  const prefix: string =
    `${where(snapshot)}: horizontal overflow (page ${String(snapshot.scrollWidth)}px wide ` +
    `in a ${String(snapshot.viewportWidth)}px viewport)`
  const culprits: readonly LayoutNode[] = findOverflowingElements(snapshot)
  return culprits.length === 0
    ? [`${prefix}: document`]
    : culprits.map((node: LayoutNode): string => `${prefix}: ${node.label}`)
}

const isExempted = (finding: BoxFinding): boolean => finding.exemptedBy.length > 0

const snapshotLines = (snapshot: LayoutSnapshot, minimumGap: number): readonly string[] => [
  ...findTouchingBoxes(snapshot, minimumGap)
    .filter((finding: BoxFinding): boolean => !isExempted(finding))
    .map((finding: BoxFinding): string => boxLine(snapshot, finding)),
  ...findOverlappingText(snapshot).map((finding: TextFinding): string => textLine(snapshot, finding)),
  ...findClippedText(snapshot).map((finding: ClipFinding): string => clipLine(snapshot, finding)),
  ...overflowLines(snapshot),
]

const exemptionLines = (snapshot: LayoutSnapshot): readonly string[] =>
  snapshot.nodes.flatMap((node: LayoutNode): readonly string[] => {
    if (node.exemption === undefined) {
      return []
    }
    if (node.exemption !== ATTACHED_EXEMPTION) {
      return [
        `${where(snapshot)}: unknown layout exemption ${LAYOUT_EXEMPTION_ATTRIBUTE}=` +
          `"${node.exemption}" on ${node.label}; the only value is "${ATTACHED_EXEMPTION}"`,
      ]
    }
    return node.exemptionReason.length === 0
      ? [
          `${where(snapshot)}: layout exemption without a reason on ${node.label}; ` +
            `state it in ${LAYOUT_REASON_ATTRIBUTE}`,
        ]
      : []
  })

const usedExemptionKeys = (snapshots: readonly LayoutSnapshot[], minimumGap: number): ReadonlySet<string> =>
  new Set<string>(
    snapshots.flatMap((snapshot: LayoutSnapshot): readonly string[] =>
      findTouchingBoxes(snapshot, minimumGap).flatMap((finding: BoxFinding): readonly string[] =>
        finding.exemptedBy.map((node: LayoutNode): string => keyOf(snapshot, node)),
      ),
    ),
  )

interface Exemption {
  readonly key: string
  readonly label: string
}

const attachedExemptions = (snapshots: readonly LayoutSnapshot[]): readonly Exemption[] => {
  const all: readonly Exemption[] = snapshots.flatMap((snapshot: LayoutSnapshot): readonly Exemption[] =>
    snapshot.nodes
      .filter((node: LayoutNode): boolean => node.exemption === ATTACHED_EXEMPTION)
      .map((node: LayoutNode): Exemption => ({ key: keyOf(snapshot, node), label: node.label })),
  )
  return all.filter(
    (exemption: Exemption, index: number): boolean =>
      all.findIndex((other: Exemption): boolean => other.key === exemption.key) === index,
  )
}

const staleLines = (snapshots: readonly LayoutSnapshot[], minimumGap: number): readonly string[] => {
  const used: ReadonlySet<string> = usedExemptionKeys(snapshots, minimumGap)
  const widths: string = snapshots
    .map((snapshot: LayoutSnapshot): string => `${String(snapshot.viewportWidth)}px`)
    .join(', ')
  const route: string = snapshots[0]?.route ?? ''
  return attachedExemptions(snapshots)
    .filter((exemption: Exemption): boolean => !used.has(exemption.key))
    .map(
      (exemption: Exemption): string =>
        `${route}: stale layout exemption on ${exemption.label}: it excuses no touching or ` +
        `overlapping box at ${widths}; remove ${LAYOUT_EXEMPTION_ATTRIBUTE}`,
    )
}

/**
 * Every layout defect on one page, across the viewports it was measured at.
 * @param snapshots the same page measured at each required viewport.
 * @param minimumGap the smallest gap, in CSS pixels, between a boxed element and its sibling.
 * @returns one line per defect, without duplicates, in the order the viewports were measured.
 */
export const findLayoutDefects = (snapshots: readonly LayoutSnapshot[], minimumGap: number): readonly string[] => [
  ...new Set<string>([
    ...snapshots.flatMap((snapshot: LayoutSnapshot): readonly string[] => [
      ...snapshotLines(snapshot, minimumGap),
      ...exemptionLines(snapshot),
    ]),
    ...staleLines(snapshots, minimumGap),
  ]),
]

/**
 * The viewports a scan must run at: the harness's own, then any a project adds.
 * @param declared the viewports a project declared.
 * @returns the required viewports first, each width once.
 */
export const layoutViewportsWith = (declared: readonly LayoutViewport[]): readonly LayoutViewport[] =>
  [...LAYOUT_VIEWPORTS, ...declared].filter(
    (viewport: LayoutViewport, index: number, all: readonly LayoutViewport[]): boolean =>
      all.findIndex(
        (other: LayoutViewport): boolean => other.width === viewport.width && other.height === viewport.height,
      ) === index,
  )
