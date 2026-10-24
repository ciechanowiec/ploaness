// Whether an element axe reports as focusable yet hidden from assistive technology is a focus guard.
//
// A dialog or menu library places hidden spans in the tab order on purpose: one at each edge of an open
// dialog to keep Tab inside it, one beside an open menu trigger to steer Tab into the panel. Each moves
// focus on as soon as it arrives, so a keyboard user never rests where a screen reader is silent. The
// sweep focuses the element and reports where focus came to rest; only a redirect to a place a reader
// can perceive clears the element.

/** The axe rule whose findings a focus redirect can clear. */
export const FOCUS_GUARD_RULE: string = 'aria-hidden-focus'

/** Where focus rests a frame after one focusable element of the reported subtree was focused. */
export interface FocusArrival {
  /** Whether focus is still on the reported subtree. */
  readonly staysInSubtree: boolean
  /** Whether focus rests on the document body, where a keyboard user has lost their place. */
  readonly restsOnBody: boolean
  /** Whether the element focus rests on is itself hidden from assistive technology. */
  readonly restsHidden: boolean
}

const isRedirect = (arrival: FocusArrival): boolean =>
  !(arrival.staysInSubtree || arrival.restsOnBody || arrival.restsHidden)

/**
 * Decide whether a reported subtree only ever passes focus on to something a reader can perceive.
 * @param arrivals one per focusable element in the subtree, in document order.
 * @returns true when there is at least one and every one of them was redirected.
 */
export const isFocusGuard = (arrivals: readonly FocusArrival[]): boolean =>
  arrivals.length > 0 && arrivals.every((arrival: FocusArrival): boolean => isRedirect(arrival))
