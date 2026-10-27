import {
  applyExemptions,
  type CandidateFinding,
  type DeclaredExemption,
  declaredExemptions,
  EXEMPTION_ATTRIBUTE,
  EXEMPTION_REASON_ATTRIBUTE,
  malformedExemptions,
  staleExemptions,
  type UsedExemption,
} from './browser-exemptions.js'
import { type BrowserFinding, type FindingPlace, findingAt, findingLine } from './browser-findings.js'
import { BASELINE_VIEWPORTS } from './browser-viewports.js'
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

/** The viewports the harness requires. A project may add more, never remove any. */
export const LAYOUT_VIEWPORTS: readonly LayoutViewport[] = BASELINE_VIEWPORTS

/** The smallest gap, in CSS pixels, between a boxed element and its sibling. A project may raise it. */
export const LAYOUT_MINIMUM_GAP: number = 4

/** The attribute a project writes on an element exempt from a rule. */
export const LAYOUT_EXEMPTION_ATTRIBUTE: string = EXEMPTION_ATTRIBUTE

/** The attribute carrying the reason for that exemption. */
export const LAYOUT_REASON_ATTRIBUTE: string = EXEMPTION_REASON_ATTRIBUTE

/** The geometry rules the width sweep and the text-stress passes apply: L1 to L3. */
export const REFLOW_RULES: readonly string[] = ['overflow', 'text-overlap', 'clipped-text']

/** Every geometry rule of the layout scan: L1 to L4. */
export const LAYOUT_RULES: readonly string[] = [...REFLOW_RULES, ATTACHED_EXEMPTION]

const PAIR_SEPARATOR: string = '  <->  '

const boxMessage = (finding: BoxFinding): string => {
  const kind: string = finding.isOverlap
    ? 'overlapping boxes'
    : `touching boxes (gap ${String(Math.max(0, finding.gap))}px)`
  return `${kind}: ${finding.first.label}${PAIR_SEPARATOR}${finding.second.label}`
}

const clipMessage = (finding: ClipFinding): string => {
  const node: LayoutNode = finding.node
  if (finding.clippedBy !== undefined) {
    return `text clipped by ${finding.clippedBy.label}: ${node.label}`
  }
  const kind: string = finding.isUnnamedTruncation
    ? 'truncated text without its full text in title or aria-label'
    : `clipped text (content ${String(node.scrollWidth)}x${String(node.scrollHeight)}px in a ` +
      `${String(node.clientWidth)}x${String(node.clientHeight)}px box)`
  return `${kind}: ${node.label}`
}

const overflowCandidates = (snapshot: LayoutSnapshot): readonly CandidateFinding[] => {
  if (snapshot.scrollWidth <= snapshot.viewportWidth) {
    return []
  }
  const prefix: string =
    `horizontal overflow (page ${String(snapshot.scrollWidth)}px wide ` +
    `in a ${String(snapshot.viewportWidth)}px viewport)`
  const culprits: readonly LayoutNode[] = findOverflowingElements(snapshot)
  return culprits.length === 0
    ? [{ rule: 'overflow', subjects: [], message: `${prefix}: document` }]
    : culprits.map(
        (node: LayoutNode): CandidateFinding => ({
          rule: 'overflow',
          subjects: [node],
          message: `${prefix}: ${node.label}`,
        }),
      )
}

/**
 * The reflow rules' candidates on one measured page, before exemptions: L1 to L3.
 * @param snapshot the measured page.
 * @returns one candidate per defect.
 */
export const reflowCandidates = (snapshot: LayoutSnapshot): readonly CandidateFinding[] => [
  ...findOverlappingText(snapshot).map(
    (finding: TextFinding): CandidateFinding => ({
      rule: 'text-overlap',
      subjects: [finding.first, finding.second],
      message: `overlapping text: ${finding.first.label}${PAIR_SEPARATOR}${finding.second.label}`,
    }),
  ),
  ...findClippedText(snapshot).map(
    (finding: ClipFinding): CandidateFinding => ({
      rule: 'clipped-text',
      subjects: [finding.node],
      message: clipMessage(finding),
    }),
  ),
  ...overflowCandidates(snapshot),
]

/** What judging one measured page yields. */
export interface JudgedPage {
  readonly findings: readonly BrowserFinding[]
  readonly used: readonly UsedExemption[]
  readonly declared: readonly DeclaredExemption[]
}

/** What one page is judged by, besides its measurement and place. */
export interface LayoutJudgement {
  /** The smallest gap, in CSS pixels, between a boxed element and its sibling. */
  readonly minimumGap: number
  /** Candidates of further rules measured on the same page. */
  readonly extra?: readonly CandidateFinding[]
  /** The geometry rules to apply; every layout rule when absent. */
  readonly rules?: readonly string[]
}

/**
 * Judge one measured page by the geometry rules, with exemptions applied.
 *
 * Touching boxes are excused only by an exemption on one of the two boxes. Every other rule is excused
 * by an exemption on the element it judges or on an ancestor of it.
 * @param snapshot the measured page.
 * @param place where it was measured.
 * @param judgement the gap and rules to judge it by, and the candidates of further rules.
 * @param judgement.minimumGap the smallest gap, in CSS pixels, between a boxed element and its sibling.
 * @param judgement.extra candidates of further rules measured on the same page.
 * @param judgement.rules the geometry rules to apply.
 * @returns the findings, the exemptions used, and the exemptions declared.
 */
export const judgeLayout = (
  snapshot: LayoutSnapshot,
  place: FindingPlace,
  { minimumGap, extra = [], rules = LAYOUT_RULES }: LayoutJudgement,
): JudgedPage => {
  const boxes: readonly BoxFinding[] = rules.includes(ATTACHED_EXEMPTION) ? findTouchingBoxes(snapshot, minimumGap) : []
  const candidates: readonly CandidateFinding[] = [
    ...reflowCandidates(snapshot).filter((candidate: CandidateFinding): boolean => rules.includes(candidate.rule)),
    ...extra,
  ]
  const judged: ReturnType<typeof applyExemptions> = applyExemptions(snapshot, place, candidates)
  return {
    findings: [
      ...boxes
        .filter((finding: BoxFinding): boolean => finding.exemptedBy.length === 0)
        .map(
          (finding: BoxFinding): BrowserFinding =>
            findingAt(place, ATTACHED_EXEMPTION, boxMessage(finding), [finding.first.index, finding.second.index]),
        ),
      ...judged.findings,
      ...malformedExemptions(snapshot, place),
    ],
    used: [
      ...boxes.flatMap((finding: BoxFinding): readonly UsedExemption[] =>
        finding.exemptedBy.map(
          (node: LayoutNode): UsedExemption => ({
            location: place.location,
            key: keyOf(snapshot, node),
            rule: ATTACHED_EXEMPTION,
          }),
        ),
      ),
      ...judged.used,
    ],
    declared: declaredExemptions(snapshot, place.location),
  }
}

/**
 * Every layout defect on one page, across the viewports it was measured at, as report lines.
 * @param snapshots the same page measured at each required viewport.
 * @param minimumGap the smallest gap, in CSS pixels, between a boxed element and its sibling.
 * @param engine the engine it was measured in.
 * @param state the state it was measured in.
 * @returns one line per defect, without duplicates, in the order the viewports were measured.
 */
export const findLayoutDefects = (
  snapshots: readonly LayoutSnapshot[],
  minimumGap: number,
  engine: string = 'chromium',
  state: string = 'resting',
): readonly string[] => {
  const judged: readonly JudgedPage[] = snapshots.map(
    (snapshot: LayoutSnapshot): JudgedPage =>
      judgeLayout(
        snapshot,
        {
          location: snapshot.route,
          state,
          engine,
          viewport: { width: snapshot.viewportWidth, height: snapshot.viewportHeight },
        },
        { minimumGap },
      ),
  )
  const stale: readonly BrowserFinding[] = staleExemptions(
    judged.flatMap((page: JudgedPage): readonly DeclaredExemption[] => page.declared),
    judged.flatMap((page: JudgedPage): readonly UsedExemption[] => page.used),
    LAYOUT_RULES,
    engine,
  )
  return [
    ...new Set<string>(
      [...judged.flatMap((page: JudgedPage): readonly BrowserFinding[] => page.findings), ...stale].map(
        (finding: BrowserFinding): string => findingLine(finding),
      ),
    ),
  ]
}

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
