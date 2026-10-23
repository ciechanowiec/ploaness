// The sweep's disclosure pass: every disclosure opened, what it reveals judged, and how it answers the
// keyboard.
import { type Locator, type Page, test } from '@playwright/test'
import {
  type BrowserFinding,
  disclosureDefects,
  type FindingPlace,
  type FindingViewport,
  findingAt,
  STRESS_VIEWPORTS,
} from '@ploaness/governance'
import { type TargetFacts, targetFacts } from './layout.js'
import { axeFindings, judgeRestingPlace, type PlaceScan, settleFindings } from './scanner.js'
import { settleForScan } from './settle.js'
import { carried } from './sweep-interaction.js'
import {
  armBudget,
  type Budget,
  DISCLOSURE_ATTRIBUTE,
  type Discovery,
  type DomElement,
  type DomWindow,
  EMPTY_VISIT,
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
  type Visit,
  visitAll,
} from './sweep-shared.js'

const DISCLOSURES: string =
  '[aria-expanded="false"], [aria-haspopup]:not([aria-haspopup="false"]), details:not([open]) > summary'

// Mark the disclosures it is safe to open: visible, outside forms unless declared `type="button"`, and
// never a link that navigates. Answers how many were marked.
const markDisclosuresInPage = ([selector, attribute]: readonly [string, string]): number => {
  const page: DomWindow = globalThis as unknown as DomWindow
  const safe: readonly DomElement[] = Array.from(page.document.querySelectorAll(selector)).filter(
    (element: DomElement): boolean => {
      const tag: string = element.tagName.toLowerCase()
      const href: string | null = element.getAttribute('href')
      const isNavigating: boolean = tag === 'a' && href !== null && !href.startsWith('#')
      const isSubmitting: boolean =
        element.closest('form') !== null && !(tag === 'button' && element.getAttribute('type') === 'button')
      return element.checkVisibility() && !isNavigating && !isSubmitting
    },
  )
  for (const [index, element] of safe.entries()) {
    element.setAttribute(attribute, String(index))
  }
  return safe.length
}

interface DisclosureFacts {
  readonly url: string
  readonly history: number
  readonly expanded: string | null
  readonly isPopup: boolean
  readonly isModalOpen: boolean
  readonly isFocusInModal: boolean
  readonly isFocusOnControl: boolean
}

const disclosureFactsInPage = (selector: string): DisclosureFacts => {
  const page: DomWindow = globalThis as unknown as DomWindow
  const control: DomElement | null = page.document.querySelector(selector)
  const modal: DomElement | null = page.document.querySelector(
    'dialog:modal, [role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]',
  )
  const isModalOpen: boolean = modal?.checkVisibility() === true
  const active: DomElement | null = page.document.activeElement
  const attributeOf = (name: string): string | null => control?.getAttribute(name) ?? null
  const containsFocus = (container: DomElement | null): boolean =>
    container !== null && active !== null && (container === active || container.contains(active))
  return {
    url: page.location.href,
    history: page.history.length,
    expanded: attributeOf('aria-expanded'),
    isPopup: (attributeOf('aria-haspopup') ?? 'false') !== 'false',
    isModalOpen,
    isFocusInModal: isModalOpen && containsFocus(modal),
    isFocusOnControl: containsFocus(control),
  }
}

const MAX_TRAP_STEPS: number = 30

const isTrapped = async (page: Page, selector: string, remaining: number): Promise<boolean> => {
  if (remaining <= 0) {
    return true
  }
  await page.keyboard.press('Tab')
  const facts: DisclosureFacts = await page.evaluate(disclosureFactsInPage, selector)
  return facts.isFocusInModal && (await isTrapped(page, selector, remaining - 1))
}

interface OpenedDisclosure {
  readonly page: Page
  readonly selector: string
  readonly control: Locator
  readonly before: DisclosureFacts
  readonly opened: DisclosureFacts
  readonly place: FindingPlace
  readonly facts: TargetFacts | undefined
}

const labelOfDisclosure = (facts: TargetFacts | undefined): string => facts?.label ?? 'a disclosure'

// Escape for a popup or a modal dialog, then the keyboard judgement, then a click to close whatever the
// keyboard did not, so the next disclosure starts from a closed page.
const dismissDisclosure = async (disclosure: OpenedDisclosure): Promise<readonly Visit[]> => {
  const { page, selector, control, before, opened, place, facts }: OpenedDisclosure = disclosure
  const isFocusTrapped: boolean = opened.isModalOpen && (await isTrapped(page, selector, MAX_TRAP_STEPS))
  const isDismissible: boolean = before.isPopup || opened.isModalOpen
  if (isDismissible) {
    await page.keyboard.press('Escape')
  }
  const closed: DisclosureFacts = await page.evaluate(disclosureFactsInPage, selector)
  const isClosedOnEscape: boolean = isDismissible && !closed.isModalOpen && closed.expanded !== 'true'
  if (!isClosedOnEscape && (await control.isVisible())) {
    await control.click()
  }
  await settleForScan(page)
  return disclosureDefects({
    isPopup: before.isPopup,
    closedOnEscape: isClosedOnEscape,
    focusReturned: closed.isFocusOnControl,
    isModal: opened.isModalOpen,
    focusTrapped: isFocusTrapped,
  }).map(
    (defect: string): Visit =>
      carried(findingAt(place, 'disclosure-keyboard', `${labelOfDisclosure(facts)}: ${defect}`), facts),
  )
}

const judgeOpened = async (page: Page, place: FindingPlace): Promise<Visit> => {
  const unsettled: readonly BrowserFinding[] = await settleFindings(page, place)
  const judged: PlaceScan = await judgeRestingPlace(page, place)
  const axe: readonly BrowserFinding[] = await axeFindings(page, place)
  return { ...judged, findings: [...unsettled, ...judged.findings, ...axe], notes: [] }
}

interface DrivenDisclosure {
  readonly visit: Visit
  readonly isAborted: boolean
}

const driveDisclosure = async (page: Page, item: PlaceItem, index: number): Promise<DrivenDisclosure> => {
  const selector: string = `[${DISCLOSURE_ATTRIBUTE}="${String(index)}"]`
  const control: Locator = page.locator(selector)
  if (!(await control.isVisible())) {
    return { visit: EMPTY_VISIT, isAborted: false }
  }
  const before: DisclosureFacts = await page.evaluate(disclosureFactsInPage, selector)
  const facts: TargetFacts | undefined = await targetFacts(page, selector)
  await control.click()
  const opened: DisclosureFacts = await page.evaluate(disclosureFactsInPage, selector)
  if (opened.url !== before.url || opened.history !== before.history) {
    return {
      visit: {
        ...EMPTY_VISIT,
        notes: [
          `${item.location.location}: opening ${labelOfDisclosure(facts)} changed the URL, so the disclosures ` +
            'after it went unchecked',
        ],
      },
      isAborted: true,
    }
  }
  const place: FindingPlace = placeAt(page, item.location, item.viewport, `disclosure ${labelOfDisclosure(facts)}`)
  const revealed: Visit = await judgeOpened(page, place)
  const keyboard: readonly Visit[] = await dismissDisclosure({ page, selector, control, before, opened, place, facts })
  return { visit: merged([revealed, ...keyboard]), isAborted: false }
}

const driveDisclosures = async (
  page: Page,
  item: PlaceItem,
  index: number,
  count: number,
): Promise<readonly Visit[]> => {
  if (index >= count) {
    return []
  }
  const driven: DrivenDisclosure = await driveDisclosure(page, item, index)
  return driven.isAborted ? [driven.visit] : [driven.visit, ...(await driveDisclosures(page, item, index + 1, count))]
}

const disclosureVisit = async (page: Page, item: PlaceItem): Promise<Visit> => {
  const place: FindingPlace = placeAt(page, item.location, item.viewport, 'resting')
  const loaded: readonly BrowserFinding[] = await loadLocation(page, item.location, item.viewport, place)
  await settleForScan(page)
  const count: number = await page.evaluate(markDisclosuresInPage, [DISCLOSURES, DISCLOSURE_ATTRIBUTE] as const)
  const driven: readonly Visit[] = await driveDisclosures(page, item, 0, count)
  return merged([{ ...EMPTY_VISIT, findings: loaded }, ...driven, await healthOf(page, place)])
}

const DISCLOSURE_RULES: readonly string[] = [...RESTING_JUDGED, 'disclosure-keyboard']

/**
 * Open every disclosure on every location, judge what it reveals, and judge how it answers the keyboard.
 * @param page the test's page.
 */
export const expectDisclosureStates = async (page: Page): Promise<void> => {
  test.info().skip(!isChromium(page), 'the disclosure pass runs in Chromium')
  const discovery: Discovery = readDiscovery(test.info())
  const items: readonly PlaceItem[] = discovery.locations.flatMap((location: SweepLocation): readonly PlaceItem[] =>
    STRESS_VIEWPORTS.map((viewport: FindingViewport): PlaceItem => ({ location, viewport })),
  )
  const budget: Budget = armBudget('disclosures', items.length)
  await preparePage(page)
  const visits: readonly Visit[] = await visitAll(items, {
    budget,
    labelOf: itemLabel,
    visit: async (item: PlaceItem): Promise<Visit> => await disclosureVisit(page, item),
  })
  finishPass(page, {
    budget,
    pass: 'disclosures',
    visits,
    judgedRules: DISCLOSURE_RULES,
    locations: discovery.locations.map((location: SweepLocation): string => location.location),
  })
}
