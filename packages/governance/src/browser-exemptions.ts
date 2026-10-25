// Per-element exemptions from the browser rules, and the checks that keep them honest.
//
// An exemption names the rules it excuses, space separated, in `data-ploaness-layout`, and says why in
// `data-ploaness-layout-reason`. It is judged across everything one run measured: an exemption that
// excused nothing in any pass, viewport, engine or state is stale, because the design it was written
// for is gone and it now only hides whatever defect appears there next.
import { type BrowserFinding, type FindingPlace, findingAt } from './browser-findings.js'
import { keyOf, type LayoutNode, type LayoutSnapshot } from './layout-snapshot.js'

/** The attribute naming the rules an element is exempt from. */
export const EXEMPTION_ATTRIBUTE: string = 'data-ploaness-layout'

/** The attribute stating why. */
export const EXEMPTION_REASON_ATTRIBUTE: string = 'data-ploaness-layout-reason'

/** The rule name of a malformed or stale exemption. */
export const EXEMPTION_RULE: string = 'exemption'

/**
 * The rules an element can be exempted from: those that judge one element. A rule that judges the
 * whole page - an error, a failed request, a font, stability - has no element to carry an exemption.
 */
export const EXEMPTIBLE_RULES: readonly string[] = [
  'attached',
  'overflow',
  'text-overlap',
  'clipped-text',
  'obscured',
  'focus-obscured',
  'text-spacing',
  'text-resize',
  'small-text',
  'image-load',
  'image-distorted',
  'image-upscaled',
  'media-space',
  'focus-visible',
  'focus-contrast',
  'disclosure-keyboard',
]

const WHITESPACE: RegExp = /\s+/u

/**
 * The rule names an exemption attribute carries.
 * @param value the attribute value, or undefined when it is absent.
 * @returns each name once, in the order written.
 */
export const exemptionRules = (value: string | undefined): readonly string[] => [
  ...new Set<string>((value ?? '').split(WHITESPACE).filter((name: string): boolean => name.length > 0)),
]

/** An exemption an element declares. */
export interface DeclaredExemption {
  readonly location: string
  /** The element's position in its document, the same across viewports, states and engines. */
  readonly key: string
  readonly label: string
  readonly rules: readonly string[]
}

/** One rule an exemption excused at least once. */
export interface UsedExemption {
  readonly location: string
  readonly key: string
  readonly rule: string
}

/**
 * The exemption that excuses a rule for an element: its own, or the nearest ancestor's.
 * @param snapshot the measured page.
 * @param node the element the rule judged.
 * @param rule the rule.
 * @returns the element carrying the exemption, or undefined when nothing excuses it.
 */
export const exemptingNode = (snapshot: LayoutSnapshot, node: LayoutNode, rule: string): LayoutNode | undefined => {
  if (exemptionRules(node.exemption).includes(rule)) {
    return node
  }
  const parent: LayoutNode | undefined = snapshot.nodes[node.parent]
  return parent === undefined ? undefined : exemptingNode(snapshot, parent, rule)
}

/** A finding a rule would report, before exemptions are applied. */
export interface CandidateFinding {
  readonly rule: string
  /** The elements the finding is about. Any of them, or an ancestor of any, can excuse it. */
  readonly subjects: readonly LayoutNode[]
  readonly message: string
}

/** What applying exemptions leaves: the findings still reported, and the exemptions that excused one. */
export interface ExemptedFindings {
  readonly findings: readonly BrowserFinding[]
  readonly used: readonly UsedExemption[]
}

/**
 * Drop every candidate an exemption excuses, recording which exemption did.
 * @param snapshot the measured page.
 * @param place where it was measured.
 * @param candidates what the rules found.
 * @returns the findings still reported and the exemptions used.
 */
export const applyExemptions = (
  snapshot: LayoutSnapshot,
  place: FindingPlace,
  candidates: readonly CandidateFinding[],
): ExemptedFindings => {
  const judged: readonly { readonly candidate: CandidateFinding; readonly by: readonly LayoutNode[] }[] =
    candidates.map((candidate: CandidateFinding) => ({
      candidate,
      by: candidate.subjects.flatMap((subject: LayoutNode): readonly LayoutNode[] => {
        const node: LayoutNode | undefined = exemptingNode(snapshot, subject, candidate.rule)
        return node === undefined ? [] : [node]
      }),
    }))
  return {
    findings: judged
      .filter((entry): boolean => entry.by.length === 0)
      .map(
        (entry): BrowserFinding =>
          findingAt(
            place,
            entry.candidate.rule,
            entry.candidate.message,
            entry.candidate.subjects.map((subject: LayoutNode): number => subject.index),
          ),
      ),
    used: judged.flatMap((entry): readonly UsedExemption[] =>
      entry.by.map(
        (node: LayoutNode): UsedExemption => ({
          location: place.location,
          key: keyOf(snapshot, node),
          rule: entry.candidate.rule,
        }),
      ),
    ),
  }
}

/**
 * The exemptions a measured page declares.
 * @param snapshot the measured page.
 * @param location the route or story the page is.
 * @returns one entry per element carrying the attribute.
 */
export const declaredExemptions = (snapshot: LayoutSnapshot, location: string): readonly DeclaredExemption[] =>
  snapshot.nodes
    .filter((node: LayoutNode): boolean => node.exemption !== undefined)
    .map(
      (node: LayoutNode): DeclaredExemption => ({
        location,
        key: keyOf(snapshot, node),
        label: node.label,
        rules: exemptionRules(node.exemption),
      }),
    )

/**
 * The malformed exemptions on a measured page: an unknown rule name, or no reason.
 * @param snapshot the measured page.
 * @param place where it was measured.
 * @returns one finding per malformed exemption.
 */
export const malformedExemptions = (snapshot: LayoutSnapshot, place: FindingPlace): readonly BrowserFinding[] =>
  snapshot.nodes.flatMap((node: LayoutNode): readonly BrowserFinding[] => {
    if (node.exemption === undefined) {
      return []
    }
    const rules: readonly string[] = exemptionRules(node.exemption)
    const unknown: readonly string[] = rules.filter((rule: string): boolean => !EXEMPTIBLE_RULES.includes(rule))
    return [
      ...(rules.length === 0
        ? [findingAt(place, EXEMPTION_RULE, `${EXEMPTION_ATTRIBUTE} names no rule on ${node.label}`, [node.index])]
        : []),
      ...unknown.map(
        (rule: string): BrowserFinding =>
          findingAt(
            place,
            EXEMPTION_RULE,
            `unknown rule "${rule}" in ${EXEMPTION_ATTRIBUTE} on ${node.label}; ` +
              `the exemptible rules are ${EXEMPTIBLE_RULES.join(', ')}`,
            [node.index],
          ),
      ),
      ...(node.exemptionReason.length === 0
        ? [
            findingAt(
              place,
              EXEMPTION_RULE,
              `layout exemption without a reason on ${node.label}; state it in ${EXEMPTION_REASON_ATTRIBUTE}`,
              [node.index],
            ),
          ]
        : []),
    ]
  })

/**
 * The exemption rules that excused nothing anywhere they were judged.
 * @param declared every exemption the run saw.
 * @param used every exemption that excused a finding.
 * @param judgedRules the rules the run actually applied; a rule that never ran cannot prove anything stale.
 * @param engine the engine to report the finding under.
 * @returns one finding per stale rule name on one element.
 */
export const staleExemptions = (
  declared: readonly DeclaredExemption[],
  used: readonly UsedExemption[],
  judgedRules: readonly string[],
  engine: string,
): readonly BrowserFinding[] => {
  const usedKeys: ReadonlySet<string> = new Set<string>(
    used.map((entry: UsedExemption): string => `${entry.location}|${entry.key}|${entry.rule}`),
  )
  const distinct: readonly DeclaredExemption[] = declared.filter(
    (entry: DeclaredExemption, index: number): boolean =>
      declared.findIndex(
        (other: DeclaredExemption): boolean => other.location === entry.location && other.key === entry.key,
      ) === index,
  )
  return distinct.flatMap((entry: DeclaredExemption): readonly BrowserFinding[] =>
    entry.rules
      .filter(
        (rule: string): boolean =>
          EXEMPTIBLE_RULES.includes(rule) &&
          judgedRules.includes(rule) &&
          !usedKeys.has(`${entry.location}|${entry.key}|${rule}`),
      )
      .map(
        (rule: string): BrowserFinding =>
          findingAt(
            { location: entry.location, state: 'every', engine, viewport: undefined },
            EXEMPTION_RULE,
            `stale layout exemption "${rule}" on ${entry.label}: it excuses nothing in any pass, viewport, ` +
              `engine or state; remove it from ${EXEMPTION_ATTRIBUTE}`,
          ),
      ),
  )
}

/** An element carrying an exemption, as the page describes it for a finding on it or a descendant. */
export interface ExemptionCarrier {
  readonly key: string
  readonly label: string
  /** The raw attribute value. */
  readonly rules: string
  readonly reason: string
}

/** What judging one element-level finding against the exemptions above it yields. */
export interface CarriedJudgement {
  /** The finding, or undefined when an exemption excused it. */
  readonly finding: BrowserFinding | undefined
  readonly used: readonly UsedExemption[]
  readonly declared: readonly DeclaredExemption[]
}

/**
 * Judge a finding on one element against the exemptions on it and its ancestors.
 * @param finding the finding, as the rule reported it.
 * @param carriers the exemptions on the element or an ancestor, nearest first.
 * @returns the finding unless excused, the exemption that excused it, and every exemption seen.
 */
export const judgeCarried = (finding: BrowserFinding, carriers: readonly ExemptionCarrier[]): CarriedJudgement => {
  const excusing: ExemptionCarrier | undefined = carriers.find((carrier: ExemptionCarrier): boolean =>
    exemptionRules(carrier.rules).includes(finding.rule),
  )
  return {
    finding: excusing === undefined ? finding : undefined,
    used: excusing === undefined ? [] : [{ location: finding.location, key: excusing.key, rule: finding.rule }],
    declared: carriers.map(
      (carrier: ExemptionCarrier): DeclaredExemption => ({
        location: finding.location,
        key: carrier.key,
        label: carrier.label,
        rules: exemptionRules(carrier.rules),
      }),
    ),
  }
}
