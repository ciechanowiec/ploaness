// The widths the sweep measures at: a fixed baseline of real devices, both sides of every breakpoint the
// page's own stylesheets declare, and a sampled sweep across the whole range between them.
//
// A breakpoint is where a layout changes, so it is where a layout most often breaks: one pixel below a
// `min-width` the old layout still has to fit, and at it the new one has to. The baseline cannot know
// where a project put its breakpoints, so the page is asked.
import type { FindingViewport } from './browser-findings.js'

/**
 * The viewports every page is loaded at, each a fresh load: a phone, a tablet and a desktop. The width
 * sweep measures overflow at every width between them, and each page adds its own breakpoint edges. A
 * project may add more, never remove any.
 */
export const BASELINE_VIEWPORTS: readonly FindingViewport[] = [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1280, height: 800 },
]

/** The phone and desktop viewports the text-stress passes and the axe scans run at. */
export const STRESS_VIEWPORTS: readonly FindingViewport[] = [
  { width: 390, height: 844 },
  { width: 1280, height: 800 },
]

/** The narrowest width the sweep measures: the WCAG 1.4.10 reflow bound. */
export const SWEEP_MIN_WIDTH: number = 320

/** The widest width the sweep measures. */
export const SWEEP_MAX_WIDTH: number = 1920

/** The step of the width sweep, in CSS pixels. */
export const SWEEP_STEP: number = 16

/** The height the width sweep holds while it resizes. */
export const SWEEP_HEIGHT: number = 900

const REM_PIXELS: number = 16

const NUMBER: string = String.raw`(\d+(?:\.\d+)?)(px|rem|em)`

/** Which side of a width a condition matches. */
type Comparison = '>=' | '>' | '<=' | '<'

interface WidthCondition {
  readonly comparison: Comparison
  readonly pixels: number
}

const pixelsOf = (value: string, unit: string): number => Number(value) * (unit === 'px' ? 1 : REM_PIXELS)

const MIRRORED: Readonly<Record<Comparison, Comparison>> = { '>=': '<=', '>': '<', '<=': '>=', '<': '>' }

const COMPARISONS: ReadonlySet<string> = new Set<string>(Object.keys(MIRRORED))

const isComparison = (text: string): text is Comparison => COMPARISONS.has(text)

const legacyConditions = (media: string): readonly WidthCondition[] =>
  [...media.matchAll(new RegExp(String.raw`\(\s*(min|max)-width\s*:\s*${NUMBER}\s*\)`, 'giu'))].map(
    (match: RegExpExecArray): WidthCondition => ({
      comparison: String(match[1]).toLowerCase() === 'min' ? '>=' : '<=',
      pixels: pixelsOf(String(match[2]), String(match[3]).toLowerCase()),
    }),
  )

const rangeConditions = (media: string): readonly WidthCondition[] => {
  const after: readonly WidthCondition[] = [
    ...media.matchAll(new RegExp(String.raw`(?<![\w-])width\s*(>=|<=|>|<)\s*${NUMBER}`, 'giu')),
  ].flatMap((match: RegExpExecArray): readonly WidthCondition[] => {
    const comparison: string = String(match[1])
    return isComparison(comparison)
      ? [{ comparison, pixels: pixelsOf(String(match[2]), String(match[3]).toLowerCase()) }]
      : []
  })
  const before: readonly WidthCondition[] = [
    ...media.matchAll(new RegExp(String.raw`${NUMBER}\s*(>=|<=|>|<)\s*width(?![\w-])`, 'giu')),
  ].flatMap((match: RegExpExecArray): readonly WidthCondition[] => {
    const comparison: string = String(match[3])
    return isComparison(comparison)
      ? [{ comparison: MIRRORED[comparison], pixels: pixelsOf(String(match[1]), String(match[2]).toLowerCase()) }]
      : []
  })
  return [...after, ...before]
}

// The last width on one side of the edge and the first on the other, both whole pixels.
const edgeWidths = (condition: WidthCondition): readonly number[] => {
  const { comparison, pixels }: WidthCondition = condition
  if (comparison === '>=' || comparison === '<') {
    return [Math.ceil(pixels) - 1, Math.ceil(pixels)]
  }
  return [Math.floor(pixels), Math.floor(pixels) + 1]
}

/**
 * The widths on both sides of every width condition in a set of media queries.
 *
 * `min-width: N` adds N - 1 and N, `max-width: N` adds N and N + 1, and the range syntax is read the
 * same way. Only `px`, `rem` and `em` are understood, at 16 px to the rem. Widths outside the sweep's
 * range are left out.
 * @param mediaTexts the `media.mediaText` of every `@media` rule on the page.
 * @returns each edge width once, ascending.
 */
export const breakpointEdges = (mediaTexts: readonly string[]): readonly number[] =>
  [
    ...new Set<number>(
      mediaTexts
        .flatMap((media: string): readonly WidthCondition[] => [...legacyConditions(media), ...rangeConditions(media)])
        .flatMap((condition: WidthCondition): readonly number[] => edgeWidths(condition)),
    ),
  ]
    .filter((width: number): boolean => width >= SWEEP_MIN_WIDTH && width <= SWEEP_MAX_WIDTH)
    .toSorted((left: number, right: number): number => left - right)

const heightFor = (width: number): number =>
  BASELINE_VIEWPORTS.reduce(
    (nearest: FindingViewport, viewport: FindingViewport): FindingViewport =>
      Math.abs(viewport.width - width) < Math.abs(nearest.width - width) ? viewport : nearest,
    { width: Number.POSITIVE_INFINITY, height: SWEEP_HEIGHT },
  ).height

const isSame = (left: FindingViewport, right: FindingViewport): boolean =>
  left.width === right.width && left.height === right.height

/**
 * The viewports a page is loaded at: the baseline, its breakpoint edges, and the project's additions.
 * @param edges the page's breakpoint edges.
 * @param declared the viewports the project added.
 * @returns each viewport once, ascending by width.
 */
export const pageViewports = (
  edges: readonly number[],
  declared: readonly FindingViewport[],
): readonly FindingViewport[] => {
  const all: readonly FindingViewport[] = [
    ...BASELINE_VIEWPORTS,
    ...edges.map((width: number): FindingViewport => ({ width, height: heightFor(width) })),
    ...declared,
  ]
  return all
    .filter(
      (viewport: FindingViewport, index: number): boolean =>
        all.findIndex((other: FindingViewport): boolean => isSame(other, viewport)) === index,
    )
    .toSorted((left: FindingViewport, right: FindingViewport): number => left.width - right.width)
}

/**
 * The widths the sweep steps through.
 * @returns every 16th width from 320 to 1920, both ends included.
 */
export const sweepWidths = (): readonly number[] =>
  Array.from(
    { length: Math.floor((SWEEP_MAX_WIDTH - SWEEP_MIN_WIDTH) / SWEEP_STEP) + 1 },
    (_unused: unknown, index: number): number => SWEEP_MIN_WIDTH + index * SWEEP_STEP,
  )

const HALVES: number = 2

/**
 * The next width to measure while bisecting between a width that holds and one that fails.
 * @param holds a width at which the defect is absent.
 * @param fails a width at which it is present.
 * @returns the width halfway between, or undefined once the two are adjacent.
 */
export const bisectionWidth = (holds: number, fails: number): number | undefined =>
  Math.abs(fails - holds) <= 1 ? undefined : Math.floor((holds + fails) / HALVES)

/** A defect measured at the widths it holds at. */
export interface SweptDefect {
  /** The defect, as a message without its width. */
  readonly message: string
  /** Every width it was measured at, sampled or bisected. */
  readonly widths: readonly number[]
}

/** An unbroken run of widths a defect was present at. */
export interface WidthRange {
  readonly from: number
  readonly to: number
}

/**
 * Group the widths a defect was found at into runs, given every width that was measured.
 * @param failing the widths the defect was present at.
 * @param measured every width measured, failing or not.
 * @returns the runs, each bounded by measured widths at which the defect was present.
 */
export const failingRanges = (failing: readonly number[], measured: readonly number[]): readonly WidthRange[] => {
  const failed: ReadonlySet<number> = new Set<number>(failing)
  const ordered: readonly number[] = [...new Set<number>(measured)].toSorted(
    (left: number, right: number): number => left - right,
  )
  return ordered.reduce<readonly WidthRange[]>((ranges: readonly WidthRange[], width: number, index: number) => {
    if (!failed.has(width)) {
      return ranges
    }
    const previous: number | undefined = ordered[index - 1]
    const last: WidthRange | undefined = ranges.at(-1)
    return last !== undefined && previous !== undefined && failed.has(previous)
      ? [...ranges.slice(0, -1), { from: last.from, to: width }]
      : [...ranges, { from: width, to: width }]
  }, [])
}
