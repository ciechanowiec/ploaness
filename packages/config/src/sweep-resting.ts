// The sweep's resting passes: every resting rule on a fresh load at each viewport, in Chromium, in the
// other engines, and in the dark scheme.
import { type Page, test } from '@playwright/test'
import {
  BASELINE_VIEWPORTS,
  type BrowserFinding,
  type FindingPlace,
  type FindingViewport,
  pageViewports,
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
  merged,
  type PlaceItem,
  placeAt,
  preparePage,
  RESTING_JUDGED,
  readDiscovery,
  type SweepLocation,
  sampledLocations,
  screenshotOf,
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

const restingItems = (locations: readonly SweepLocation[], shouldIncludeEdges: boolean): readonly PlaceItem[] =>
  locations.flatMap((location: SweepLocation): readonly PlaceItem[] =>
    (shouldIncludeEdges ? pageViewports(location.edges, projectSettings.layoutViewports) : BASELINE_VIEWPORTS).map(
      (viewport: FindingViewport): PlaceItem => ({ location, viewport }),
    ),
  )

/**
 * Judge every location at every baseline and breakpoint-edge viewport by every resting rule.
 * @param page the test's page.
 */
export const expectRestingRules = async (page: Page): Promise<void> => {
  test.info().skip(!isChromium(page), 'the resting pass runs in Chromium; other engines run the engine pass')
  const discovery: Discovery = readDiscovery(test.info())
  const items: readonly PlaceItem[] = restingItems(discovery.locations, true)
  const budget: Budget = armBudget('resting', items.length)
  await preparePage(page)
  const visits: readonly Visit[] = await visitAll(items, {
    budget,
    labelOf: itemLabel,
    visit: async (item: PlaceItem, index: number): Promise<Visit> => await restingVisit(page, item, index),
  })
  finishPass(page, {
    pass: 'resting',
    visits,
    judgedRules: RESTING_JUDGED,
    locations: discovery.locations.map((location: SweepLocation): string => location.location),
  })
}

/**
 * Judge one route per template and every story by every resting rule in Firefox or WebKit.
 * @param page the test's page.
 */
export const expectEngineRules = async (page: Page): Promise<void> => {
  test.info().skip(isChromium(page), 'Chromium runs the full resting pass')
  const discovery: Discovery = readDiscovery(test.info())
  const locations: readonly SweepLocation[] = sampledLocations(discovery)
  const items: readonly PlaceItem[] = restingItems(locations, false)
  const budget: Budget = armBudget('engine', items.length)
  await preparePage(page)
  const visits: readonly Visit[] = await visitAll(items, {
    budget,
    labelOf: itemLabel,
    visit: async (item: PlaceItem, index: number): Promise<Visit> => await restingVisit(page, item, index),
  })
  finishPass(page, {
    pass: 'engine',
    visits,
    judgedRules: RESTING_JUDGED,
    locations: locations.map((location: SweepLocation): string => location.location),
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
 * Judge every location whose stylesheets declare a dark scheme again in it, from a fresh load.
 * @param page the test's page.
 */
export const expectDarkScheme = async (page: Page): Promise<void> => {
  test.info().skip(!isChromium(page), 'the dark-scheme pass runs in Chromium')
  const discovery: Discovery = readDiscovery(test.info())
  const locations: readonly SweepLocation[] = discovery.locations.filter(
    (location: SweepLocation): boolean => location.hasDarkMedia || location.hasDarkClass,
  )
  const items: readonly PlaceItem[] = restingItems(locations, false)
  const budget: Budget = armBudget('dark-scheme', items.length)
  await preparePage(page)
  const visits: readonly Visit[] = await visitAll(items, {
    budget,
    labelOf: itemLabel,
    visit: async (item: PlaceItem, index: number): Promise<Visit> => await darkVisit(page, item, index),
  })
  await page.emulateMedia({ colorScheme: null })
  finishPass(page, {
    pass: 'dark-scheme',
    visits,
    judgedRules: RESTING_JUDGED,
    locations: locations.map((location: SweepLocation): string => location.location),
  })
}
