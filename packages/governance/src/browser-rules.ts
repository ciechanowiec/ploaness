// The rules that judge rendered text, media, fonts, focus and disclosures, over values measured in the
// browser. Each threshold is a fixed constant: a false positive is a defect of the rule and is repaired
// here, never by a project setting.
import type { CandidateFinding } from './browser-exemptions.js'
import {
  type FontFaceFacts,
  hasArea,
  isInAriaHidden,
  isInClip,
  type LayoutNode,
  type LayoutRect,
  type LayoutSnapshot,
  type MediaFacts,
} from './layout-snapshot.js'

/** The tolerance every geometric comparison allows, in CSS pixels. */
export const GEOMETRY_TOLERANCE: number = 1

/** The smallest rendered text size, in CSS pixels. */
export const MINIMUM_TEXT_SIZE: number = 12

/** How far an image may be enlarged beyond its natural resolution before it is judged upscaled. */
export const UPSCALE_ALLOWANCE: number = 0.1

const PERCENT: number = 100

/** The device pixel ratio every viewport is rendered at. */
export const DEVICE_SCALE_FACTOR: number = 1

/** The width of the ring around a focused element whose pixels the focus-visible rule compares. */
export const FOCUS_RING_WIDTH: number = 4

/** The element rules of the resting scan beyond geometry: T4 and M1 to M4. */
export const RESTING_ELEMENT_RULES: readonly string[] = [
  'small-text',
  'image-load',
  'image-distorted',
  'image-upscaled',
  'media-space',
]

/** The page rule of the resting scan: T6. */
export const FONT_LOAD_RULE: string = 'font-load'

const isRendered = (snapshot: LayoutSnapshot, node: LayoutNode): boolean =>
  node.visibility === 'visible' &&
  node.rects.some((rect: LayoutRect): boolean => hasArea(rect)) &&
  !isInClip(snapshot, node) &&
  !isInAriaHidden(snapshot, node)

/**
 * Text rendered smaller than 12 CSS pixels (rule `small-text`).
 * @param snapshot the measured page.
 * @returns one candidate per element whose own text is too small.
 */
export const findSmallText = (snapshot: LayoutSnapshot): readonly CandidateFinding[] =>
  snapshot.nodes
    .filter(
      (node: LayoutNode): boolean =>
        node.textRects.some((rect: LayoutRect): boolean => hasArea(rect)) &&
        node.fontSize > 0 &&
        node.fontSize < MINIMUM_TEXT_SIZE &&
        isRendered(snapshot, node),
    )
    .map(
      (node: LayoutNode): CandidateFinding => ({
        rule: 'small-text',
        subjects: [node],
        message: `text rendered at ${String(node.fontSize)}px, below ${String(MINIMUM_TEXT_SIZE)}px: ${node.label}`,
      }),
    )

interface MediaNode {
  readonly node: LayoutNode
  readonly media: MediaFacts
}

const renderedMedia = (snapshot: LayoutSnapshot): readonly MediaNode[] =>
  snapshot.nodes.flatMap((node: LayoutNode): readonly MediaNode[] =>
    node.media !== undefined && isRendered(snapshot, node) ? [{ node, media: node.media }] : [],
  )

const isImage = (node: LayoutNode): boolean => node.tag === 'img'

/**
 * Visible images that did not load (rule `image-load`).
 * @param snapshot the measured page.
 * @returns one candidate per incomplete or empty image.
 */
export const findUnloadedImages = (snapshot: LayoutSnapshot): readonly CandidateFinding[] =>
  renderedMedia(snapshot)
    .filter(
      ({ node, media }: MediaNode): boolean =>
        isImage(node) && (!media.isComplete || (!media.isVector && media.naturalWidth === 0)),
    )
    .map(
      ({ node, media }: MediaNode): CandidateFinding => ({
        rule: 'image-load',
        subjects: [node],
        message: `image did not load (complete ${String(media.isComplete)}, natural width ${String(media.naturalWidth)}): ${node.label}`,
      }),
    )

const hasRaster = (media: MediaFacts): boolean =>
  !media.isVector && media.naturalWidth > 0 && media.naturalHeight > 0 && media.contentWidth > 0

/**
 * Images stretched out of their natural aspect ratio (rule `image-distorted`).
 * @param snapshot the measured page.
 * @returns one candidate per image whose `object-fit: fill` rendering changes its proportions.
 */
export const findDistortedImages = (snapshot: LayoutSnapshot): readonly CandidateFinding[] =>
  renderedMedia(snapshot).flatMap(({ node, media }: MediaNode): readonly CandidateFinding[] => {
    if (!(isImage(node) && hasRaster(media)) || media.objectFit !== 'fill') {
      return []
    }
    const expectedHeight: number = (media.contentWidth * media.naturalHeight) / media.naturalWidth
    return Math.abs(expectedHeight - media.contentHeight) > GEOMETRY_TOLERANCE
      ? [
          {
            rule: 'image-distorted',
            subjects: [node],
            message:
              `image rendered at ${String(media.contentWidth)}x${String(media.contentHeight)}px from a ` +
              `${String(media.naturalWidth)}x${String(media.naturalHeight)}px source, out of proportion: ${node.label}`,
          },
        ]
      : []
  })

const displayedScale = (media: MediaFacts): number => {
  const horizontal: number = media.contentWidth / media.naturalWidth
  const vertical: number = media.contentHeight / media.naturalHeight
  switch (media.objectFit) {
    case 'cover': {
      return Math.max(horizontal, vertical)
    }
    case 'contain': {
      return Math.min(horizontal, vertical)
    }
    case 'none': {
      return 1
    }
    case 'scale-down': {
      return Math.min(1, horizontal, vertical)
    }
    default: {
      return Math.max(horizontal, vertical)
    }
  }
}

/**
 * Images displayed larger than their source resolution allows (rule `image-upscaled`).
 * @param snapshot the measured page.
 * @returns one candidate per raster image enlarged by more than 10%.
 */
export const findUpscaledImages = (snapshot: LayoutSnapshot): readonly CandidateFinding[] =>
  renderedMedia(snapshot).flatMap(({ node, media }: MediaNode): readonly CandidateFinding[] => {
    if (!(isImage(node) && hasRaster(media))) {
      return []
    }
    const scale: number = displayedScale(media) * DEVICE_SCALE_FACTOR
    return scale > 1 + UPSCALE_ALLOWANCE
      ? [
          {
            rule: 'image-upscaled',
            subjects: [node],
            message:
              `image source ${String(media.naturalWidth)}x${String(media.naturalHeight)}px displayed at ` +
              `${String(Math.round(scale * PERCENT))}% in a ${String(media.contentWidth)}x${String(media.contentHeight)}px ` +
              `box; serve a larger source: ${node.label}`,
          },
        ]
      : []
  })

const OUT_OF_FLOW: ReadonlySet<string> = new Set<string>(['absolute', 'fixed'])

/**
 * Media whose box changes once its source loads, shifting what follows it (rule `media-space`).
 * @param snapshot the measured page.
 * @returns one candidate per in-flow element that does not reserve its rendered size.
 */
export const findUnreservedMedia = (snapshot: LayoutSnapshot): readonly CandidateFinding[] =>
  renderedMedia(snapshot).flatMap(({ node, media }: MediaNode): readonly CandidateFinding[] => {
    if (OUT_OF_FLOW.has(node.position)) {
      return []
    }
    const rendered: LayoutRect | undefined = node.rects[0]
    if (rendered === undefined) {
      return []
    }
    const width: number = rendered.right - rendered.left
    const height: number = rendered.bottom - rendered.top
    return Math.abs(media.reservedWidth - width) > GEOMETRY_TOLERANCE ||
      Math.abs(media.reservedHeight - height) > GEOMETRY_TOLERANCE
      ? [
          {
            rule: 'media-space',
            subjects: [node],
            message:
              `${node.tag} reserves ${String(media.reservedWidth)}x${String(media.reservedHeight)}px before loading ` +
              `and takes ${String(width)}x${String(height)}px after; give it width and height attributes or an ` +
              `aspect-ratio: ${node.label}`,
          },
        ]
      : []
  })

const GENERIC_FAMILIES: ReadonlySet<string> = new Set<string>([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'ui-rounded',
  'math',
  'emoji',
  'fangsong',
])

const familyName = (family: string): string =>
  family
    .trim()
    .replaceAll(/^["']|["']$/gu, '')
    .toLowerCase()

const familiesOf = (stack: string): readonly string[] =>
  stack
    .split(',')
    .map((family: string): string => familyName(family))
    .filter((family: string): boolean => family.length > 0 && !GENERIC_FAMILIES.has(family))

/**
 * The declared font families the page's text asks for first.
 * @param snapshot the measured page.
 * @returns for each text element, the first family in its stack that has a `@font-face`.
 */
export const usedFontFamilies = (snapshot: LayoutSnapshot): readonly string[] => {
  const declared: ReadonlySet<string> = new Set<string>(
    snapshot.fontFaces.map((face: FontFaceFacts): string => familyName(face.family)),
  )
  return [
    ...new Set<string>(
      snapshot.nodes
        .filter((node: LayoutNode): boolean => node.textRects.length > 0)
        .flatMap((node: LayoutNode): readonly string[] => {
          const first: string | undefined = familiesOf(node.fontFamily).find((family: string): boolean =>
            declared.has(family),
          )
          return first === undefined ? [] : [first]
        }),
    ),
  ]
}

/**
 * The `@font-face` families the page's text uses that did not load (rule `font-load`).
 *
 * A face the browser never needed stays `unloaded`, which is not a defect. A used family with no face
 * loaded, or with a face that failed or is still loading after the page settled, is one. This proves the
 * face loaded, not that every glyph avoided a fallback.
 * @param snapshot the measured page.
 * @returns one message per family.
 */
export const findUnloadedFonts = (snapshot: LayoutSnapshot): readonly string[] =>
  usedFontFamilies(snapshot).flatMap((family: string): readonly string[] => {
    const faces: readonly FontFaceFacts[] = snapshot.fontFaces.filter(
      (face: FontFaceFacts): boolean => familyName(face.family) === family,
    )
    const failed: readonly FontFaceFacts[] = faces.filter(
      (face: FontFaceFacts): boolean => face.status === 'error' || face.status === 'loading',
    )
    if (failed.length > 0) {
      return failed.map(
        (face: FontFaceFacts): string =>
          `@font-face "${face.family}" ${face.weight} ${face.style} is ${face.status} after the page settled`,
      )
    }
    return faces.some((face: FontFaceFacts): boolean => face.status === 'loaded')
      ? []
      : [`@font-face "${family}" is used by the page's text and none of its faces loaded`]
  })

/** One point of a focused element, and whether fixed or sticky content covers it. */
export interface FocusSample {
  readonly isCovered: boolean
  /** The label of what covers it, empty when nothing does. */
  readonly coveredBy: string
}

/**
 * Whether a focused element is entirely hidden by fixed or sticky content (rule `focus-obscured`).
 * @param samples points spread over the part of the element inside the viewport.
 * @returns the label of the covering content, or undefined when any part of the element shows.
 */
export const obscuringContent = (samples: readonly FocusSample[]): string | undefined =>
  samples.length > 0 && samples.every((sample: FocusSample): boolean => sample.isCovered)
    ? [...new Set<string>(samples.map((sample: FocusSample): string => sample.coveredBy))].join(', ')
    : undefined

/**
 * Whether two renderings of the same region differ, which is what a visible focus indicator does.
 * @param unfocused the region's pixels with the element blurred.
 * @param focused the same region with the element focused by keyboard.
 * @returns true when at least one byte differs.
 */
export const hasVisibleFocus = (unfocused: Uint8Array, focused: Uint8Array): boolean =>
  unfocused.length !== focused.length ||
  unfocused.some((byte: number, index: number): boolean => byte !== focused[index])

/** What driving one opened disclosure with the keyboard showed. */
export interface DisclosureProbe {
  /** Whether the control declares a popup, which the keyboard pattern says `Escape` dismisses. */
  readonly isPopup: boolean
  /** Whether `Escape` closed it. */
  readonly closedOnEscape: boolean
  /** Whether focus was on the control after it closed. */
  readonly focusReturned: boolean
  /** Whether it opened a modal dialog. */
  readonly isModal: boolean
  /** Whether focus stayed inside that dialog while tabbing. */
  readonly focusTrapped: boolean
}

const escapeDefects = (probe: DisclosureProbe): readonly string[] => {
  if (!(probe.isPopup || probe.isModal)) {
    return []
  }
  if (!probe.closedOnEscape) {
    return ['Escape does not close it']
  }
  return probe.focusReturned ? [] : ['focus does not return to its control after Escape']
}

/**
 * What is wrong with how a disclosure answers the keyboard (rule `disclosure-keyboard`).
 *
 * Only a popup or a modal dialog is required to close on `Escape`: the disclosure pattern for an
 * accordion or a native `<details>` has no such key, and judging one by it would report the platform.
 * @param probe what the keyboard showed.
 * @returns one message per defect.
 */
export const disclosureDefects = (probe: DisclosureProbe): readonly string[] => [
  ...escapeDefects(probe),
  ...(probe.isModal && !probe.focusTrapped ? ['focus leaves the open modal dialog while tabbing'] : []),
]

const isSameRect = (left: LayoutRect, right: LayoutRect): boolean =>
  Math.abs(left.left - right.left) <= GEOMETRY_TOLERANCE &&
  Math.abs(left.top - right.top) <= GEOMETRY_TOLERANCE &&
  Math.abs(left.right - right.right) <= GEOMETRY_TOLERANCE &&
  Math.abs(left.bottom - right.bottom) <= GEOMETRY_TOLERANCE

const isSameNode = (left: LayoutNode, right: LayoutNode): boolean =>
  left.label === right.label &&
  left.rects.length === right.rects.length &&
  left.rects.every((rect: LayoutRect, index: number): boolean => {
    const other: LayoutRect | undefined = right.rects[index]
    return other !== undefined && isSameRect(rect, other)
  })

/**
 * Where two measurements of a settled page disagree (rule `page-not-stable`).
 * @param first the first measurement.
 * @param second the second, taken after it.
 * @returns what moved, or undefined when the geometry held within the tolerance.
 */
export const instability = (first: LayoutSnapshot, second: LayoutSnapshot): string | undefined => {
  if (first.nodes.length !== second.nodes.length) {
    return `the element count changed from ${String(first.nodes.length)} to ${String(second.nodes.length)}`
  }
  const moved: LayoutNode | undefined = first.nodes.find((node: LayoutNode, index: number): boolean => {
    const other: LayoutNode | undefined = second.nodes[index]
    return other === undefined || !isSameNode(node, other)
  })
  return moved === undefined ? undefined : `${moved.label} moved between two measurements`
}

/**
 * Every element candidate the resting scan's text and media rules find on one page.
 * @param snapshot the measured page.
 * @returns the candidates of T4 and M1 to M4.
 */
export const restingCandidates = (snapshot: LayoutSnapshot): readonly CandidateFinding[] => [
  ...findSmallText(snapshot),
  ...findUnloadedImages(snapshot),
  ...findDistortedImages(snapshot),
  ...findUpscaledImages(snapshot),
  ...findUnreservedMedia(snapshot),
]
