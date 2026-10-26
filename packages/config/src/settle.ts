// The wait every browser scan takes before it measures, shared by the accessibility and layout scans.
import type { Page } from '@playwright/test'
import { loadFontFacesInPage, usedFontFamiliesInPage } from './font-settle.js'

// Why a scan needs a wait at all: `page.goto` resolves at the `load` event, and a React application
// hydrates after that. axe measured in between reads a tree still being assembled - a heading whose
// level has not resolved lands in `incomplete`, which a consuming project saw on one run in three -
// and reads contrast against text the final font has not laid out yet.
//
// WHAT IT WAITS FOR, in this order: the document's font set has answered; the element count has held
// steady across two consecutive animation frames; every animation that will ever end has ended; and
// the count has held steady once more. Fonts first, because contrast is measured on rendered pixels
// and a face that arrives late reflows the text being judged. The count before the animations rather
// than after, for the reason written beside it - an animation cannot be waited for until something has
// created it, and on a hydrating page the mount is what creates it. Two frames rather than one,
// because React yields between hydration segments and a
// yield that happens to straddle a frame boundary is indistinguishable from a finished render if only
// one frame is asked. A fixed count of frames was the first draft and was wrong in the direction that
// matters: it settles the pages that were never the problem and gives up on a heavy panel exactly
// where the defect lives.
//
// WHY ANIMATIONS ARE PART OF IT. An element count cannot see an opacity. A page that fades its content
// in changes no element while it does so, so the count was steady two frames after hydration and a
// scan then measured a half-transparent paragraph - and axe blends a partial opacity toward the
// background exactly as an eye does, so it reported a contrast this page never actually renders at
// rest. That is the harmless direction. The other one is why this is a correctness fix rather than a
// convenience: text animating TOWARDS a colour too pale to read was measured at its opening frame and
// PASSED, so the sweep built to catch contrast defects returned green on a page whose resting state is
// a defect. Waiting for the animations to end measures the state a reader is left looking at.
//
// An animation that never ends is excluded rather than waited on, and the distinction is the whole
// reason this does not simply cost the budget. A spinner has no resting state to wait for, so awaiting
// it would spend the ceiling below on every settle of every control of every route, in exchange for
// nothing. `finished` never resolves for one, which is a hang the ceiling would absorb silently. The
// test for it is `iterations`, which a spinner reports as `Infinity`; a paused or already-finished
// animation is excluded too, because it is showing the frame a reader is looking at right now.
//
// A cancelled animation REJECTS `finished` rather than resolving, and that rejection is swallowed. A
// cancellation is a state change like any other and the element-count check notices it; ending the
// whole settle over one cancelled transition would report nothing useful about the page.
//
// The two callbacks below are written inline rather than named, which is not a style preference: a
// named helper closing over nothing is one the shipped rules ask to be hoisted to the outer scope, and
// the outer scope is the one place this function may not reach.
//
// WHY NOT `networkidle`. Playwright's own documentation discourages it; it throws on expiry rather
// than resolving; and it answers a different question. A page can be network-idle and mid-hydration.
// It is also unusable here in particular: the sweep runs against `next dev`, whose every page holds a
// hot-reload socket open, so no page it ever visits goes idle.
//
// WHY IMAGES ARE PART OF IT. A rule that judges an image reads its natural size and whether it loaded,
// and a lazy image below the fold has not started loading when the page settles. Every lazy image is
// therefore asked to load now, and every image's decode is awaited. A decode that fails is swallowed
// here: the image rule reports the broken image, with its element named.
//
// WHY THE CEILING IS A TIMER. `requestAnimationFrame` does not fire in a page the browser has
// backgrounded, so a frame-counted ceiling is not a ceiling. A throttled background timer still fires.
// The race is inside the page for the same reason the hit-target probe does its work in one
// `evaluate`: a Node-side race would leave the in-page promise pending against a context the next
// navigation destroys.
// Reaching it is a finding rather than a timeout the scan proceeds past: a page that has not settled
// gives every verdict measured on it the standing of a coin toss.
const SETTLE_BUDGET_MS: number = 10_000

// WHY A BUSY REGION IS WAITED FOR, AND ON A CEILING OF ITS OWN. `aria-busy="true"` is a page saying
// in so many words that a region is still being filled, and a framework's loading fallback says it:
// Next streams a route's content into a hidden container and React reveals it in place of the busy
// fallback a moment later, throttled, so on a loaded machine the fallback is still what a reader sees
// two quiet frames after `load`. Scanned then, the sweep judged a spinner instead of the page - the
// page's heading sat in the hidden container, so a document that has one was reported without it, and a
// region-scoped scan before that had passed the spinner without judging the page at all. Only a
// VISIBLE busy element holds the settle, because a fallback React has hidden is not what anyone reads.
// The wait is bounded separately because it is for a server rather than a frame: a cold application
// compiling its first request takes seconds, while a region that is busy forever is a defect the scan
// that follows should see rather than one this wait should hide by hanging.
const BUSY_BUDGET_MS: number = 30_000

// The browser surface the page function touches, declared rather than pulled in with lib.dom. This
// package builds under `lib: ["ES2023"]`, and `tsconfig.lint.json` compiles every package as ONE
// program - so adding "DOM" here would put `document` in scope for `@ploaness/governance` too, a
// package whose whole claim is that it cannot reach a browser. It would also pair lib.dom's `fetch`,
// `Response` and `WebSocket` against the same names from `@types/node`. Three identifiers do not buy
// that. They resolve in the PAGE at run time, where they are real. Same move, same reason, as the
// declaration `ambient.d.ts` makes for a plugin that ships no types.
interface PageAnimation {
  readonly playState: string
  readonly finished: Promise<unknown>
  readonly effect: { readonly getComputedTiming: () => { readonly iterations: number } } | null
}

interface PageElement {
  readonly checkVisibility: () => boolean
}

interface PageImage {
  readonly loading: string
  readonly decode: () => Promise<void>
  readonly setAttribute: (name: string, value: string) => void
}

declare const document: {
  readonly fonts: { readonly ready: Promise<unknown> } | undefined
  readonly getAnimations: (() => readonly PageAnimation[]) | undefined
  readonly querySelectorAll: (selectors: string) => ArrayLike<PageElement>
  readonly images: ArrayLike<PageImage>
}
declare const requestAnimationFrame: (callback: () => void) => number
declare const setTimeout: (callback: () => void, delayMs: number) => unknown

// Everything this function needs is inside it. Playwright ships a page function to the browser as its
// own source text, so a reference to anything at module scope here would be a ReferenceError in the
// page rather than a compile error in this file - the one mistake this shape cannot be checked for.
// It is also why the animation wait below is written inline rather than as a helper of its own.
const isSettledInPage = async (budgetMs: number): Promise<boolean> => {
  const quietFrames: number = 2
  // Recursive rather than a loop over a counter, because there is no mutable binding to count with:
  // this repository bans `let` and in-place mutation in its own source as well as in a consumer's. Each
  // step awaits a frame, so what grows is frames rather than stack - an awaited recursion returns to
  // the microtask queue every time. The frame is awaited inline because this is its only caller.
  const stable = async (previous: number, remaining: number): Promise<void> => {
    await new Promise<void>((resolve: () => void): void => {
      requestAnimationFrame((): void => {
        resolve()
      })
    })
    const current: number = document.querySelectorAll('*').length
    // A change restarts the count of quiet frames; a quiet frame spends one of them.
    const left: number = current === previous ? remaining - 1 : quietFrames
    if (left > 0) {
      await stable(current, left)
    }
  }
  const hasSettled = async (): Promise<boolean> => {
    // The optional call covers a document carrying no font set at all, which must skip the wait
    // rather than fail the settle.
    await document.fonts?.ready
    // Settled rather than all fulfilled: a broken image is the image rule's finding, reported with its
    // element.
    await Promise.allSettled(
      Array.from(document.images, async (image: PageImage): Promise<void> => {
        if (image.loading === 'lazy') {
          image.setAttribute('loading', 'eager')
        }
        await image.decode()
      }),
    )
    // The element count FIRST, and this order is the whole of it. An animation does not exist until
    // something creates it, and on a hydrating page that something is the mount: measured before the
    // framework has mounted, `getAnimations` answers an honest empty list, and a settle that believed
    // it would scan the very frame the animation is about to start from. Waiting for the tree to stop
    // changing is waiting for the mount, which is what puts the animations on the page to be found.
    await stable(document.querySelectorAll('*').length, quietFrames)
    // Settled rather than all fulfilled: a cancelled animation rejects rather than resolving. The
    // cancellation is a state change like any other and the count below is what notices it.
    await Promise.allSettled(
      (document.getAnimations?.() ?? [])
        .filter(
          (animation: PageAnimation): boolean =>
            animation.playState === 'running' &&
            animation.effect !== null &&
            Number.isFinite(animation.effect.getComputedTiming().iterations),
        )
        .map(async (animation: PageAnimation): Promise<unknown> => await animation.finished),
    )
    // And again afterwards, because an animation that ends by revealing a panel adds elements as it
    // finishes. This pass costs two frames on a page where nothing moved.
    await stable(document.querySelectorAll('*').length, quietFrames)
    return true
  }
  const isSettledByDeadline = async (): Promise<boolean> => {
    await new Promise<void>((resolve: () => void): void => {
      setTimeout((): void => {
        resolve()
      }, budgetMs)
    })
    return false
  }
  return await Promise.race([hasSettled(), isSettledByDeadline()])
}

interface BusyOutcome {
  readonly wasBusy: boolean
  readonly isRevealed: boolean
}

// Self-contained for the same reason as the settle above. Frame by frame, like the count, so a region
// revealed between two checks is seen on the next. Answers whether anything was busy at all, so a page
// that never was is not settled a second time.
const busyInPage = async (budgetMs: number): Promise<BusyOutcome> => {
  const busySelector: string = '[aria-busy="true"]'
  const isBusy = (): boolean =>
    Array.from(document.querySelectorAll(busySelector)).some((element: PageElement): boolean =>
      element.checkVisibility(),
    )
  const wasBusy: boolean = isBusy()
  const hasCleared = async (): Promise<boolean> => {
    if (!isBusy()) {
      return true
    }
    await new Promise<void>((resolve: () => void): void => {
      requestAnimationFrame((): void => {
        resolve()
      })
    })
    return await hasCleared()
  }
  const isRevealed: boolean = await Promise.race([
    hasCleared(),
    new Promise<boolean>((resolve: (isCleared: boolean) => void): void => {
      setTimeout((): void => {
        resolve(false)
      }, budgetMs)
    }),
  ])
  return { wasBusy, isRevealed }
}

// A slow machine can still be working through a heavy page when the ceiling passes, and a page that
// settles at the second attempt was slow rather than unstable. One more attempt only, so a page that
// never rests costs two ceilings and is reported as before.
const SETTLE_ATTEMPTS: number = 2

const isSettledWithin = async (page: Page, attempts: number): Promise<boolean> =>
  (await page.evaluate(isSettledInPage, SETTLE_BUDGET_MS)) ||
  (attempts > 1 && (await isSettledWithin(page, attempts - 1)))

/** How a settle ended. */
export type SettleOutcome = 'settled' | 'ceiling' | 'busy' | 'interrupted'

/**
 * Wait for a page to finish rendering, before anything measures it.
 *
 * Call it after a navigation, and after a state change a scan is about to judge. A still document
 * costs two animation frames; one that is animating costs however long its animations have left. A
 * visible `aria-busy="true"` region is waited for until it clears, on a longer ceiling of its own, and
 * the page is then settled again. The faces its text uses are then loaded, so a face the browser had
 * yet to ask for is measured loaded rather than reported missing.
 * @param page the page about to be scanned, left on whatever route it holds.
 * @returns `settled`, or what stopped it: the ceiling, a region that stayed busy, or a navigation that
 * destroyed the page while it waited. The sweep reports every outcome but `settled` as a finding.
 */
export const settleForScan = async (page: Page): Promise<SettleOutcome> => {
  try {
    if (!(await isSettledWithin(page, SETTLE_ATTEMPTS))) {
      return 'ceiling'
    }
    const busy: BusyOutcome = await page.evaluate(busyInPage, BUSY_BUDGET_MS)
    if (!busy.isRevealed) {
      return 'busy'
    }
    // Revealing the content changes the tree, so a page that was busy is settled once more after it.
    if (busy.wasBusy && !(await isSettledWithin(page, SETTLE_ATTEMPTS))) {
      return 'ceiling'
    }
    const families: readonly string[] = await page.evaluate(usedFontFamiliesInPage)
    if (families.length > 0) {
      await page.evaluate(loadFontFacesInPage, { families, budgetMs: SETTLE_BUDGET_MS })
    }
    return 'settled'
  } catch {
    // A route that redirects on mount destroys the execution context while this is in flight, and a
    // closed page cannot be asked anything. The caller decides what that means for its scan.
    return 'interrupted'
  }
}
