// What every pass of the managed browser sweep shares: the browser surface its page functions touch,
// the files the passes hand each other, loading a location, and the budget each pass runs under.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
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
  type Shard,
  type ShardItem,
  type SweepPass,
  storyLocation,
  storySamples,
  type TemplateSample,
  type UsedExemption,
} from '@ploaness/governance'
import { outlineElements } from './layout.js'
import { projectSettings } from './project-settings.js'
import { engineOf, type HealthReading, healthFindings, type PlaceScan } from './scanner.js'

export type { Shard } from '@ploaness/governance'

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

/** What a shard of a pass leaves for the summary. */
export interface PassReport {
  readonly pass: SweepPass
  readonly engine: string
  readonly shard: Shard
  readonly findings: readonly BrowserFinding[]
  readonly used: readonly UsedExemption[]
  readonly declared: readonly DeclaredExemption[]
  readonly judgedRules: readonly string[]
  readonly places: number
  readonly locations: readonly string[]
  readonly notes: readonly string[]
  /** How long the shard took, which is what its budget allowance is calibrated against. */
  readonly elapsedMs: number
}

/**
 * What discovery leaves for the summary. Discovery records its problems rather than failing on them,
 * because every pass depends on it and a failed dependency would stop them all; the summary judges them.
 */
export interface DiscoveryReport {
  readonly findings: readonly BrowserFinding[]
  /** Why the discovery is incomplete: the seed did not answer, the route cap, declared pages unswept. */
  readonly problems: readonly string[]
  readonly places: number
  readonly locations: readonly string[]
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
 * The directory every engine's passes hand their files through. Every project shares the config's
 * output directory, so discovery, run once, is read from here by every engine.
 * @param info the running test.
 * @returns the directory.
 */
export const sweepRoot = (info: TestInfo): string => path.join(info.project.outputDir, SWEEP_DIRECTORY)

/**
 * The directory the passes of one engine write their reports and progress to.
 * @param info the running test.
 * @param engine the engine.
 * @returns the directory.
 */
export const engineDirectory = (info: TestInfo, engine: string): string => path.join(sweepRoot(info), engine)

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
 * The file discovery writes for every later pass, in every engine.
 * @param info the running test.
 * @returns the file.
 */
export const discoveryFile = (info: TestInfo): string => path.join(sweepRoot(info), 'discovered.json')

/**
 * The file discovery writes its findings and problems to, for the summary.
 * @param info the running test.
 * @returns the file.
 */
export const discoveryReportFile = (info: TestInfo): string => path.join(sweepRoot(info), 'discovery.json')

/**
 * How a report file names one shard of a pass.
 * @param pass the pass.
 * @param shard the shard.
 * @returns the file's name.
 */
export const reportName = (pass: SweepPass, shard: Shard): string =>
  `${pass}-${String(shard.index + 1)}-of-${String(shard.count)}.json`

/**
 * The file one shard of a pass writes its report to.
 * @param info the running test.
 * @param engine the engine it ran in.
 * @param pass the pass.
 * @param shard the shard.
 * @returns the file.
 */
export const reportFile = (info: TestInfo, engine: string, pass: SweepPass, shard: Shard): string =>
  path.join(engineDirectory(info, engine), reportName(pass, shard))

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

const MS_PER_SECOND: number = 1000

/** The whole of a pass that is not split, which is discovery. */
export const WHOLE_PASS: Shard = { index: 0, count: 1 }

/** The time one shard of a pass may spend, and where it records its progress. */
export interface Budget {
  readonly pass: SweepPass
  readonly shard: Shard
  readonly progressFile: string
  readonly startedAt: number
  readonly deadline: number
}

/**
 * Start a shard's budget and set its test's timeout beyond it.
 * @param page the test's page, whose engine names the progress log.
 * @param pass the pass.
 * @param shard the shard.
 * @param units how many units of work the shard has.
 * @returns the budget.
 */
export const armBudget = (page: Page, pass: SweepPass, shard: Shard, units: number): Budget => {
  const budgetMs: number = passBudgetMs(pass, units)
  test.info().setTimeout(budgetMs + TIMEOUT_GRACE_MS)
  const directory: string = engineDirectory(test.info(), engineOf(page))
  mkdirSync(directory, { recursive: true })
  const startedAt: number = performance.now()
  return { pass, shard, progressFile: path.join(directory, 'progress.log'), startedAt, deadline: startedAt + budgetMs }
}

/**
 * How many units of work a shard's items carry, for its budget.
 * @param items the shard's items.
 * @param unitsOf the units one item carries.
 * @returns their sum.
 */
export const shardUnits = <Item>(items: readonly ShardItem<Item>[], unitsOf: (item: Item) => number): number =>
  items.reduce((total: number, shardItem: ShardItem<Item>): number => total + unitsOf(shardItem.item), 0)

/** How a pass visits its items. */
interface ItemVisitor<Item> {
  readonly budget: Budget
  readonly labelOf: (item: Item) => string
  /** Visit an item; the index is its place in the whole pass, not in the shard. */
  readonly visit: (item: Item, index: number) => Promise<Visit>
}

// A pass of thousands of loads otherwise says nothing until it ends, and the e2e gate shows its output
// only then too. One line per item, written as it finishes, lets anyone see how far a pass has got and
// how fast it goes. Seconds since the shard started, because the runner's own clock is the shifted one.
// The shards of every pass in one engine append to one log, a line at a time.
const recordProgress = (budget: Budget, item: string): void => {
  const seconds: string = ((performance.now() - budget.startedAt) / MS_PER_SECOND).toFixed(1)
  const part: string = `${String(budget.shard.index + 1)}/${String(budget.shard.count)}`
  appendFileSync(budget.progressFile, `${budget.pass} part ${part} ${seconds}s ${item}\n`)
}

/**
 * Visit each item of a shard in turn, stopping with a finding when the shard runs out of budget.
 * @param items the items of the shard, each with its index in the whole pass.
 * @param visitor the budget, and how to name and visit an item.
 * @param index the item of the shard to visit next.
 * @returns one visit per item visited, and a budget finding when the shard stopped early.
 */
export const visitAll = async <Item>(
  items: readonly ShardItem<Item>[],
  visitor: ItemVisitor<Item>,
  index: number = 0,
): Promise<readonly Visit[]> => {
  const { budget, labelOf, visit }: ItemVisitor<Item> = visitor
  const next: ShardItem<Item> | undefined = items[index]
  if (next === undefined) {
    return []
  }
  const { item }: ShardItem<Item> = next
  if (performance.now() > budget.deadline) {
    return [
      {
        ...EMPTY_VISIT,
        findings: [
          findingAt(
            { location: labelOf(item), state: budget.pass, engine: '', viewport: undefined },
            PASS_BUDGET_RULE,
            `part ${String(budget.shard.index + 1)} of the ${budget.pass} pass ran out of its budget at this item, ` +
              `with ${String(items.length - index)} of its ${String(items.length)} items unvisited`,
          ),
        ],
      },
    ]
  }
  const visited: Visit = await visit(item, next.index)
  recordProgress(budget, `${String(index + 1)}/${String(items.length)} ${labelOf(item)}`)
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
 * Write a shard's report for the summary, and fail the shard's test on any finding.
 * @param page the test's page.
 * @param finished the pass, its visits, the rules it judged and the locations it covered.
 */
export const finishPass = (page: Page, finished: FinishedPass): void => {
  const { budget, pass, visits, judgedRules, locations }: FinishedPass = finished
  const all: Visit = merged(visits)
  const findings: readonly BrowserFinding[] = distinctFindings(all.findings)
  const engine: string = engineOf(page)
  const report: PassReport = {
    pass,
    engine,
    shard: budget.shard,
    findings,
    used: all.used,
    declared: all.declared,
    judgedRules,
    places: visits.length,
    locations,
    notes: [...new Set<string>(all.notes)],
    elapsedMs: Math.round(performance.now() - budget.startedAt),
  }
  writeJson(reportFile(test.info(), engine, pass, budget.shard), report)
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

/**
 * The locations a shard's items cover, each once.
 * @param items the shard's items.
 * @param locationOf the location an item visits.
 * @returns the locations' names.
 */
export const shardLocations = <Item>(
  items: readonly ShardItem<Item>[],
  locationOf: (item: Item) => SweepLocation,
): readonly string[] => [
  ...new Set<string>(items.map((shardItem: ShardItem<Item>): string => locationOf(shardItem.item).location)),
]

/**
 * The location of a place item.
 * @param item the location and viewport.
 * @returns the location.
 */
export const locationOfItem = (item: PlaceItem): SweepLocation => item.location

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
