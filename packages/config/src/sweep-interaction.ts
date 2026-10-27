// The sweep's interaction pass: hover and keyboard focus on every control.
import { type Locator, type Page, test } from '@playwright/test'
import {
  type BrowserFinding,
  type CarriedJudgement,
  classifyHitTarget,
  type FindingPlace,
  FOCUS_CONTRAST_RATIO,
  FOCUS_RING_WIDTH,
  type FocusPosition,
  type FocusSample,
  findingAt,
  type HitTargetClassification,
  type HitTargetProbe,
  isFocusBackwards,
  judgeCarried,
  obscuringContent,
} from '@ploaness/governance'
import { type FocusVerdict, judgeFocusIndicator } from './focus-region.js'
import { type TargetFacts, targetFacts } from './layout.js'
import { isPerceivableWithin } from './perceivable.js'
import { axeFindings, settleFindings } from './scanner.js'
import { settleForScan } from './settle.js'
import { type InteractionPlace, type InteractionPlan, interactionPlan, placeUnits } from './sweep-interaction-plan.js'
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
  PROBE_ATTRIBUTE,
  passUnits,
  placeAt,
  preparePage,
  readDiscovery,
  type Shard,
  type ShardVisits,
  shardLocations,
  type Visit,
  visitAll,
} from './sweep-shared.js'

// The browser surface the page functions below touch, declared for the reason `settle.ts` records.
declare const document: DomDocument
declare const getComputedStyle: ComputedStyleOf

const PROBE_SELECTOR: string = `[${PROBE_ATTRIBUTE}]`
const POINTER_ACTION_TIMEOUT_MS: number = 5000

// Read the box and hit target together, without advancing a scroll-driven scene while measuring it.
const probeHitTarget = async (control: Locator): Promise<HitTargetProbe> => {
  await control.scrollIntoViewIfNeeded({ timeout: POINTER_ACTION_TIMEOUT_MS })
  return await control.evaluate((element: DomElement): HitTargetProbe => {
    const halves: number = 2
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
      pointerEvents: style.getPropertyValue('pointer-events'),
      visibility: style.getPropertyValue('visibility'),
      isInert: element.closest('[inert]') !== null,
    }
  })
}

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
  await control.hover({ timeout: POINTER_ACTION_TIMEOUT_MS })
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
            element.closest('[inert]') === null &&
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
  /** The longer side of the focused element's visible box, in CSS pixels. */
  readonly extent: number
}

// Where the focused element is, and whether fixed or sticky content covers it at five points.
const focusStateInPage = (ring: number): Omit<FocusState, 'facts'> => {
  const active: DomElement | null = document.activeElement
  if (active === null || active === document.body) {
    return { samples: [], clip: undefined, extent: 0 }
  }
  const box: DomRect = active.getBoundingClientRect()
  const width: number = document.documentElement.clientWidth
  const height: number = document.documentElement.clientHeight
  const left: number = Math.max(0, box.left)
  const top: number = Math.max(0, box.top)
  const right: number = Math.min(width, box.right)
  const bottom: number = Math.min(height, box.bottom)
  if (right - left < 1 || bottom - top < 1) {
    return { samples: [], clip: undefined, extent: 0 }
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
    extent: Math.max(right - left, bottom - top),
    clip: {
      x: Math.floor(clipLeft),
      y: Math.floor(clipTop),
      width: Math.ceil(Math.min(width, box.right + ring) - clipLeft),
      height: Math.ceil(Math.min(height, box.bottom + ring) - clipTop),
    },
  }
}

declare const scrollX: number
declare const scrollY: number

// The elements whose extent a focus position is compared within, and those whose order is their own.
const LANDMARKS: string = [
  'header',
  'nav',
  'main',
  'aside',
  'footer',
  'search',
  '[role="banner"]',
  '[role="navigation"]',
  '[role="main"]',
  '[role="complementary"]',
  '[role="contentinfo"]',
  '[role="region"]',
  '[role="search"]',
  'section[aria-label]',
  'section[aria-labelledby]',
  'form[aria-label]',
  'form[aria-labelledby]',
].join(', ')
const DIALOGS: string = 'dialog, [role="dialog"], [role="alertdialog"]'

// Where the focused element sits in the document, and the landmark it sits in, named by its path of
// child indices so two stops in one landmark name it alike.
const focusPositionInPage = ([landmarks, dialogs]: readonly [string, string]): FocusPosition | undefined => {
  const active: DomElement | null = document.activeElement
  if (active === null || active === document.body) {
    return undefined
  }
  const box: DomRect = active.getBoundingClientRect()
  const isPinned = (element: DomElement | null): boolean =>
    element !== null &&
    (['fixed', 'sticky'].includes(getComputedStyle(element).position) || isPinned(element.parentElement))
  const pathOf = (element: DomElement | null): string => {
    const parent: DomElement | null = element?.parentElement ?? null
    if (element === null || parent === null) {
      return ''
    }
    const index: number = Array.from(parent.querySelectorAll(':scope > *')).indexOf(element)
    return `${pathOf(parent)}/${String(index)}`
  }
  return {
    top: box.top + scrollY,
    bottom: box.bottom + scrollY,
    left: box.left + scrollX,
    right: box.right + scrollX,
    landmark: pathOf(active.closest(landmarks)),
    isUnplaced: active.closest(dialogs) !== null || isPinned(active) || box.width <= 1 || box.height <= 1,
    isRightToLeft: getComputedStyle(active).getPropertyValue('direction') === 'rtl',
  }
}

// How a focused element's indicator showed, as the focus rules report it.
const indicatorVisit = (place: FindingPlace, facts: TargetFacts, verdict: FocusVerdict): Visit => {
  if (verdict === 'unchanged') {
    return carried(
      findingAt(place, 'focus-visible', `${facts.label} shows no visible change when focused by keyboard`),
      facts,
    )
  }
  return verdict === 'faint'
    ? carried(
        findingAt(
          place,
          'focus-contrast',
          `${facts.label} changes when focused by keyboard, but too little of the change contrasts ` +
            `${String(FOCUS_CONTRAST_RATIO)}:1 with its unfocused rendering`,
        ),
        facts,
      )
    : EMPTY_VISIT
}

const markFocusedInPage = (name: string): void => {
  document.activeElement?.setAttribute(name, '')
}

const unmarkInPage = ([selector, name]: readonly [string, string]): void => {
  document.querySelector(selector)?.removeAttribute(name)
}

/** Where the previous stop of a tab walk sat, and what it was. */
interface PreviousStop {
  readonly position: FocusPosition
  readonly label: string
}

interface FocusStop {
  readonly visit: Visit
  /** The order finding, kept apart because a stop the walk has already visited is the walk wrapping. */
  readonly order: Visit
  readonly key: string | undefined
  readonly previous: PreviousStop | undefined
}

const focusOrder = (
  place: FindingPlace,
  facts: TargetFacts,
  previous: PreviousStop | undefined,
  position: FocusPosition | undefined,
): Visit =>
  previous === undefined || position === undefined || !isFocusBackwards(previous.position, position)
    ? EMPTY_VISIT
    : carried(
        findingAt(
          place,
          'focus-order',
          `${facts.label} takes focus after ${previous.label}, but sits entirely above it in the same landmark`,
        ),
        facts,
      )

const focusStop = async (page: Page, place: FindingPlace, previous: PreviousStop | undefined): Promise<FocusStop> => {
  const facts: TargetFacts | undefined = await targetFacts(page, null)
  if (facts === undefined) {
    return { visit: EMPTY_VISIT, order: EMPTY_VISIT, key: undefined, previous: undefined }
  }
  if (!(await isPerceivableWithin(page.locator(':focus')))) {
    return {
      visit: carried(findingAt(place, 'focus-visible', `${facts.label} holds focus but is not perceivable`), facts),
      order: EMPTY_VISIT,
      key: facts.key,
      previous,
    }
  }
  const state: Omit<FocusState, 'facts'> = await page.evaluate(focusStateInPage, FOCUS_RING_WIDTH)
  const focusPlace: FindingPlace = {
    ...place,
    state: place.state === 'normal motion' ? 'focus, normal motion' : 'focus',
  }
  const position: FocusPosition | undefined = await page.evaluate(focusPositionInPage, [LANDMARKS, DIALOGS] as const)
  const order: Visit = focusOrder(focusPlace, facts, previous, position)
  const here: PreviousStop | undefined = position === undefined ? undefined : { position, label: facts.label }
  const covering: string | undefined = obscuringContent(state.samples)
  const obscured: Visit =
    covering === undefined
      ? EMPTY_VISIT
      : carried(
          findingAt(focusPlace, 'focus-obscured', `${facts.label} is focused and entirely hidden by ${covering}`),
          facts,
        )
  // Pixel comparisons disable animations while capturing their two frames. The normal-motion pass
  // judges reach and focus behavior without changing the animation it is exercising.
  if (place.state === 'normal motion') {
    return { visit: obscured, order, key: facts.key, previous: here }
  }
  await page.evaluate(markFocusedInPage, PROBE_ATTRIBUTE)
  const contrast: readonly BrowserFinding[] = await axeFindings(page, focusPlace, (builder) =>
    builder.include(PROBE_SELECTOR).withRules(['color-contrast']),
  )
  await page.evaluate(unmarkInPage, [PROBE_SELECTOR, PROBE_ATTRIBUTE] as const)
  if (state.clip === undefined) {
    return { visit: merged([obscured, { ...EMPTY_VISIT, findings: contrast }]), order, key: facts.key, previous: here }
  }
  const indicator: Visit = indicatorVisit(focusPlace, facts, await judgeFocusIndicator(page, state.extent))
  return {
    visit: merged([obscured, indicator, { ...EMPTY_VISIT, findings: contrast }]),
    order,
    key: facts.key,
    previous: here,
  }
}

// Tab through the page once from its start: each stop is judged, and the walk ends when focus leaves
// the document or comes back to an element already visited.
const tabThrough = async (
  page: Page,
  place: FindingPlace,
  remaining: number,
  walked: { readonly seen: ReadonlySet<string>; readonly previous: PreviousStop | undefined },
): Promise<readonly Visit[]> => {
  if (remaining <= 0) {
    return []
  }
  await page.keyboard.press('Tab')
  const stop: FocusStop = await focusStop(page, place, walked.previous)
  if (stop.key === undefined || walked.seen.has(stop.key)) {
    return [stop.visit]
  }
  return [
    stop.visit,
    stop.order,
    ...(await tabThrough(page, place, remaining - 1, {
      seen: new Set<string>([...walked.seen, stop.key]),
      previous: stop.previous,
    })),
  ]
}

// The tab walk may take this many stops beyond the controls discovery counted.
const EXTRA_TAB_STOPS: number = 2

const interactionVisit = async (page: Page, item: InteractionPlace, isFirst: boolean): Promise<Visit> => {
  const place: FindingPlace = placeAt(
    page,
    item.location,
    item.viewport,
    item.motion === 'reduce' ? 'resting' : 'normal motion',
  )
  const loaded: readonly BrowserFinding[] = await loadLocation(page, item.location, item.viewport, {
    ...place,
    motion: item.motion,
  })
  const unsettled: readonly BrowserFinding[] = await settleFindings(page, place, item.motion === 'reduce')
  const controls: readonly Locator[] = item.motion === 'reduce' ? await controlsToDrive(page, isFirst) : []
  // Pointer geometry is judged still. A normal-motion scroll transition may intentionally cover an earlier panel;
  // the independent keyboard walk must reveal focused controls even through those transitions.
  const hovered: readonly Visit[] =
    item.viewport.width === DESKTOP.width && item.motion === 'reduce'
      ? await controls.reduce(
          async (earlier: Promise<readonly Visit[]>, control: Locator): Promise<readonly Visit[]> => [
            ...(await earlier),
            await hoverControl(page, control, place),
          ],
          Promise.resolve<readonly Visit[]>([]),
        )
      : []
  // Loaded afresh for the keyboard, as for the pointer: a story renders only after its preview has started,
  // and a walk that began before it would find nothing to focus and end at its first stop.
  const reloaded: readonly BrowserFinding[] = await loadLocation(page, item.location, item.viewport, {
    ...place,
    motion: item.motion,
  })
  await settleForScan(page, item.motion === 'reduce')
  const focused: readonly Visit[] = await tabThrough(page, place, item.location.controls + EXTRA_TAB_STOPS, {
    seen: new Set<string>(),
    previous: undefined,
  })
  return merged([
    { ...EMPTY_VISIT, findings: [...loaded, ...unsettled, ...reloaded] },
    ...hovered,
    ...focused,
    await healthOf(page, place),
  ])
}

const INTERACTION_RULES: readonly string[] = [
  'obscured',
  'focus-obscured',
  'focus-visible',
  'focus-contrast',
  'focus-order',
]

/**
 * Drive every control of one shard of the locations into hover and keyboard focus, and judge contrast,
 * reach and focus visibility.
 * @param page the test's page.
 * @param shard the part of the pass this test visits.
 */
export const expectInteractionStates = async (page: Page, shard: Shard): Promise<void> => {
  test.info().skip(!isChromium(page), 'the interaction pass runs in Chromium')
  const discovery: Discovery = readDiscovery(test.info())
  const { places, chromePlaces }: InteractionPlan = interactionPlan(discovery.locations)
  const budget: Budget = armBudget(page, 'interaction', shard, passUnits(places, placeUnits))
  await preparePage(page)
  const { visits, taken }: ShardVisits<InteractionPlace> = await visitAll(places, {
    budget,
    labelOf: itemLabel,
    unitsOf: placeUnits,
    visit: async (item: InteractionPlace, index: number): Promise<Visit> =>
      await interactionVisit(page, item, chromePlaces.has(index)),
  })
  finishPass(page, {
    budget,
    pass: 'interaction',
    visits,
    judgedRules: INTERACTION_RULES,
    locations: shardLocations(taken, locationOfItem),
  })
}
