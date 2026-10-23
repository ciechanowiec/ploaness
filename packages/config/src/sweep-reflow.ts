// The sweep's reflow passes: the WCAG 1.4.12 spacing and 1.4.4 resize stresses, and the width sweep
// that reports each reflow defect with the exact widths it holds at.
import { type Page, test } from '@playwright/test'
import {
  applyExemptions,
  type BrowserFinding,
  bisectionWidth,
  type CandidateFinding,
  type ExemptedFindings,
  type FindingPlace,
  type FindingViewport,
  failingRanges,
  findingAt,
  type LayoutSnapshot,
  REFLOW_RULES,
  reflowCandidates,
  STRESS_VIEWPORTS,
  SWEEP_HEIGHT,
  sweepWidths,
  type UsedExemption,
} from '@ploaness/governance'
import { measurePage } from './layout.js'
import { type PlaceScan, settleFindings } from './scanner.js'
import { settleForScan } from './settle.js'
import {
  armBudget,
  type Budget,
  DESKTOP,
  type Discovery,
  type DomElement,
  type DomNode,
  type DomStyle,
  type DomWindow,
  finishPass,
  healthOf,
  isChromium,
  itemLabel,
  loadLocation,
  merged,
  type PlaceItem,
  placeAt,
  preparePage,
  readDiscovery,
  type SweepLocation,
  sampledLocations,
  type Visit,
  visitAll,
} from './sweep-shared.js'

// ---------------------------------------------------------------------------------------------------
// Text stress: WCAG 1.4.12 spacing and 1.4.4 resize

const SPACING_STYLE: string =
  '* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } ' +
  'p { margin-bottom: 2em !important; }'

interface ResizeOutcome {
  readonly label: string
  readonly from: number
  readonly to: number
}

// Every element's text at twice its original computed size, and a line height that keeps its proportion
// where one was set. Answers the elements whose rendered text did not grow.
const doubleTextInPage = (): readonly ResizeOutcome[] => {
  const factor: number = 2
  const tolerance: number = 0.5
  const textNode: number = 3
  const page: DomWindow = globalThis as unknown as DomWindow
  const elements: readonly DomElement[] = [page.document.body, ...Array.from(page.document.body.querySelectorAll('*'))]
  const before: readonly (readonly [number, string])[] = elements.map(
    (element: DomElement): readonly [number, string] => {
      const style: DomStyle = page.getComputedStyle(element)
      return [Number(style.fontSize.replace('px', '')), style.lineHeight]
    },
  )
  for (const [index, element] of elements.entries()) {
    const [size = 0, lineHeight = 'normal'] = before[index] ?? []
    element.style.setProperty('font-size', `${String(size * factor)}px`, 'important')
    if (!lineHeight.endsWith('px')) {
      continue
    }
    const doubled: number = Number(lineHeight.replace('px', '')) * factor
    element.style.setProperty('line-height', `${String(doubled)}px`, 'important')
  }
  return elements.flatMap((element: DomElement, index: number): readonly ResizeOutcome[] => {
    const [size = 0] = before[index] ?? []
    const hasText: boolean = Array.from(element.childNodes).some(
      (node: DomNode): boolean => node.nodeType === textNode && (node.textContent ?? '').trim().length > 0,
    )
    const after: number = Number(page.getComputedStyle(element).fontSize.replace('px', ''))
    return hasText && element.checkVisibility() && after < size * factor - tolerance
      ? [
          {
            label: [element.tagName.toLowerCase(), ...(element.id.length > 0 ? [element.id] : [])].join('#'),
            from: size,
            to: after,
          },
        ]
      : []
  })
}

type StressMode = 'text-spacing' | 'text-resize'

const applyStress = async (page: Page, mode: StressMode): Promise<readonly ResizeOutcome[]> => {
  if (mode === 'text-resize') {
    return await page.evaluate(doubleTextInPage)
  }
  await page.addStyleTag({ content: SPACING_STYLE })
  return []
}

const messageKey = (candidate: CandidateFinding): string =>
  `${candidate.rule}|${candidate.subjects.map((subject): string => subject.label).join('|')}`

const stressVisit = async (page: Page, item: PlaceItem, mode: StressMode): Promise<Visit> => {
  const place: FindingPlace = placeAt(page, item.location, item.viewport, mode)
  const loaded: readonly BrowserFinding[] = await loadLocation(page, item.location, item.viewport, place)
  await settleForScan(page)
  const resting: LayoutSnapshot = await measurePage(page, item.location.location)
  const existing: ReadonlySet<string> = new Set<string>(
    reflowCandidates(resting).map((candidate: CandidateFinding): string => messageKey(candidate)),
  )
  const unchanged: readonly ResizeOutcome[] = await applyStress(page, mode)
  const unsettled: readonly BrowserFinding[] = await settleFindings(page, place)
  const stressed: LayoutSnapshot = await measurePage(page, item.location.location)
  const candidates: readonly CandidateFinding[] = reflowCandidates(stressed)
    .filter((candidate: CandidateFinding): boolean => !existing.has(messageKey(candidate)))
    .map((candidate: CandidateFinding): CandidateFinding => ({ ...candidate, rule: mode }))
  const judged: ExemptedFindings = applyExemptions(stressed, place, candidates)
  const scan: PlaceScan = {
    findings: [
      ...loaded,
      ...unsettled,
      ...judged.findings,
      ...unchanged.map(
        (outcome: ResizeOutcome): BrowserFinding =>
          findingAt(
            place,
            mode,
            `text did not grow from ${String(outcome.from)}px (it rendered at ${String(outcome.to)}px): ${outcome.label}`,
          ),
      ),
    ],
    used: judged.used,
    declared: [],
    snapshot: stressed,
  }
  return merged([{ ...scan, notes: [] }, await healthOf(page, place)])
}

/**
 * Apply the WCAG text-spacing overrides, then double every text size, and judge the reflow each time.
 * @param page the test's page.
 */
export const expectTextStress = async (page: Page): Promise<void> => {
  test.info().skip(!isChromium(page), 'the text-stress pass runs in Chromium')
  const discovery: Discovery = readDiscovery(test.info())
  const locations: readonly SweepLocation[] = sampledLocations(discovery)
  const items: readonly PlaceItem[] = locations.flatMap((location: SweepLocation): readonly PlaceItem[] =>
    STRESS_VIEWPORTS.map((viewport: FindingViewport): PlaceItem => ({ location, viewport })),
  )
  const budget: Budget = armBudget('text-stress', items.length)
  await preparePage(page)
  const visits: readonly Visit[] = await visitAll(items, {
    budget,
    labelOf: itemLabel,
    visit: async (item: PlaceItem): Promise<Visit> =>
      merged([
        await stressVisit(page, item, 'text-spacing'),
        // WCAG 1.4.4 asks for text enlarged at a desktop width; a phone's narrow column is the reflow
        // criterion's question, which the baseline's 320 px and the width sweep already ask.
        ...(item.viewport.width === DESKTOP.width ? [await stressVisit(page, item, 'text-resize')] : []),
      ]),
  })
  finishPass(page, {
    budget,
    pass: 'text-stress',
    visits,
    judgedRules: ['text-spacing', 'text-resize'],
    locations: locations.map((location: SweepLocation): string => location.location),
  })
}

// ---------------------------------------------------------------------------------------------------
// Width sweep

interface WidthReading {
  readonly width: number
  readonly found: ReadonlyMap<string, BrowserFinding>
  readonly used: readonly UsedExemption[]
}

const readWidth = async (page: Page, location: SweepLocation, width: number): Promise<WidthReading> => {
  await page.setViewportSize({ width, height: SWEEP_HEIGHT })
  await settleForScan(page)
  const snapshot: LayoutSnapshot = await measurePage(page, location.location, true)
  const place: FindingPlace = placeAt(page, location, undefined, 'width-sweep')
  const candidates: readonly CandidateFinding[] = reflowCandidates(snapshot)
  const judged: ExemptedFindings = applyExemptions(snapshot, place, candidates)
  const kept: readonly CandidateFinding[] = candidates.filter((candidate: CandidateFinding): boolean =>
    judged.findings.some(
      (finding: BrowserFinding): boolean => finding.message === candidate.message && finding.rule === candidate.rule,
    ),
  )
  return {
    width,
    found: new Map<string, BrowserFinding>(
      kept.map((candidate: CandidateFinding): readonly [string, BrowserFinding] => [
        messageKey(candidate),
        findingAt(place, candidate.rule, candidate.message),
      ]),
    ),
    used: judged.used,
  }
}

const readingAt = async (
  page: Page,
  location: SweepLocation,
  readings: readonly WidthReading[],
  width: number,
): Promise<readonly WidthReading[]> =>
  readings.some((reading: WidthReading): boolean => reading.width === width)
    ? readings
    : [...readings, await readWidth(page, location, width)]

const isPresentAt = (readings: readonly WidthReading[], width: number, key: string): boolean =>
  readings.find((reading: WidthReading): boolean => reading.width === width)?.found.has(key) === true

/** One defect of one location whose widths are being narrowed down. */
interface DefectSearch {
  readonly page: Page
  readonly location: SweepLocation
  readonly key: string
}

// Narrow one boundary of one defect down to adjacent widths.
const bisect = async (
  search: DefectSearch,
  readings: readonly WidthReading[],
  holds: number,
  fails: number,
): Promise<readonly WidthReading[]> => {
  const middle: number | undefined = bisectionWidth(holds, fails)
  if (middle === undefined) {
    return readings
  }
  const read: readonly WidthReading[] = await readingAt(search.page, search.location, readings, middle)
  return isPresentAt(read, middle, search.key)
    ? await bisect(search, read, holds, middle)
    : await bisect(search, read, middle, fails)
}

const boundariesOf = async (
  search: DefectSearch,
  steps: readonly number[],
  readings: readonly WidthReading[],
): Promise<readonly WidthReading[]> =>
  await steps.slice(1).reduce(async (earlier: Promise<readonly WidthReading[]>, width: number, index: number) => {
    const read: readonly WidthReading[] = await earlier
    const previous: number = steps[index] ?? width
    const isBefore: boolean = isPresentAt(read, previous, search.key)
    const isAfter: boolean = isPresentAt(read, width, search.key)
    if (isBefore === isAfter) {
      return read
    }
    return isAfter ? await bisect(search, read, previous, width) : await bisect(search, read, width, previous)
  }, Promise.resolve(readings))

const sweepLocation = async (page: Page, location: SweepLocation): Promise<Visit> => {
  const steps: readonly number[] = sweepWidths()
  const place: FindingPlace = placeAt(page, location, { width: steps[0] ?? 0, height: SWEEP_HEIGHT }, 'width-sweep')
  const loaded: readonly BrowserFinding[] = await loadLocation(
    page,
    location,
    { width: steps[0] ?? 0, height: SWEEP_HEIGHT },
    place,
  )
  const sampled: readonly WidthReading[] = await steps.reduce(
    async (earlier: Promise<readonly WidthReading[]>, width: number): Promise<readonly WidthReading[]> =>
      await readingAt(page, location, await earlier, width),
    Promise.resolve<readonly WidthReading[]>([]),
  )
  const keys: readonly string[] = [
    ...new Set<string>(sampled.flatMap((reading: WidthReading): readonly string[] => [...reading.found.keys()])),
  ]
  const readings: readonly WidthReading[] = await keys.reduce(
    async (earlier: Promise<readonly WidthReading[]>, key: string): Promise<readonly WidthReading[]> =>
      await boundariesOf({ page, location, key }, steps, await earlier),
    Promise.resolve(sampled),
  )
  const measured: readonly number[] = readings.map((reading: WidthReading): number => reading.width)
  const findings: readonly BrowserFinding[] = keys.flatMap((key: string): readonly BrowserFinding[] => {
    const failing: readonly WidthReading[] = readings.filter((reading: WidthReading): boolean => reading.found.has(key))
    const example: BrowserFinding | undefined = failing[0]?.found.get(key)
    return example === undefined
      ? []
      : failingRanges(
          failing.map((reading: WidthReading): number => reading.width),
          measured,
        ).map(
          (range): BrowserFinding => ({
            ...example,
            message: `from ${String(range.from)} to ${String(range.to)}px: ${example.message}`,
          }),
        )
  })
  return merged([
    {
      findings: [...loaded, ...findings],
      used: readings.flatMap((reading: WidthReading): readonly UsedExemption[] => reading.used),
      declared: [],
      notes: [],
    },
    await healthOf(page, place),
  ])
}

/**
 * Resize one route per template and every story across the whole width range, and report each reflow
 * defect with the exact widths it holds at.
 * @param page the test's page.
 */
export const expectWidthSweep = async (page: Page): Promise<void> => {
  test.info().skip(!isChromium(page), 'the width sweep runs in Chromium')
  const discovery: Discovery = readDiscovery(test.info())
  const locations: readonly SweepLocation[] = sampledLocations(discovery)
  const budget: Budget = armBudget('width-sweep', locations.length * sweepWidths().length)
  await preparePage(page)
  const visits: readonly Visit[] = await visitAll(locations, {
    budget,
    labelOf: (location: SweepLocation): string => location.location,
    visit: async (location: SweepLocation): Promise<Visit> => await sweepLocation(page, location),
  })
  finishPass(page, {
    budget,
    pass: 'width-sweep',
    visits,
    judgedRules: REFLOW_RULES,
    locations: locations.map((location: SweepLocation): string => location.location),
  })
}
