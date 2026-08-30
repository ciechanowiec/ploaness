// Whether a control can be hovered, and what it means when it cannot.
//
// The shipped accessibility sweep hovers every control in the site chrome to measure hover contrast.
// A skip link hidden with `clip-path: inset(50%)` - the standard accessible pattern - has no hit
// target, because a clip removes an element from hit testing as well as from painting. Playwright
// therefore retried the hover until the whole test timed out, and reported `<header> intercepts
// pointer events`: a message that blames the ancestor the browser found instead, and sends the reader
// to weaken a skip link that was correct.
//
// The repair cannot be "catch the failure and move on". A VISIBLE control that intercepts pointer
// events is a real page defect, and swallowing both cases would trade a misleading failure for no
// failure at all. So this decides between them, and the two answers differ:
//
//   - visually hidden: skip the hover pass and say why. Nothing is lost, because hover contrast is a
//     measurement of painted pixels and this element paints none. The focus pass still runs, which is
//     the state that actually matters for a skip link.
//   - obscured: something is on top of a control that does paint. That is the defect the sweep is for,
//     and it should be reported as such rather than as a timeout.
//
// The classification is deliberately conservative: anything it cannot place is hoverable, so an
// undecided case runs the check rather than skipping it.

/** What a browser must report about a control before this module can classify it. */
export interface HitTargetProbe {
  /** Border-box width in CSS pixels. */
  readonly width: number
  /** Border-box height in CSS pixels. */
  readonly height: number
  /** The computed `clip-path`, verbatim, or `none`. */
  readonly clipPath: string
  /** The computed `clip`, verbatim, or `auto`. */
  readonly clip: string
  /**
   * Whether `elementFromPoint` at the box centre returned this element or a descendant of it.
   *
   * This is the same question Playwright's actionability check asks, and asking it here is what lets
   * a clipped element and an obscured one be told apart rather than both reported as a timeout.
   */
  readonly ownsCentrePoint: boolean
}

/** How a control can be reached, and therefore which passes of the sweep apply to it. */
export type HitTargetVerdict = 'hoverable' | 'visually-hidden' | 'obscured'

/** The verdict together with the sentence a report prints for it. */
export interface HitTargetClassification {
  readonly verdict: HitTargetVerdict
  readonly reason: string
}

// The legacy visually-hidden pattern draws a 1px box and clips it away, so its box has area and its
// paint does not. Anything at or under this in either dimension is that pattern rather than a control.
const HIDDEN_BOX_LIMIT: number = 1

// An `inset()` is empty when its opposing insets meet or cross, which is arithmetic rather than a
// spelling: `inset(50%)` collapses both axes, and so do `inset(50% 0)` and `inset(60% 10% 60% 10%)`.
// Matching the literal `inset(50%)` would have covered the one form every visually-hidden helper class
// ships and quietly missed the rest, so the shorthand is expanded and the pairs are added instead.
const FULL_EXTENT: number = 100
const INSET_SHORTHAND: RegExp = /^inset\(([^)]*)\)$/
// `inset()` may carry a `round <radius>` clause, which describes corners rather than extent.
const ROUND_CLAUSE: RegExp = /\sround\s[\s\S]*$/

const PERCENT: string = '%'

// A percentage is the only unit that can be reasoned about without knowing the element's size, and it
// is the unit the pattern is always written in. A pixel inset is left undecided, which classifies the
// control as reachable and runs the check.
const asPercentage = (token: string): number =>
  token.endsWith(PERCENT) ? Number(token.slice(0, -PERCENT.length)) : Number.NaN

// CSS box shorthand: one value applies to all four sides, two to the vertical and horizontal pairs,
// three add a distinct bottom, four are top/right/bottom/left in order.
const expandBoxShorthand = (values: readonly number[]): readonly number[] => {
  const [first, second, third, fourth]: readonly (number | undefined)[] = values
  if (first === undefined) {
    return []
  }
  const right: number = second ?? first
  return [first, right, third ?? first, fourth ?? right]
}

const isEmptyInset = (argument: string): boolean => {
  const values: readonly number[] = expandBoxShorthand(
    argument
      .replace(ROUND_CLAUSE, '')
      .split(/[\s,]+/)
      .filter((token: string): boolean => token.length > 0)
      .map((token: string): number => asPercentage(token)),
  )
  const [top, right, bottom, left]: readonly (number | undefined)[] = values
  if (top === undefined || right === undefined || bottom === undefined || left === undefined) {
    return false
  }
  return top + bottom >= FULL_EXTENT || left + right >= FULL_EXTENT
}

// A circle or ellipse of no radius clips everything away. Only an explicit zero counts: a keyword
// radius such as `closest-side` depends on the box and is left undecided.
const ZERO_RADIUS_SHAPE: RegExp = /^(?:circle|ellipse)\(\s*0(?:px|%|em|rem)?[\s,)]/

// `clip: rect(...)` with no extent, in the spellings browsers compute it to. The 1px form is the
// classic `.sr-only` rule, which pairs a 1px box with a rect that keeps none of it.
const EMPTY_CLIP: RegExp =
  /^rect\(\s*[01](?:px)?[\s,]+[01](?:px)?[\s,]+[01](?:px)?[\s,]+[01](?:px)?\s*\)$/

const isEmptyClipPath = (clipPath: string): boolean => {
  const normalised: string = clipPath.trim().toLowerCase()
  const inset: RegExpExecArray | null = INSET_SHORTHAND.exec(normalised)
  return inset === null ? ZERO_RADIUS_SHAPE.test(normalised) : isEmptyInset(inset[1] ?? '')
}

const isEmptyClip = (clip: string): boolean => EMPTY_CLIP.test(clip.trim().toLowerCase())

const hasNoPaintedArea = (probe: HitTargetProbe): boolean =>
  probe.width <= 0 ||
  probe.height <= 0 ||
  (probe.width <= HIDDEN_BOX_LIMIT && probe.height <= HIDDEN_BOX_LIMIT) ||
  isEmptyClipPath(probe.clipPath) ||
  isEmptyClip(probe.clip)

/**
 * Decide how a control can be reached, so the sweep hovers what it can and explains what it cannot.
 *
 * A control that owns its own centre point is hoverable whatever its styling, which is what keeps a
 * decorative `clip-path` on a real button from being mistaken for a hiding technique.
 * @param probe what the browser reports about the control.
 * @returns the verdict and the sentence describing it.
 */
export const classifyHitTarget = (probe: HitTargetProbe): HitTargetClassification => {
  if (probe.ownsCentrePoint) {
    return { verdict: 'hoverable', reason: 'the control is reachable at its own centre point' }
  }
  if (hasNoPaintedArea(probe)) {
    return {
      verdict: 'visually-hidden',
      reason:
        'the control is visually hidden (a zero-area box or a clip that removes it), so it has no ' +
        'hit target and no painted pixels whose contrast could be measured under hover',
    }
  }
  return {
    verdict: 'obscured',
    reason:
      'the control paints but something else answers at its centre point, so a pointer cannot ' +
      'reach it; this is a defect in the page rather than in the sweep',
  }
}
