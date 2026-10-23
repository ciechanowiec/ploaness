// The one shape every browser rule reports in, and the one line it is printed as.
//
// The sweep runs many passes over many pages, states, viewports and engines, and an agent reading a
// failure has to know which of them produced it before it can reproduce it. Every rule therefore
// reports the same fields, and the line printed for it names each of them in the same order.

/** A viewport a finding was measured at. */
export interface FindingViewport {
  readonly width: number
  readonly height: number
}

/** One defect a browser rule found. */
export interface BrowserFinding {
  /** The rule's name, as an exemption names it. */
  readonly rule: string
  /** The route path, or `story:<id>` for a Storybook story. */
  readonly location: string
  /** What the page was doing: `resting`, `hover`, `focus`, `dark`, `text-spacing`, and so on. */
  readonly state: string
  /** The browser engine: `chromium`, `firefox` or `webkit`. */
  readonly engine: string
  /** The viewport, or undefined for a finding that holds at every viewport. */
  readonly viewport: FindingViewport | undefined
  /** What is wrong, with the element it is wrong on and the values measured. */
  readonly message: string
  /** The elements to outline in the failure screenshot, as measured-node indices. */
  readonly elements: readonly number[]
}

/** Where a finding was measured, without its rule and message. */
export type FindingPlace = Pick<BrowserFinding, 'location' | 'state' | 'engine' | 'viewport'>

const viewportText = (viewport: FindingViewport | undefined): string =>
  viewport === undefined ? '' : ` @${String(viewport.width)}x${String(viewport.height)}`

/**
 * The text line a finding is reported as.
 * @param finding the finding.
 * @returns `[rule] location @WxH (engine, state): message`.
 */
export const findingLine = (finding: BrowserFinding): string =>
  `[${finding.rule}] ${finding.location}${viewportText(finding.viewport)} ` +
  `(${finding.engine}, ${finding.state}): ${finding.message}`

/**
 * A finding at a place.
 * @param place where it was measured.
 * @param rule the rule's name.
 * @param message what is wrong.
 * @param elements the measured-node indices to outline.
 * @returns the finding.
 */
export const findingAt = (
  place: FindingPlace,
  rule: string,
  message: string,
  elements: readonly number[] = [],
): BrowserFinding => ({ ...place, rule, message, elements })

/**
 * The findings with their duplicate lines removed, in the order they were found.
 * @param findings every finding, possibly repeated across measurements.
 * @returns one finding per distinct line.
 */
export const distinctFindings = (findings: readonly BrowserFinding[]): readonly BrowserFinding[] => {
  const lines: readonly string[] = findings.map((finding: BrowserFinding): string => findingLine(finding))
  return findings.filter(
    (finding: BrowserFinding, index: number): boolean => lines.indexOf(findingLine(finding)) === index,
  )
}

/**
 * The distinct places among a set of findings, which is where a failure screenshot is taken.
 * @param findings the findings.
 * @returns one entry per location, state, engine and viewport, with the elements to outline there.
 */
export const failingPlaces = (
  findings: readonly BrowserFinding[],
): readonly (FindingPlace & { readonly elements: readonly number[] })[] => {
  const keyOf = (finding: FindingPlace): string =>
    `${finding.location}|${finding.state}|${finding.engine}|${viewportText(finding.viewport)}`
  const firsts: readonly BrowserFinding[] = findings.filter(
    (finding: BrowserFinding, index: number): boolean =>
      findings.findIndex((other: BrowserFinding): boolean => keyOf(other) === keyOf(finding)) === index,
  )
  return firsts.map((first: BrowserFinding): FindingPlace & { readonly elements: readonly number[] } => ({
    location: first.location,
    state: first.state,
    engine: first.engine,
    viewport: first.viewport,
    elements: [
      ...new Set<number>(
        findings
          .filter((finding: BrowserFinding): boolean => keyOf(finding) === keyOf(first))
          .flatMap((finding: BrowserFinding): readonly number[] => finding.elements),
      ),
    ],
  }))
}
