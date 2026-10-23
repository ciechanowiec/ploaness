// The sweep's interaction pass: hover and keyboard focus on every control.
import { type Locator, type Page, test } from '@playwright/test'
import {
  type BrowserFinding,
  type CarriedJudgement,
  classifyHitTarget,
  type FindingPlace,
  type FindingViewport,
  FOCUS_RING_WIDTH,
  type FocusSample,
  findingAt,
  type HitTargetClassification,
  type HitTargetProbe,
  hasVisibleFocus,
  judgeCarried,
  obscuringContent,
  type ShardItem,
  STRESS_VIEWPORTS,
  shardOf,
} from '@ploaness/governance'
import { type TargetFacts, targetFacts } from './layout.js'
import { axeFindings, settleFindings } from './scanner.js'
import { settleForScan } from './settle.js'
import {
  armBudget,
  type Budget,
  CHROME,
  CONTROLS,
  type ComputedStyleOf,
  DESKTOP,
  type Discovery,
  type DomDocument,
  type DomElement,
  type DomRect,
  type DomStyle,
  EMPTY_VISIT,
  finishPass,
  healthOf,
  isChromium,
  itemLabel,
  loadLocation,
  locationOfItem,
  merged,
  type PlaceItem,
  PROBE_ATTRIBUTE,
  placeAt,
  preparePage,
  readDiscovery,
  type Shard,
  STILL_STYLE,
  type SweepLocation,
  shardLocations,
  shardUnits,
  type Visit,
  visitAll,
} from './sweep-shared.js'

// The browser surface the page functions below touch, declared for the reason `settle.ts` records.
declare const document: DomDocument
declare const getComputedStyle: ComputedStyleOf

const PROBE_SELECTOR: string = `[${PROBE_ATTRIBUTE}]`

// What the browser has to say before a control can be classified. Scrolled and hit-tested in one
// evaluate, so reading the box and hit-testing it cannot straddle a scroll.
const probeHitTarget = async (control: Locator): Promise<HitTargetProbe> =>
  await control.evaluate((element: DomElement): HitTargetProbe => {
    const halves: number = 2
    element.scrollIntoView({ block: 'center', inline: 'center' })
    const box: DomRect = element.getBoundingClientRect()
    const style: DomStyle = getComputedStyle(element)
    const atCentre: DomElement | null = element.ownerDocument.elementFromPoint(
      box.left + box.width / halves,
      box.top + box.height / halves,
    )
    return {
      width: box.width,
      height: box.height,
      clipPath: style.clipPath,
      clip: style.getPropertyValue('clip'),
      ownsCentrePoint: atCentre !== null && element.contains(atCentre),
    }
  })

const markProbe = async (control: Locator, isMarked: boolean): Promise<void> => {
  await control.evaluate(
    (element: DomElement, [name, marked]: readonly [string, boolean]): void => {
      if (marked) {
        element.setAttribute(name, '')
      } else {
        element.removeAttribute(name)
      }
    },
    [PROBE_ATTRIBUTE, isMarked] as const,
  )
}

/**
 * A finding on a driven element, judged against the exemptions above it.
 * @param finding the finding.
 * @param facts the element and the exemptions above it.
 * @returns the visit carrying the finding, or the exemption that excused it.
 */
export const carried = (finding: BrowserFinding, facts: TargetFacts | undefined): Visit => {
  const judged: CarriedJudgement = judgeCarried(finding, facts?.exemptions ?? [])
  return {
    findings: judged.finding === undefined ? [] : [judged.finding],
    used: judged.used,
    declared: judged.declared,
    notes: [],
  }
}

const hoverControl = async (page: Page, control: Locator, place: FindingPlace): Promise<Visit> => {
  const reach: HitTargetClassification = classifyHitTarget(await probeHitTarget(control))
  await markProbe(control, true)
  const facts: TargetFacts | undefined = await targetFacts(page, PROBE_SELECTOR)
  if (reach.verdict === 'obscured') {
    await markProbe(control, false)
    return carried(
      findingAt(place, 'obscured', `${facts?.label ?? 'a control'} cannot be reached by a pointer: ${reach.reason}`),
      facts,
    )
  }
  if (reach.verdict !== 'hoverable') {
    await markProbe(control, false)
    return EMPTY_VISIT
  }
  await control.hover()
  await settleForScan(page)
  const contrast: readonly BrowserFinding[] = await axeFindings(page, { ...place, state: 'hover' }, (builder) =>
    builder.include(PROBE_SELECTOR).withRules(['color-contrast']),
  )
  await markProbe(control, false)
  return { ...EMPTY_VISIT, findings: contrast }
}

// The page's own controls. Locators pierce shadow roots, which reach a framework's development overlay
// as well as a component's internals; a control the document cannot name is one no finding could
// point a reader to, so the sweep drives the document's own controls. A control the browser does not render -
// inside a closed `<details>`, or under `display: none` - cannot be operated, and Chromium still reports
// a box for some of them; a visually hidden skip link is rendered and is still driven.
const controlsToDrive = async (page: Page, shouldIncludeChrome: boolean): Promise<readonly Locator[]> => {
  const all: readonly Locator[] = await page.locator(CONTROLS).all()
  const kept: readonly boolean[] = await Promise.all(
    all.map(
      async (control: Locator): Promise<boolean> =>
        await control.evaluate(
          (element: DomElement, [chrome, keep]: readonly [string, boolean]): boolean =>
            element.getRootNode() === element.ownerDocument &&
            element.checkVisibility() &&
            (keep || element.closest(chrome) === null),
          [CHROME, shouldIncludeChrome] as const,
        ),
    ),
  )
  return all.filter((_control: Locator, index: number): boolean => kept[index] === true)
}

interface ScreenClip {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

interface FocusState {
  readonly facts: TargetFacts | undefined
  readonly samples: readonly FocusSample[]
  readonly clip: ScreenClip | undefined
}

// Where the focused element is, and whether fixed or sticky content covers it at five points.
const focusStateInPage = (ring: number): Omit<FocusState, 'facts'> => {
  const active: DomElement | null = document.activeElement
  if (active === null || active === document.body) {
    return { samples: [], clip: undefined }
  }
  const box: DomRect = active.getBoundingClientRect()
  const width: number = document.documentElement.clientWidth
  const height: number = document.documentElement.clientHeight
  const left: number = Math.max(0, box.left)
  const top: number = Math.max(0, box.top)
  const right: number = Math.min(width, box.right)
  const bottom: number = Math.min(height, box.bottom)
  if (right - left < 1 || bottom - top < 1) {
    return { samples: [], clip: undefined }
  }
  const halves: number = 2
  const quarters: number = 4
  const maximumInset: number = 2
  const inset: number = Math.min(maximumInset, (right - left) / quarters, (bottom - top) / quarters)
  const points: readonly (readonly [number, number])[] = [
    [(left + right) / halves, (top + bottom) / halves],
    [left + inset, top + inset],
    [right - inset, top + inset],
    [left + inset, bottom - inset],
    [right - inset, bottom - inset],
  ]
  const pinned = (element: DomElement | null): DomElement | null =>
    element === null || ['fixed', 'sticky'].includes(getComputedStyle(element).position)
      ? element
      : pinned(element.parentElement)
  const describe = (element: DomElement): string =>
    [element.tagName.toLowerCase(), ...(element.id.length > 0 ? [element.id] : [])].join('#')
  const samples: readonly FocusSample[] = points.map(([pointX, pointY]: readonly [number, number]): FocusSample => {
    const hit: DomElement | null = document.elementFromPoint(pointX, pointY)
    const cover: DomElement | null = hit === null || active.contains(hit) || hit.contains(active) ? null : pinned(hit)
    return { isCovered: cover !== null && !cover.contains(active), coveredBy: cover === null ? '' : describe(cover) }
  })
  const clipLeft: number = Math.max(0, box.left - ring)
  const clipTop: number = Math.max(0, box.top - ring)
  return {
    samples,
    clip: {
      x: Math.floor(clipLeft),
      y: Math.floor(clipTop),
      width: Math.ceil(Math.min(width, box.right + ring) - clipLeft),
      height: Math.ceil(Math.min(height, box.bottom + ring) - clipTop),
    },
  }
}

const blurInPage = (): void => {
  document.activeElement?.blur?.()
}

const markFocusedInPage = (name: string): void => {
  document.activeElement?.setAttribute(name, '')
}

const unmarkInPage = ([selector, name]: readonly [string, string]): void => {
  document.querySelector(selector)?.removeAttribute(name)
}

interface FocusStop {
  readonly visit: Visit
  readonly key: string | undefined
}

const focusStop = async (page: Page, place: FindingPlace): Promise<FocusStop> => {
  const facts: TargetFacts | undefined = await targetFacts(page, null)
  if (facts === undefined) {
    return { visit: EMPTY_VISIT, key: undefined }
  }
  const state: Omit<FocusState, 'facts'> = await page.evaluate(focusStateInPage, FOCUS_RING_WIDTH)
  const focusPlace: FindingPlace = { ...place, state: 'focus' }
  const covering: string | undefined = obscuringContent(state.samples)
  const obscured: Visit =
    covering === undefined
      ? EMPTY_VISIT
      : carried(
          findingAt(focusPlace, 'focus-obscured', `${facts.label} is focused and entirely hidden by ${covering}`),
          facts,
        )
  await page.evaluate(markFocusedInPage, PROBE_ATTRIBUTE)
  const contrast: readonly BrowserFinding[] = await axeFindings(page, focusPlace, (builder) =>
    builder.include(PROBE_SELECTOR).withRules(['color-contrast']),
  )
  await page.evaluate(unmarkInPage, [PROBE_SELECTOR, PROBE_ATTRIBUTE] as const)
  const clip: ScreenClip | undefined = state.clip
  if (clip === undefined) {
    return { visit: merged([obscured, { ...EMPTY_VISIT, findings: contrast }]), key: facts.key }
  }
  const focused: Uint8Array = await page.screenshot({ clip, animations: 'disabled', caret: 'hide' })
  await page.evaluate(blurInPage)
  const unfocused: Uint8Array = await page.screenshot({ clip, animations: 'disabled', caret: 'hide' })
  const invisible: Visit = hasVisibleFocus(unfocused, focused)
    ? EMPTY_VISIT
    : carried(
        findingAt(focusPlace, 'focus-visible', `${facts.label} shows no visible change when focused by keyboard`),
        facts,
      )
  return { visit: merged([obscured, invisible, { ...EMPTY_VISIT, findings: contrast }]), key: facts.key }
}

// Tab through the page once from its start: each stop is judged, and the walk ends when focus leaves
// the document or comes back to an element already visited.
const tabThrough = async (
  page: Page,
  place: FindingPlace,
  remaining: number,
  seen: ReadonlySet<string>,
): Promise<readonly Visit[]> => {
  if (remaining <= 0) {
    return []
  }
  await page.keyboard.press('Tab')
  const stop: FocusStop = await focusStop(page, place)
  if (stop.key === undefined || seen.has(stop.key)) {
    return [stop.visit]
  }
  return [stop.visit, ...(await tabThrough(page, place, remaining - 1, new Set<string>([...seen, stop.key])))]
}

// The tab walk may take this many stops beyond the controls discovery counted.
const EXTRA_TAB_STOPS: number = 2

const interactionVisit = async (page: Page, item: PlaceItem, isFirst: boolean): Promise<Visit> => {
  const place: FindingPlace = placeAt(page, item.location, item.viewport, 'resting')
  const loaded: readonly BrowserFinding[] = await loadLocation(page, item.location, item.viewport, place)
  const unsettled: readonly BrowserFinding[] = await settleFindings(page, place)
  const controls: readonly Locator[] = await controlsToDrive(page, isFirst)
  // Hover is a pointer state, and a phone has no pointer to hover with.
  const hovered: readonly Visit[] =
    item.viewport.width === DESKTOP.width
      ? await controls.reduce(
          async (earlier: Promise<readonly Visit[]>, control: Locator): Promise<readonly Visit[]> => [
            ...(await earlier),
            await hoverControl(page, control, place),
          ],
          Promise.resolve<readonly Visit[]>([]),
        )
      : []
  await page.goto(item.location.url)
  await page.addStyleTag({ content: STILL_STYLE })
  await settleForScan(page)
  const focused: readonly Visit[] = await tabThrough(
    page,
    place,
    item.location.controls + EXTRA_TAB_STOPS,
    new Set<string>(),
  )
  return merged([
    { ...EMPTY_VISIT, findings: [...loaded, ...unsettled] },
    ...hovered,
    ...focused,
    await healthOf(page, place),
  ])
}

const INTERACTION_RULES: readonly string[] = ['obscured', 'focus-obscured', 'focus-visible']

/**
 * Drive every control of one shard of the locations into hover and keyboard focus, and judge contrast,
 * reach and focus visibility.
 * @param page the test's page.
 * @param shard the part of the pass this test visits.
 */
export const expectInteractionStates = async (page: Page, shard: Shard): Promise<void> => {
  test.info().skip(!isChromium(page), 'the interaction pass runs in Chromium')
  const discovery: Discovery = readDiscovery(test.info())
  const items: readonly ShardItem<PlaceItem>[] = shardOf(
    discovery.locations.flatMap((location: SweepLocation): readonly PlaceItem[] =>
      STRESS_VIEWPORTS.map((viewport: FindingViewport): PlaceItem => ({ location, viewport })),
    ),
    shard,
  )
  const units: number = shardUnits(items, (item: PlaceItem): number => item.location.controls + 1)
  const budget: Budget = armBudget(page, 'interaction', shard, units)
  await preparePage(page)
  const visits: readonly Visit[] = await visitAll(items, {
    budget,
    labelOf: itemLabel,
    // The index is the item's place in the whole pass, so the chrome is driven once per viewport
    // across every shard, by whichever shard holds the first location.
    visit: async (item: PlaceItem, index: number): Promise<Visit> =>
      await interactionVisit(page, item, index < STRESS_VIEWPORTS.length),
  })
  finishPass(page, {
    budget,
    pass: 'interaction',
    visits,
    judgedRules: INTERACTION_RULES,
    locations: shardLocations(items, locationOfItem),
  })
}
