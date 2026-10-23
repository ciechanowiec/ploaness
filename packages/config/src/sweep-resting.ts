// The sweep's resting passes: every resting rule on a fresh load at each viewport, in Chromium, in the
// other engines, and in the dark scheme.
import { type Page, test } from '@playwright/test'
import {
  BASELINE_VIEWPORTS,
  type BrowserFinding,
  type FindingPlace,
  type FindingViewport,
  pageViewports,
  type ShardItem,
  STRESS_VIEWPORTS,
  shardOf,
} from '@ploaness/governance'
import { projectSettings } from './project-settings.js'
import { axeFindings, isStressViewport, judgeRestingPlace, type PlaceScan, settleFindings } from './scanner.js'
import {
  armBudget,
  type Budget,
  type Discovery,
  type DomElement,
  type DomWindow,
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

const runRestingPass = async (page: Page, shard: Shard, restingPass: RestingPass): Promise<void> => {
  const items: readonly ShardItem<PlaceItem>[] = shardOf(restingPass.items, shard)
  const budget: Budget = armBudget(page, restingPass.pass, shard, items.length)
  await preparePage(page)
  const visits: readonly Visit[] = await visitAll(items, {
    budget,
    labelOf: itemLabel,
    visit: async (item: PlaceItem, index: number): Promise<Visit> => await restingPass.visit(page, item, index),
  })
  await page.emulateMedia({ colorScheme: null })
  finishPass(page, {
    budget,
    pass: restingPass.pass,
    visits,
    judgedRules: RESTING_JUDGED,
    locations: shardLocations(items, locationOfItem),
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
  const discovery: Discovery = readDiscovery(test.info())
  await runRestingPass(page, shard, {
    pass: 'engine',
    items: placeItems(sampledLocations(discovery), (): readonly FindingViewport[] => BASELINE_VIEWPORTS),
    visit: restingVisit,
  })
}

const DARK_CLASS: string = 'dark'

const darkVisit = async (page: Page, item: PlaceItem, index: number): Promise<Visit> => {
  await page.emulateMedia({ colorScheme: item.location.hasDarkMedia ? 'dark' : 'light' })
  const place: FindingPlace = placeAt(page, item.location, item.viewport, 'dark')
  const loaded: readonly BrowserFinding[] = await loadLocation(page, item.location, item.viewport, place)
  if (item.location.hasDarkClass) {
    await page.evaluate((name: string): void => {
      const root: DomElement = (globalThis as unknown as DomWindow).document.documentElement
      root.setAttribute('class', `${root.getAttribute('class') ?? ''} ${name}`.trim())
    }, DARK_CLASS)
  }
  const unsettled: readonly BrowserFinding[] = await settleFindings(page, place)
  const judged: PlaceScan = await judgeRestingPlace(page, place)
  const axe: readonly BrowserFinding[] = isStressViewport(item.viewport) ? await axeFindings(page, place) : []
  const scan: PlaceScan = { ...judged, findings: [...loaded, ...unsettled, ...judged.findings, ...axe] }
  await screenshotOf(page, scan, place, index)
  return merged([{ ...scan, notes: [] }, await healthOf(page, place)])
}

/**
 * Judge one shard of every location whose stylesheets declare a dark scheme again in it, from a fresh
 * load. Only at the two axe widths: the dark scheme changes colour, which axe judges there, while the
 * geometry it shares with the light scheme is judged by the resting pass at every viewport.
 * @param page the test's page.
 * @param shard the part of the pass this test visits.
 */
export const expectDarkScheme = async (page: Page, shard: Shard): Promise<void> => {
  test.info().skip(!isChromium(page), 'the dark-scheme pass runs in Chromium')
  const discovery: Discovery = readDiscovery(test.info())
  const locations: readonly SweepLocation[] = discovery.locations.filter(
    (location: SweepLocation): boolean => location.hasDarkMedia || location.hasDarkClass,
  )
  await runRestingPass(page, shard, {
    pass: 'dark-scheme',
    items: placeItems(locations, (): readonly FindingViewport[] => STRESS_VIEWPORTS),
    visit: darkVisit,
  })
}
