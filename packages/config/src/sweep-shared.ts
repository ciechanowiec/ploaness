// What every pass of the managed browser sweep shares: the browser surface its page functions touch,
// the files the passes hand each other, loading a location, and the budget each pass runs under.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, type Page, type TestInfo, test } from '@playwright/test'
import {
  allowedOrigins,
  type BrowserFinding,
  type DeclaredExemption,
  type DiscoveredStory,
  distinctFindings,
  type FindingPlace,
  type FindingViewport,
  FONT_LOAD_RULE,
  failingPlaces,
  findingAt,
  findingLine,
  isAllowedRequest,
  type JudgedPage,
  LAYOUT_RULES,
  PAGE_ERROR_RULE,
  PASS_BUDGET_RULE,
  passBudgetMs,
  REAL_CLOCK,
  RESTING_ELEMENT_RULES,
  SETTLED_STORY_PHASES,
  type SweepPass,
  storyLocation,
  storySamples,
  type TemplateSample,
  type UsedExemption,
} from '@ploaness/governance'
import { outlineElements } from './layout.js'
import { projectSettings } from './project-settings.js'
import { engineOf, type HealthReading, healthFindings, type PlaceScan } from './scanner.js'

// The browser surface the page functions below touch, declared rather than taken from lib.dom for the
// reason `settle.ts` records. These names resolve in the page at run time.
export interface DomRect {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
  readonly width: number
  readonly height: number
}

export interface DomStyle {
  readonly clipPath: string
  readonly position: string
  readonly fontSize: string
  readonly lineHeight: string
  readonly getPropertyValue: (property: string) => string
  readonly setProperty: (property: string, value: string, priority: string) => void
}

export interface DomNode {
  readonly nodeType: number
  readonly textContent: string | null
}

export interface DomElement {
  readonly tagName: string
  readonly id: string
  readonly parentElement: DomElement | null
  readonly childNodes: ArrayLike<DomNode>
  readonly style: DomStyle
  readonly ownerDocument: DomDocument
  readonly getBoundingClientRect: () => DomRect
  readonly contains: (other: DomElement) => boolean
  readonly closest: (selector: string) => DomElement | null
  readonly getRootNode: () => unknown
  readonly getAttribute: (name: string) => string | null
  readonly setAttribute: (name: string, value: string) => void
  readonly removeAttribute: (name: string) => void
  readonly checkVisibility: () => boolean
  readonly scrollIntoView: (options: { readonly block: string; readonly inline: string }) => void
  readonly querySelectorAll: (selector: string) => ArrayLike<DomElement>
  readonly blur?: () => void
}

interface DomDocument {
  readonly body: DomElement
  readonly activeElement: DomElement | null
  readonly documentElement: DomElement & { readonly clientWidth: number; readonly clientHeight: number }
  readonly styleSheets: ArrayLike<{ readonly cssRules?: ArrayLike<CssRule> }>
  readonly elementFromPoint: (x: number, y: number) => DomElement | null
  readonly querySelector: (selector: string) => DomElement | null
  readonly querySelectorAll: (selector: string) => ArrayLike<DomElement>
}

export interface CssRule {
  readonly media?: { readonly mediaText: string }
  readonly selectorText?: string
  readonly cssRules?: ArrayLike<CssRule>
}

export interface DomWindow {
  readonly document: DomDocument
  readonly location: { readonly href: string }
  readonly history: { readonly length: number }
  readonly getComputedStyle: (element: DomElement) => DomStyle
}

/** What Storybook exposes as `__STORYBOOK_PREVIEW__` on the preview window. */
interface StorybookPreview {
  readonly currentRender?: { readonly phase?: string }
}

/** One page the passes scan: a crawled route or a Storybook story, with what discovery read from it. */
export interface SweepLocation {
  readonly location: string
  readonly url: string
  readonly isStory: boolean
  readonly edges: readonly number[]
  readonly hasDarkMedia: boolean
  readonly hasDarkClass: boolean
  readonly controls: number
}

/** What discovery hands every later pass. */
export interface Discovery {
  readonly routes: readonly string[]
  readonly stories: readonly DiscoveredStory[]
  readonly locations: readonly SweepLocation[]
  readonly samples: readonly TemplateSample[]
}

/** What a pass leaves for the summary. */
export interface PassReport {
  readonly pass: SweepPass
  readonly engine: string
  readonly findings: readonly BrowserFinding[]
  readonly used: readonly UsedExemption[]
  readonly declared: readonly DeclaredExemption[]
  readonly judgedRules: readonly string[]
  readonly places: number
  readonly locations: readonly string[]
  readonly notes: readonly string[]
  /** How long the pass took, which is what its budget allowance is calibrated against. */
  readonly elapsedMs: number
}

/** What visiting one item of a pass yields. */
export interface Visit extends JudgedPage {
  readonly notes: readonly string[]
}

export const EMPTY_VISIT: Visit = { findings: [], used: [], declared: [], notes: [] }

const SWEEP_DIRECTORY: string = 'ploaness-sweep'

// Every element a person can operate, wherever it sits on the page.
export const CONTROLS: string = [
  'a[href]',
  'button',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  'summary',
  '[role="button"]',
  '[role="link"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="switch"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[role="combobox"]',
  '[role="slider"]',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

// The site chrome renders identically on every page, so its controls are driven once per viewport, on
// the first location, rather than once per page.
export const CHROME: string = 'header, footer'

export const PROBE_ATTRIBUTE: string = 'data-ploaness-probe'

export const DISCLOSURE_ATTRIBUTE: string = 'data-ploaness-disclosure'

// Motion is disabled so every run measures the same frame: what a reader is left looking at.
export const STILL_STYLE: string =
  '*, *::before, *::after { animation-duration: 0s !important; animation-delay: 0s !important; ' +
  'transition-duration: 0s !important; transition-delay: 0s !important; caret-color: transparent !important; ' +
  'scroll-behavior: auto !important; }'

// Enough to show what each failing place looked like without turning a broken site into gigabytes.
const MAX_SCREENSHOTS: number = 60

// Grace beyond the pass budget, so the pass reports its own budget finding before Playwright's timeout.
const TIMEOUT_GRACE_MS: number = 120_000

const STORY_RENDER_MS: number = 30_000

export const DESKTOP: FindingViewport = { width: 1280, height: 800 }

// ---------------------------------------------------------------------------------------------------
// Files

/**
 * The directory the passes of one Playwright project hand their files through.
 * @param info the running test.
 * @returns the directory.
 */
export const sweepDirectory = (info: TestInfo): string =>
  path.join(info.project.outputDir, SWEEP_DIRECTORY, info.project.name)

const JSON_INDENT: number = 2

/**
 * Write a value as indented JSON, creating its directory.
 * @param file the file to write.
 * @param value the value.
 */
export const writeJson = (file: string, value: unknown): void => {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(value, null, JSON_INDENT)}\n`)
}

/**
 * Read a JSON file another pass wrote.
 * @param file the file to read.
 * @returns its parsed value, or undefined when it is absent or unreadable.
 */
export const readJson = (file: string): unknown => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return undefined
  }
}

/**
 * The file discovery writes for every later pass.
 * @param info the running test.
 * @returns the file.
 */
export const discoveryFile = (info: TestInfo): string => path.join(sweepDirectory(info), 'discovered.json')

/**
 * The file one pass writes its report to.
 * @param info the running test.
 * @param pass the pass.
 * @returns the file.
 */
export const reportFile = (info: TestInfo, pass: SweepPass): string => path.join(sweepDirectory(info), `${pass}.json`)

/**
 * What discovery recorded, failing the test when it recorded nothing.
 * @param info the running test.
 * @returns the discovery.
 */
export const readDiscovery = (info: TestInfo): Discovery => {
  const discovery: Discovery | undefined = readJson(discoveryFile(info)) as Discovery | undefined
  expect(discovery, 'discovery did not record what to scan; its own test names the reason').toBeDefined()
  return discovery ?? { routes: [], stories: [], locations: [], samples: [] }
}

// ---------------------------------------------------------------------------------------------------
// Pages

const ORIGINS: readonly string[] = allowedOrigins([
  projectSettings.serverUrl,
  ...projectSettings.auxiliaryServers.map((server): string => server.url),
])

export const origin: string = new URL(projectSettings.serverUrl).origin

/** Block every request outside the application and its auxiliary servers, and fix the browser clock. */
export const preparePage = async (page: Page): Promise<void> => {
  await page.route(
    (url: URL): boolean => !isAllowedRequest(url.href, ORIGINS),
    async (route): Promise<void> => {
      await route.abort('blockedbyclient')
    },
  )
  if (projectSettings.clock !== REAL_CLOCK) {
    await page.clock.setFixedTime(new Date(projectSettings.clock))
  }
}

const isStoryInPhaseInPage = (phases: readonly string[]): boolean => {
  const preview: StorybookPreview | undefined = (
    globalThis as unknown as Readonly<Record<string, StorybookPreview | undefined>>
  )['__STORYBOOK_PREVIEW__']
  return phases.includes(preview?.currentRender?.phase ?? '')
}

const hasStoryFailedInPage = (): boolean =>
  (globalThis as unknown as DomWindow).document.querySelector('body.sb-show-errordisplay') !== null

/**
 * Load a location fresh at a viewport, still, with a story rendered and played.
 * @param page the test's page.
 * @param location the location.
 * @param viewport the viewport.
 * @param place where findings about the load are made.
 * @returns findings about the load itself.
 */
export const loadLocation = async (
  page: Page,
  location: SweepLocation,
  viewport: FindingViewport,
  place: FindingPlace,
): Promise<readonly BrowserFinding[]> => {
  await page.setViewportSize(viewport)
  await page.goto(location.url)
  await page.addStyleTag({ content: STILL_STYLE })
  if (!location.isStory) {
    return []
  }
  try {
    await page.waitForFunction(isStoryInPhaseInPage, SETTLED_STORY_PHASES, { timeout: STORY_RENDER_MS })
  } catch {
    return [findingAt({ ...place, viewport: undefined }, PAGE_ERROR_RULE, 'the story did not finish rendering')]
  }
  return (await page.evaluate(hasStoryFailedInPage))
    ? [findingAt({ ...place, viewport: undefined }, PAGE_ERROR_RULE, 'the story rendered its error display')]
    : []
}

/**
 * Where a finding at a location was made.
 * @param page the test's page.
 * @param location the location.
 * @param viewport the viewport, or undefined for a finding about the whole location.
 * @param state the state the location was in.
 * @returns the place.
 */
export const placeAt = (
  page: Page,
  location: SweepLocation,
  viewport: FindingViewport | undefined,
  state: string,
): FindingPlace => ({
  location: location.location,
  state,
  engine: engineOf(page),
  viewport,
})

/**
 * The page errors and failed requests of a location since its last navigation.
 * @param page the test's page.
 * @param place where the page is.
 * @returns the visit carrying them.
 */
export const healthOf = async (page: Page, place: FindingPlace): Promise<Visit> => {
  const reading: HealthReading = await healthFindings(page, { ...place, viewport: undefined }, ORIGINS)
  return {
    ...EMPTY_VISIT,
    findings: reading.findings,
    notes: reading.isRequestLogFull
      ? [`${place.location}: the request log was full, so earlier requests went unread`]
      : [],
  }
}

/**
 * Several visits as one.
 * @param visits the visits.
 * @returns their findings, exemptions and notes together.
 */
export const merged = (visits: readonly Visit[]): Visit => ({
  findings: visits.flatMap((visit: Visit): readonly BrowserFinding[] => visit.findings),
  used: visits.flatMap((visit: Visit): readonly UsedExemption[] => visit.used),
  declared: visits.flatMap((visit: Visit): readonly DeclaredExemption[] => visit.declared),
  notes: visits.flatMap((visit: Visit): readonly string[] => visit.notes),
})

/**
 * Attach a screenshot of a failing place with its failing elements outlined, up to a cap per pass.
 * @param page the test's page.
 * @param scan what was found there.
 * @param place where it was found.
 * @param number how many places the pass visited before this one.
 */
export const screenshotOf = async (page: Page, scan: PlaceScan, place: FindingPlace, number: number): Promise<void> => {
  const elements: readonly number[] = failingPlaces(scan.findings).flatMap(
    (failing): readonly number[] => failing.elements,
  )
  if (scan.findings.length === 0 || number >= MAX_SCREENSHOTS) {
    return
  }
  await outlineElements(page, elements)
  await test.info().attach(`${place.state} ${place.location} ${String(place.viewport?.width ?? '')}`, {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  })
}

// ---------------------------------------------------------------------------------------------------
// Budgets

/** The time a pass may spend. */
export interface Budget {
  readonly pass: SweepPass
  readonly startedAt: number
  readonly deadline: number
}

/**
 * Start a pass's budget and set its test's timeout beyond it.
 * @param pass the pass.
 * @param units how many units of work it has.
 * @returns the budget.
 */
export const armBudget = (pass: SweepPass, units: number): Budget => {
  const budgetMs: number = passBudgetMs(pass, units)
  test.info().setTimeout(budgetMs + TIMEOUT_GRACE_MS)
  const startedAt: number = performance.now()
  return { pass, startedAt, deadline: startedAt + budgetMs }
}

/** How a pass visits its items. */
interface ItemVisitor<Item> {
  readonly budget: Budget
  readonly labelOf: (item: Item) => string
  readonly visit: (item: Item, index: number) => Promise<Visit>
}

/**
 * Visit each item in turn, stopping with a finding when the pass runs out of budget.
 * @param items the items of the pass.
 * @param visitor the budget, and how to name and visit an item.
 * @param index the item to visit next.
 * @returns one visit per item visited, and a budget finding when the pass stopped early.
 */
export const visitAll = async <Item>(
  items: readonly Item[],
  visitor: ItemVisitor<Item>,
  index: number = 0,
): Promise<readonly Visit[]> => {
  const { budget, labelOf, visit }: ItemVisitor<Item> = visitor
  const item: Item | undefined = items[index]
  if (item === undefined) {
    return []
  }
  if (performance.now() > budget.deadline) {
    return [
      {
        ...EMPTY_VISIT,
        findings: [
          findingAt(
            { location: labelOf(item), state: budget.pass, engine: '', viewport: undefined },
            PASS_BUDGET_RULE,
            `the ${budget.pass} pass ran out of its budget at this item, with ${String(items.length - index)} of ` +
              `${String(items.length)} items unvisited`,
          ),
        ],
      },
    ]
  }
  const visited: Visit = await visit(item, index)
  return [visited, ...(await visitAll(items, visitor, index + 1))]
}

/** What a finished pass hands to its report. */
interface FinishedPass {
  readonly budget: Budget
  readonly pass: SweepPass
  readonly visits: readonly Visit[]
  readonly judgedRules: readonly string[]
  readonly locations: readonly string[]
}

/**
 * Write a pass's report for the summary, and fail the pass's test on any finding.
 * @param page the test's page.
 * @param finished the pass, its visits, the rules it judged and the locations it covered.
 */
export const finishPass = (page: Page, finished: FinishedPass): void => {
  const { budget, pass, visits, judgedRules, locations }: FinishedPass = finished
  const all: Visit = merged(visits)
  const findings: readonly BrowserFinding[] = distinctFindings(all.findings)
  const report: PassReport = {
    pass,
    engine: engineOf(page),
    findings,
    used: all.used,
    declared: all.declared,
    judgedRules,
    places: visits.length,
    locations,
    notes: [...new Set<string>(all.notes)],
    elapsedMs: Math.round(performance.now() - budget.startedAt),
  }
  writeJson(reportFile(test.info(), pass), report)
  expect(
    findings.map((finding: BrowserFinding): string => findingLine(finding)),
    `${pass} pass findings`,
  ).toEqual([])
}

/**
 * Whether the test runs in Chromium.
 * @param page the test's page.
 * @returns true in Chromium.
 */
export const isChromium = (page: Page): boolean => engineOf(page) === 'chromium'

/** A location at one viewport, the item most passes visit. */
export interface PlaceItem {
  readonly location: SweepLocation
  readonly viewport: FindingViewport
}

/**
 * How a budget finding names a location at a viewport.
 * @param item the location and viewport.
 * @returns its label.
 */
export const itemLabel = (item: PlaceItem): string =>
  `${item.location.location} @${String(item.viewport.width)}x${String(item.viewport.height)}`

/** The rules a resting scan judges. */
export const RESTING_JUDGED: readonly string[] = [...LAYOUT_RULES, ...RESTING_ELEMENT_RULES, FONT_LOAD_RULE]

/**
 * One route per template and every story, for the passes that sample instead of covering all.
 * @param discovery what discovery recorded.
 * @returns the sampled locations.
 */
export const sampledLocations = (discovery: Discovery): readonly SweepLocation[] => {
  const sampled: ReadonlySet<string> = new Set<string>(
    discovery.samples.map((sample: TemplateSample): string => sample.route),
  )
  const stories: ReadonlySet<string> = new Set<string>(
    storySamples(discovery.stories).map((story: DiscoveredStory): string => storyLocation(story)),
  )
  return discovery.locations.filter((location: SweepLocation): boolean =>
    (location.isStory ? stories : sampled).has(location.location),
  )
}
