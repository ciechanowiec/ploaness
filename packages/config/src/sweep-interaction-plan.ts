// What the interaction pass visits, and what each visit costs. A route is driven at the phone and the
// desktop viewport and a story at the desktop one; the page chrome, shared by every place, is driven once
// per viewport, at the first place the whole pass has at that viewport, by whichever part takes it.
import { drivenViewports, type FindingViewport, STRESS_VIEWPORTS } from '@ploaness/governance'
import type { PlaceItem, SweepLocation } from './sweep-shared.js'

/** An interaction is exercised with the visitor's actual motion preference. */
export interface InteractionPlace extends PlaceItem {
  readonly motion: 'reduce' | 'no-preference'
}

const MOTIONS: readonly InteractionPlace['motion'][] = ['reduce', 'no-preference']

/** The places the interaction pass visits, and which of them drive the page chrome. */
export interface InteractionPlan {
  readonly places: readonly InteractionPlace[]
  /** Indexes into `places`. */
  readonly chromePlaces: ReadonlySet<number>
}

/**
 * Plan the interaction pass over the discovered locations.
 * @param locations every location the sweep discovered.
 * @returns the places, in the order every part shares, and the places that drive the chrome.
 */
export const interactionPlan = (locations: readonly SweepLocation[]): InteractionPlan => {
  const places: readonly InteractionPlace[] = locations.flatMap(
    (location: SweepLocation): readonly InteractionPlace[] =>
      drivenViewports(location.isStory).flatMap((viewport: FindingViewport): readonly InteractionPlace[] =>
        MOTIONS.map((motion: InteractionPlace['motion']): InteractionPlace => ({ location, viewport, motion })),
      ),
  )
  const chromePlaces: ReadonlySet<number> = new Set<number>(
    STRESS_VIEWPORTS.flatMap((viewport: FindingViewport): readonly number[] =>
      MOTIONS.map((motion: InteractionPlace['motion']): number =>
        places.findIndex(
          (place: InteractionPlace): boolean => place.viewport.width === viewport.width && place.motion === motion,
        ),
      ),
    ),
  )
  return { places, chromePlaces }
}

/**
 * The units of work a place carries: each of its controls, and the page itself. The disclosure pass
 * counts a place the same way, because a page's disclosures are among its controls.
 * @param place the place.
 * @returns its units.
 */
export const placeUnits = (place: PlaceItem): number => place.location.controls + 1
