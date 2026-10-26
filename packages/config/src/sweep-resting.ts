// The sweep's resting passes: every resting rule on a fresh load at each viewport, in Chromium, in the
// other engines, and in the dark scheme.
import { type Page, test } from '@playwright/test'
import {
  BASELINE_VIEWPORTS,
  type BrowserFinding,
  enginePassParts,
  type FindingPlace,
  type FindingViewport,
  pageViewports,
  STRESS_VIEWPORTS,
} from '@ploaness/governance'
import { withinLimit } from './deadline.js'
import { projectSettings } from './project-settings.js'
import {
  axeFindings,
  engineOf,
  isStressViewport,
  judgeRestingPlace,
  type PlaceScan,
  settleFindings,
} from './scanner.js'
import {
  armBudget,
  type Budget,
  type Discovery,
  finishPass,
  healthOf,
  isChromium,
  itemLabel,
  loadLocation,
  locationOfItem,
  merged,
  type PlaceItem,
  placeAt,
  preparePage,
  RESTING_JUDGED,
  readDiscovery,
  type Shard,
  type ShardVisits,
  type SweepLocation,
  sampledLocations,
  screenshotOf,
  shardLocations,
  type Visit,
  visitAll,
} from './sweep-shared.js'

const restingVisit = async (page: Page, item: PlaceItem, index: number): Promise<Visit> => {
  const place: FindingPlace = placeAt(page, item.location, item.viewport, 'resting')
  const loaded: readonly BrowserFinding[] = await loadLocation(page, item.location, item.viewport, place)
  const unsettled: readonly BrowserFinding[] = await settleFindings(page, place)
  const judged: PlaceScan = await judgeRestingPlace(page, place)
  const axe: readonly BrowserFinding[] = isStressViewport(item.viewport) ? await axeFindings(page, place) : []
  const scan: PlaceScan = { ...judged, findings: [...loaded, ...unsettled, ...judged.findings, ...axe] }
  await screenshotOf(page, scan, place, index)
  return merged([{ ...scan, notes: [] }, await healthOf(page, place)])
}

const placeItems = (
  locations: readonly SweepLocation[],
  viewportsOf: (location: SweepLocation) => readonly FindingViewport[],
): readonly PlaceItem[] =>
  locations.flatMap((location: SweepLocation): readonly PlaceItem[] =>
    viewportsOf(location).map((viewport: FindingViewport): PlaceItem => ({ location, viewport })),
  )

// A breakpoint edge is where a page's layout changes. A story renders one component alone in a frame,
// so it is loaded at the baseline and declared viewports only: its own media queries are still met at
// ten widths, and edges on every story would multiply a large Storybook's loads for layouts it lacks.
const edgeViewports = (location: SweepLocation): readonly FindingViewport[] =>
  pageViewports(location.isStory ? [] : location.edges, projectSettings.layoutViewports)

/** How a resting-rule pass differs from the others: what it is, what it visits, and how. */
interface RestingPass {
  readonly pass: 'resting' | 'engine' | 'dark-scheme'
  readonly items: readonly PlaceItem[]
  readonly visit: (page: Page, item: PlaceItem, index: number) => Promise<Visit>
}

// The engine pass visits each place in a page of its own. A WebKit page that has drawn a hundred stories in
// software slows until it stops answering, and a visit given up at its limit leaves its page busy, so one
// shared page turned one hang into every later visit hanging, and the part into one that never ended. A
// page left busy is closed when the part ends, within a limit of its own.
const ABANDONED_PAGE_CLOSE_MS: number = 10_000

const freshPageVisit = async (page: Page, item: PlaceItem, index: number): Promise<Visit> => {
  const fresh: Page = await page.context().newPage()
  await preparePage(fresh)
  const visit: Visit = await restingVisit(fresh, item, index)
  await fresh.close()
  return visit
}

const closeAbandonedPages = async (page: Page): Promise<void> => {
  await Promise.all(
    page
      .context()
      .pages()
      .filter((other: Page): boolean => other !== page)
      .map(async (other: Page): Promise<void> => {
        await withinLimit(other.close(), ABANDONED_PAGE_CLOSE_MS)
      }),
  )
}

const runRestingPass = async (page: Page, shard: Shard, restingPass: RestingPass): Promise<void> => {
  const budget: Budget = armBudget(page, restingPass.pass, shard, restingPass.items.length)
  await preparePage(page)
  const { visits, taken }: ShardVisits<PlaceItem> = await visitAll(restingPass.items, {
    budget,
    labelOf: itemLabel,
    visit: async (item: PlaceItem, index: number): Promise<Visit> => await restingPass.visit(page, item, index),
  })
  await closeAbandonedPages(page)
  await page.emulateMedia({ colorScheme: null })
  finishPass(page, {
    budget,
    pass: restingPass.pass,
    visits,
    judgedRules: RESTING_JUDGED,
    locations: shardLocations(taken, locationOfItem),
  })
}

/**
 * Judge one shard of every location at every baseline and breakpoint-edge viewport by every resting rule.
 * @param page the test's page.
 * @param shard the part of the pass this test visits.
 */
export const expectRestingRules = async (page: Page, shard: Shard): Promise<void> => {
  test.info().skip(!isChromium(page), 'the resting pass runs in Chromium; other engines run the engine pass')
  const discovery: Discovery = readDiscovery(test.info())
  await runRestingPass(page, shard, {
    pass: 'resting',
    items: placeItems(discovery.locations, edgeViewports),
    visit: restingVisit,
  })
}

/**
 * Judge one shard of one route per template and every story by every resting rule in Firefox or WebKit.
 * @param page the test's page.
 * @param shard the part of the pass this test visits.
 */
export const expectEngineRules = async (page: Page, shard: Shard): Promise<void> => {
  test.info().skip(isChromium(page), 'Chromium runs the full resting pass')
  const engine: string = engineOf(page)
  const parts: number = enginePassParts(engine, shard.count)
  test.info().skip(shard.index >= parts, `${engine} runs its engine pass in ${String(parts)} parts`)
  const discovery: Discovery = readDiscovery(test.info())
  await runRestingPass(
    page,
    { index: shard.index, count: parts },
    {
      pass: 'engine',
      items: placeItems(sampledLocations(discovery), (): readonly FindingViewport[] => BASELINE_VIEWPORTS),
      visit: freshPageVisit,
    },
  )
}

const darkVisit = async (page: Page, item: PlaceItem, index: number): Promise<Visit> => {
  await page.emulateMedia({ colorScheme: 'dark' })
  const place: FindingPlace = placeAt(page, item.location, item.viewport, 'dark')
  const loaded: readonly BrowserFinding[] = await loadLocation(page, item.location, item.viewport, place)
  const unsettled: readonly BrowserFinding[] = await settleFindings(page, place)
  const judged: PlaceScan = await judgeRestingPlace(page, place)
  const axe: readonly BrowserFinding[] = isStressViewport(item.viewport) ? await axeFindings(page, place) : []
  const scan: PlaceScan = { ...judged, findings: [...loaded, ...unsettled, ...judged.findings, ...axe] }
  await screenshotOf(page, scan, place, index)
  return merged([{ ...scan, notes: [] }, await healthOf(page, place)])
}

/**
 * Judge one shard of every location whose stylesheets answer `prefers-color-scheme` again in the dark
 * scheme, from a fresh load. A `.dark` class is not followed: only the application's own code can set it,
 * so its presence does not show that a visitor can reach it. Only at the two axe widths: the dark scheme
 * changes colour, which axe judges there, while the geometry it shares with the light scheme is judged by
 * the resting pass at every viewport.
 * @param page the test's page.
 * @param shard the part of the pass this test visits.
 */
export const expectDarkScheme = async (page: Page, shard: Shard): Promise<void> => {
  test.info().skip(!isChromium(page), 'the dark-scheme pass runs in Chromium')
  const discovery: Discovery = readDiscovery(test.info())
  const locations: readonly SweepLocation[] = discovery.locations.filter(
    (location: SweepLocation): boolean => location.hasDarkMedia,
  )
  await runRestingPass(page, shard, {
    pass: 'dark-scheme',
    items: placeItems(locations, (): readonly FindingViewport[] => STRESS_VIEWPORTS),
    visit: darkVisit,
  })
}
