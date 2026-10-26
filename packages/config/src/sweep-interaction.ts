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
  hasContrastingFocus,
  hasVisibleFocus,
  isFocusBackwards,
  judgeCarried,
  obscuringContent,
} from '@ploaness/governance'
import { type TargetFacts, targetFacts } from './layout.js'
import { axeFindings, settleFindings } from './scanner.js'
import { settleForScan } from './settle.js'
import { type InteractionPlan, interactionPlan, placeUnits } from './sweep-interaction-plan.js'
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
  passUnits,
  placeAt,
  preparePage,
  readDiscovery,
  type Shard,
  type ShardVisits,
  STILL_STYLE,
  shardLocations,
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
      pointerEvents: style.getPropertyValue('pointer-events'),
      visibility: style.getPropertyValue('visibility'),
      isInert: element.closest('[inert]') !== null,
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

interface DecodedImage {
  readonly width: number
  readonly pixels: readonly number[]
}

interface ImageBitmapLike {
  readonly width: number
  readonly height: number
}

interface CanvasContextLike {
  drawImage: (image: ImageBitmapLike, x: number, y: number) => void
  getImageData: (x: number, y: number, width: number, height: number) => { readonly data: ArrayLike<number> }
}

interface CanvasLike {
  getContext: (kind: '2d') => CanvasContextLike | null
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

declare const createImageBitmap: (image: Blob) => Promise<ImageBitmapLike>
declare const OffscreenCanvas: new (width: number, height: number) => CanvasLike

// The browser decodes the screenshots it took: PNG is its own format, and Node has no decoder for it.
const decodeInPage = async (images: readonly string[]): Promise<readonly DecodedImage[]> =>
  await Promise.all(
    images.map(async (image: string): Promise<DecodedImage> => {
      const bytes: Uint8Array<ArrayBuffer> = Uint8Array.from(
        atob(image),
        (character: string): number => character.codePointAt(0) ?? 0,
      )
      const bitmap: ImageBitmapLike = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
      const context: CanvasContextLike | null = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d')
      if (context === null) {
        return { width: 0, pixels: [] }
      }
      context.drawImage(bitmap, 0, 0)
      return { width: bitmap.width, pixels: Array.from(context.getImageData(0, 0, bitmap.width, bitmap.height).data) }
    }),
  )

const BASE64: BufferEncoding = 'base64'

// Judged only where a focus indicator shows at all; one that does not is the `focus-visible` finding.
const hasFocusContrast = async (
  page: Page,
  shots: { readonly focused: Uint8Array; readonly unfocused: Uint8Array },
  measure: { readonly clip: ScreenClip; readonly extent: number },
): Promise<boolean> => {
  const [focused, unfocused]: readonly DecodedImage[] = await page.evaluate(decodeInPage, [
    Buffer.from(shots.focused).toString(BASE64),
    Buffer.from(shots.unfocused).toString(BASE64),
  ])
  if (focused === undefined || unfocused === undefined || focused.width === 0) {
    throw new Error('the browser could not decode the focus screenshots')
  }
  return hasContrastingFocus({
    focused: focused.pixels,
    unfocused: unfocused.pixels,
    scale: focused.width / measure.clip.width,
    extent: measure.extent,
  })
}

interface FocusShots {
  readonly shots: { readonly focused: Uint8Array; readonly unfocused: Uint8Array }
  readonly measure: { readonly clip: ScreenClip; readonly extent: number }
}

const focusIndicator = async (
  page: Page,
  place: FindingPlace,
  facts: TargetFacts,
  { shots, measure }: FocusShots,
): Promise<Visit> => {
  if (!hasVisibleFocus(shots.unfocused, shots.focused)) {
    return carried(
      findingAt(place, 'focus-visible', `${facts.label} shows no visible change when focused by keyboard`),
      facts,
    )
  }
  if (await hasFocusContrast(page, shots, measure)) {
    return EMPTY_VISIT
  }
  return carried(
    findingAt(
      place,
      'focus-contrast',
      `${facts.label} changes when focused by keyboard, but too little of the change contrasts ` +
        `${String(FOCUS_CONTRAST_RATIO)}:1 with its unfocused rendering`,
    ),
    facts,
  )
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
  const state: Omit<FocusState, 'facts'> = await page.evaluate(focusStateInPage, FOCUS_RING_WIDTH)
  const focusPlace: FindingPlace = { ...place, state: 'focus' }
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
  await page.evaluate(markFocusedInPage, PROBE_ATTRIBUTE)
  const contrast: readonly BrowserFinding[] = await axeFindings(page, focusPlace, (builder) =>
    builder.include(PROBE_SELECTOR).withRules(['color-contrast']),
  )
  await page.evaluate(unmarkInPage, [PROBE_SELECTOR, PROBE_ATTRIBUTE] as const)
  const clip: ScreenClip | undefined = state.clip
  if (clip === undefined) {
    return { visit: merged([obscured, { ...EMPTY_VISIT, findings: contrast }]), order, key: facts.key, previous: here }
  }
  const focused: Uint8Array = await page.screenshot({ clip, animations: 'disabled', caret: 'hide' })
  await page.evaluate(blurInPage)
  const unfocused: Uint8Array = await page.screenshot({ clip, animations: 'disabled', caret: 'hide' })
  const indicator: Visit = await focusIndicator(page, focusPlace, facts, {
    shots: { focused, unfocused },
    measure: { clip, extent: state.extent },
  })
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
  const focused: readonly Visit[] = await tabThrough(page, place, item.location.controls + EXTRA_TAB_STOPS, {
    seen: new Set<string>(),
    previous: undefined,
  })
  return merged([
    { ...EMPTY_VISIT, findings: [...loaded, ...unsettled] },
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
  const { visits, taken }: ShardVisits<PlaceItem> = await visitAll(places, {
    budget,
    labelOf: itemLabel,
    unitsOf: placeUnits,
    visit: async (item: PlaceItem, index: number): Promise<Visit> =>
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
