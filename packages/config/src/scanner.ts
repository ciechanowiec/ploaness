// The one scanner every browser check runs: the managed sweep's passes, and the helpers a project's own
// specifications call for a state the sweep cannot reach. A page judged through either is judged by the
// same rules, so a story, a signed-in view and a crawled route cannot disagree about what a defect is.
//
// Every verdict is a governance function over measured values. This module measures, and collects what
// the browser reports, and nothing else.
import { AxeBuilder } from '@axe-core/playwright'
import { type ConsoleMessage, expect, type Page, type Request } from '@playwright/test'
import {
  axeRulesExcludedAt,
  type BrowserFinding,
  type ConsoleEntry,
  consolePageError,
  type DeclaredExemption,
  distinctFindings,
  FAILED_REQUEST_RULE,
  type FindingPlace,
  type FindingViewport,
  FOCUS_GUARD_RULE,
  FONT_LOAD_RULE,
  type FocusArrival,
  findDefiniteIncomplete,
  findingAt,
  findingLine,
  findUnloadedFonts,
  heldFontFaces,
  instability,
  isAllowedRequest,
  isArray,
  isFailedStatus,
  isFocusGuard,
  type JudgedPage,
  judgeLayout,
  LAYOUT_RULES,
  type LayoutSnapshot,
  PAGE_ERROR_RULE,
  PAGE_NOT_STABLE_RULE,
  RESTING_ELEMENT_RULES,
  reportedText,
  restingCandidates,
  STRESS_VIEWPORTS,
  staleExemptions,
  type UsedExemption,
} from '@ploaness/governance'
import { LAYOUT_SCAN_VIEWPORTS, measurePage } from './layout.js'
import { hasMarkedPayloadView, unmarkPayloadView, VIEW_ROOT_SELECTOR } from './payload-view.js'
import { projectSettings } from './project-settings.js'
import { type SettleOutcome, settleForScan } from './settle.js'

// The browser names the page functions below call, declared for the reason `settle.ts` records.
declare const requestAnimationFrame: (callback: () => void) => number

interface GuardElement {
  readonly tabIndex: number
  readonly hasAttribute: (name: string) => boolean
  readonly contains: (other: GuardElement) => boolean
  readonly closest: (selector: string) => GuardElement | null
  readonly querySelectorAll: (selector: string) => ArrayLike<GuardElement>
  readonly focus: (options: { readonly preventScroll: boolean }) => void
}

declare const document: {
  readonly activeElement: GuardElement | null
  readonly body: GuardElement
  readonly querySelector: (selector: string) => GuardElement | null
}

/** Every rule the resting scan applies to elements, for judging which exemptions are stale. */
export const RESTING_RULES: readonly string[] = [...LAYOUT_RULES, ...RESTING_ELEMENT_RULES]

/** What scanning one place yields. */
export interface PlaceScan extends JudgedPage {
  /** The measurement the findings were judged on, for the outline a failure screenshot draws. */
  readonly snapshot: LayoutSnapshot | undefined
}

/** The engine a page runs in. */
export const engineOf = (page: Page): string => page.context().browser()?.browserType().name() ?? 'chromium'

/** The route path or story a page shows, as a finding names it. */
export const locationOf = (page: Page): string => new URL(page.url()).pathname

const SETTLE_MESSAGES: Readonly<Record<Exclude<SettleOutcome, 'settled'>, string>> = {
  ceiling: 'the page kept changing until the settle ceiling; nothing measured on it can be trusted',
  busy: 'a visible aria-busy="true" region never cleared',
  interrupted: 'the page navigated or closed while it was settling',
}

/**
 * Settle the page, and report a page that did not settle.
 * @param page the page.
 * @param place where it is.
 * @returns a finding, or nothing when the page settled.
 */
export const settleFindings = async (page: Page, place: FindingPlace): Promise<readonly BrowserFinding[]> => {
  const outcome: SettleOutcome = await settleForScan(page)
  return outcome === 'settled' ? [] : [findingAt(place, PAGE_NOT_STABLE_RULE, SETTLE_MESSAGES[outcome])]
}

// Two measurements inside one frame read the same layout whatever the page is doing, so the second is
// taken two animation frames after the first: a page that moves between frames shows it.
const nextFramesInPage = async (): Promise<void> => {
  const frame = async (): Promise<void> => {
    await new Promise<void>((resolve: () => void): void => {
      requestAnimationFrame(resolve)
    })
  }
  await frame()
  await frame()
}

/**
 * Measure a settled page twice, and judge it by the resting rules: L1 to L4, T4, T6 and M1 to M4.
 *
 * Geometry that differs between the two measurements is a finding of its own, and the page is then
 * judged on neither: every other verdict on a page that moves is a coin toss.
 * @param page the settled page.
 * @param place where it is.
 * @returns the findings, the exemptions used and declared, and the measurement.
 */
export const judgeRestingPlace = async (page: Page, place: FindingPlace): Promise<PlaceScan> => {
  const first: LayoutSnapshot = await measurePage(page, place.location)
  await page.evaluate(nextFramesInPage)
  const second: LayoutSnapshot = await measurePage(page, place.location)
  const moved: string | undefined = instability(first, second)
  if (moved !== undefined) {
    return {
      findings: [findingAt(place, PAGE_NOT_STABLE_RULE, moved)],
      used: [],
      declared: [],
      snapshot: second,
    }
  }
  const judged: JudgedPage = judgeLayout(
    { ...second, fontFaces: heldFontFaces(first.fontFaces, second.fontFaces) },
    place,
    {
      minimumGap: projectSettings.layoutMinimumGap,
      extra: restingCandidates(second),
    },
  )
  return {
    ...judged,
    findings: [
      ...judged.findings,
      ...findUnloadedFonts(second).map((message: string): BrowserFinding => findingAt(place, FONT_LOAD_RULE, message)),
    ],
    snapshot: second,
  }
}

type AxeRun = Awaited<ReturnType<AxeBuilder['analyze']>>

// A second copy of axe in the page - a Storybook accessibility addon checking what it rendered - shares
// axe's one-run-at-a-time lock, so a scan started while that copy runs is refused rather than queued.
const AXE_BUSY: string = 'Axe is already running'
const AXE_BUSY_RETRIES: number = 20
const AXE_BUSY_WAIT_MS: number = 250

const analyzed = async (page: Page, builder: AxeBuilder, retries: number): Promise<AxeRun> => {
  try {
    return await builder.analyze()
  } catch (error: unknown) {
    if (retries <= 0 || !(error instanceof Error && error.message.includes(AXE_BUSY))) {
      throw error
    }
    await page.waitForTimeout(AXE_BUSY_WAIT_MS)
    return await analyzed(page, builder, retries - 1)
  }
}

const axeTarget = (target: unknown): string => (isArray(target) ? target.map(String).join(' ') : String(target))

// Focus each element of the reported subtree that Tab can reach, and read where focus rests once the
// page's own focus handlers have run, which a focus guard does synchronously. The focus the page had
// is given back after each one.
const focusArrivalsInPage = (selector: string): readonly FocusArrival[] => {
  const subtree: GuardElement | null = document.querySelector(selector)
  if (subtree === null) {
    return []
  }
  const previous: GuardElement | null = document.activeElement
  return [subtree, ...Array.from(subtree.querySelectorAll('*'))]
    .filter((element: GuardElement): boolean => element.tabIndex >= 0 && !element.hasAttribute('disabled'))
    .map((element: GuardElement): FocusArrival => {
      element.focus({ preventScroll: true })
      const active: GuardElement | null = document.activeElement
      const arrival: FocusArrival = {
        staysInSubtree: active !== null && subtree.contains(active),
        restsOnBody: active === null || active === document.body,
        restsHidden: active?.closest('[aria-hidden="true"]') !== null,
      }
      previous?.focus({ preventScroll: true })
      return arrival
    })
}

// A subtree named by more than one selector lies inside a frame or a shadow root the probe cannot
// address from the document, so it stays reported.
const isFocusGuardAt = async (page: Page, target: unknown): Promise<boolean> =>
  isArray(target) &&
  target.length === 1 &&
  typeof target[0] === 'string' &&
  isFocusGuard(await page.evaluate(focusArrivalsInPage, target[0]))

type AxeViolation = AxeRun['violations'][number]
type AxeNode = AxeViolation['nodes'][number]

const reportedNodes = async (page: Page, violation: AxeViolation): Promise<readonly AxeNode[]> => {
  if (violation.id !== FOCUS_GUARD_RULE) {
    return violation.nodes
  }
  const guards: readonly boolean[] = await Promise.all(
    violation.nodes.map(async (node: AxeNode): Promise<boolean> => await isFocusGuardAt(page, node.target)),
  )
  return violation.nodes.filter((_node: AxeNode, index: number): boolean => guards[index] !== true)
}

/**
 * The axe scan of a page as findings, one per violating element.
 * @param page the settled page.
 * @param place where it is.
 * @param build narrows the builder, for a scan of one rule or one element.
 * @returns the findings.
 */
export const axeFindings = async (
  page: Page,
  place: FindingPlace,
  build: (builder: AxeBuilder) => AxeBuilder = (builder: AxeBuilder): AxeBuilder => builder,
): Promise<readonly BrowserFinding[]> => {
  const excluded: readonly string[] = axeRulesExcludedAt(place.location)
  const builder: AxeBuilder = build(new AxeBuilder({ page }))
  const results: AxeRun = await analyzed(
    page,
    excluded.length === 0 ? builder : builder.disableRules([...excluded]),
    AXE_BUSY_RETRIES,
  )
  const reported: readonly (readonly AxeNode[])[] = await Promise.all(
    results.violations.map(
      async (violation: AxeViolation): Promise<readonly AxeNode[]> => await reportedNodes(page, violation),
    ),
  )
  return [
    ...results.violations.flatMap((violation: AxeViolation, index: number): readonly BrowserFinding[] =>
      (reported[index] ?? []).map(
        (node: AxeNode): BrowserFinding =>
          findingAt(
            place,
            `axe:${violation.id}`,
            `${violation.help}: ${axeTarget(node.target)} - ${reportedText(node.failureSummary ?? '')}`,
          ),
      ),
    ),
    ...findDefiniteIncomplete(results.incomplete).map(
      (message: string): BrowserFinding => findingAt(place, 'axe:incomplete', message),
    ),
  ]
}

// A request cancelled because the page moved on is not a failure of the page.
const CANCELLED: RegExp = /ERR_ABORTED|NS_BINDING_ABORTED|cancelled/iu

const requestFinding = (place: FindingPlace, request: Request, origins: readonly string[]): BrowserFinding[] => {
  const url: string = request.url()
  if (!isAllowedRequest(url, origins)) {
    return [findingAt(place, FAILED_REQUEST_RULE, `${request.method()} ${url} was blocked by the network guard`)]
  }
  const failure: { readonly errorText: string } | null = request.failure()
  if (failure !== null) {
    return CANCELLED.test(failure.errorText)
      ? []
      : [findingAt(place, FAILED_REQUEST_RULE, `${request.method()} ${url} failed: ${failure.errorText}`)]
  }
  const status: number | undefined = request.existingResponse()?.status()
  return status !== undefined && isFailedStatus(status)
    ? [findingAt(place, FAILED_REQUEST_RULE, `${request.method()} ${url} answered ${String(status)}`)]
    : []
}

/** The most requests a page retains for `requests()`; a full log may have lost earlier ones. */
export const RETAINED_REQUESTS: number = 100

/** What the browser reported while a page was at one place. */
export interface HealthReading {
  readonly findings: readonly BrowserFinding[]
  /** Whether the request log was full, so earlier requests of the navigation may be missing. */
  readonly isRequestLogFull: boolean
}

/**
 * The page errors, console errors and failed requests since the page's last navigation, after which the
 * stored console and error logs are cleared so the next place starts empty.
 * @param page the page.
 * @param place where it is.
 * @param origins the origins the network guard allows.
 * @returns the findings, and whether the request log may have lost requests.
 */
export const healthFindings = async (
  page: Page,
  place: FindingPlace,
  origins: readonly string[],
): Promise<HealthReading> => {
  const errors: readonly Error[] = await page.pageErrors()
  const logged: readonly ConsoleMessage[] = await page.consoleMessages()
  const messages: readonly ConsoleEntry[] = logged.map(
    (message: ConsoleMessage): ConsoleEntry => ({ type: message.type(), text: message.text() }),
  )
  const requests: readonly Request[] = await page.requests()
  const lastNavigation: number = requests.findLastIndex(
    (request: Request): boolean => request.isNavigationRequest() && request.frame() === page.mainFrame(),
  )
  await page.clearPageErrors()
  await page.clearConsoleMessages()
  return {
    findings: distinctFindings([
      ...errors.map(
        (error: Error): BrowserFinding => findingAt(place, PAGE_ERROR_RULE, `uncaught ${reportedText(String(error))}`),
      ),
      ...messages.flatMap((entry: ConsoleEntry): readonly BrowserFinding[] => {
        const message: string | undefined = consolePageError(entry)
        return message === undefined ? [] : [findingAt(place, PAGE_ERROR_RULE, reportedText(message))]
      }),
      ...requests
        .slice(Math.max(0, lastNavigation))
        .flatMap((request: Request): readonly BrowserFinding[] => requestFinding(place, request, origins)),
    ]),
    isRequestLogFull: requests.length >= RETAINED_REQUESTS && lastNavigation <= 0,
  }
}

/** The findings of every place one page was scanned at, with the exemptions they used and declared. */
export interface PageScan {
  readonly findings: readonly BrowserFinding[]
  readonly used: readonly UsedExemption[]
  readonly declared: readonly DeclaredExemption[]
}

/**
 * Whether a viewport is one the axe scans and the text-stress passes run at.
 * @param viewport the viewport.
 * @returns true for the phone and desktop viewports.
 */
export const isStressViewport = (viewport: FindingViewport): boolean =>
  STRESS_VIEWPORTS.some(
    (stress: FindingViewport): boolean => stress.width === viewport.width && stress.height === viewport.height,
  )

const placeOf = (page: Page, viewport: FindingViewport, state: string): FindingPlace => ({
  location: locationOf(page),
  state,
  engine: engineOf(page),
  viewport,
})

/**
 * Scan a page in place at every required viewport, then restore its viewport.
 *
 * What a project's own specification calls on a state the sweep cannot reach. The page is resized
 * rather than reloaded, so the state the specification drove it into is what is judged. On a Payload
 * admin view only the view's own content is judged, never Payload's navigation, header or frame.
 * @param page the page, on the route and in the state to judge.
 * @param shouldRunAxe whether to run axe as well, at the phone and desktop viewports.
 * @returns every finding, stale exemptions included.
 */
export const scanPageInPlace = async (page: Page, shouldRunAxe: boolean): Promise<readonly BrowserFinding[]> => {
  const isView: boolean = await hasMarkedPayloadView(page)
  try {
    return await scanMarkedPage(page, shouldRunAxe, isView)
  } finally {
    await unmarkPayloadView(page)
  }
}

const scanMarkedPage = async (
  page: Page,
  shouldRunAxe: boolean,
  isView: boolean,
): Promise<readonly BrowserFinding[]> => {
  const original: FindingViewport | null = page.viewportSize()
  const scans: readonly PageScan[] = await LAYOUT_SCAN_VIEWPORTS.reduce(
    async (earlier: Promise<readonly PageScan[]>, viewport: FindingViewport): Promise<readonly PageScan[]> => {
      const done: readonly PageScan[] = await earlier
      await page.setViewportSize(viewport)
      const place: FindingPlace = placeOf(page, viewport, 'resting')
      const unsettled: readonly BrowserFinding[] = await settleFindings(page, place)
      const judged: PlaceScan = await judgeRestingPlace(page, place)
      const axe: readonly BrowserFinding[] =
        shouldRunAxe && isStressViewport(viewport)
          ? await axeFindings(
              page,
              place,
              (builder: AxeBuilder): AxeBuilder => (isView ? builder.include(VIEW_ROOT_SELECTOR) : builder),
            )
          : []
      return [...done, { ...judged, findings: [...unsettled, ...judged.findings, ...axe] }]
    },
    Promise.resolve<readonly PageScan[]>([]),
  )
  if (original !== null) {
    await page.setViewportSize(original)
  }
  return distinctFindings([
    ...scans.flatMap((scan: PageScan): readonly BrowserFinding[] => scan.findings),
    ...staleExemptions(
      scans.flatMap((scan: PageScan): readonly DeclaredExemption[] => scan.declared),
      scans.flatMap((scan: PageScan): readonly UsedExemption[] => scan.used),
      RESTING_RULES,
      engineOf(page),
    ),
  ])
}

/**
 * Measure the page as it stands at every required viewport, and report what is wrong with its layout,
 * text and media.
 *
 * The page is resized in place rather than reloaded, so whatever state a spec drove it into - a
 * signed-in view, an open dialog - is what gets measured. Its viewport is restored afterwards.
 * @param page the page to measure, already on the route and in the state to judge.
 * @returns one line per defect, empty when there is none.
 */
export const layoutDefectsOf = async (page: Page): Promise<readonly string[]> => {
  const findings: readonly BrowserFinding[] = await scanPageInPlace(page, false)
  return findings.map((finding: BrowserFinding): string => findingLine(finding))
}

/**
 * Fail the calling test when the page has a layout, text or media defect at any required viewport.
 *
 * Call it in a project's own specification for a page the sweep cannot reach - one behind a sign-in,
 * or one whose address exists only once a record does - after driving the page into the state to judge.
 * @param page the page to measure.
 * @returns nothing; it fails the test with one line per defect.
 */
export const expectNoLayoutDefects = async (page: Page): Promise<void> => {
  expect(await layoutDefectsOf(page), `layout defects on ${locationOf(page)}`).toEqual([])
}
