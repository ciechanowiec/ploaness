// What the shipped accessibility sweep cannot know about the project it runs in, and the two decisions
// it must not make for itself.
//
// The sweep is a managed file, byte-identical in every consumer, so this module is the whole of its
// configuration surface. The first two entries are one-directional: a project may add a route prefix
// the crawl must not follow and may lower the route ceiling, and can do neither in the other
// direction.
//
// The last two are not configuration at all. They are rules, so they live in `@ploaness/governance`
// where a spec exercises them against captured axe output and against probe shapes no browser has to
// produce on demand, and they are re-exported here because the sweep imports through one entry point.
//
// `settleForScan` is a third kind again: neither a setting nor a rule, but the one piece of I/O the
// sweep cannot do without and cannot keep to itself. It is here rather than in `@ploaness/governance`
// because that package forbids I/O, and here rather than inside the sweep because a project has to
// write its own scans for the pages the crawl cannot discover - an unlinked page, a custom admin view -
// and two definitions of "the page is ready" would drift.

export type {
  HitTargetClassification,
  HitTargetProbe,
  HitTargetVerdict,
} from '@ploaness/governance'
export { classifyHitTarget, findDefiniteIncomplete } from '@ploaness/governance'

import type { Page } from '@playwright/test'

import { projectSettings } from './project-settings.js'

export const SKIPPED_ROUTE_PREFIXES: readonly string[] = projectSettings.accessibilitySkipRoutes

export const MAX_SWEEP_ROUTES: number = projectSettings.accessibilityRouteBudget

// Why a scan needs a wait at all: `page.goto` resolves at the `load` event, and a React application
// hydrates after that. axe measured in between reads a tree still being assembled - a heading whose
// level has not resolved lands in `incomplete`, which a consuming project saw on one run in three -
// and reads contrast against text the final font has not laid out yet.
//
// WHAT IT WAITS FOR. The document's font set has answered, and the element count has then held steady
// across two consecutive animation frames. Fonts first, because contrast is measured on rendered
// pixels and a face that arrives late reflows the text being judged. Two frames rather than one,
// because React yields between hydration segments and a yield that happens to straddle a frame
// boundary is indistinguishable from a finished render if only one frame is asked. A fixed count of
// frames was the first draft and was wrong in the direction that matters: it settles the pages that
// were never the problem and gives up on a heavy panel exactly where the defect lives.
//
// WHY NOT `networkidle`. Playwright's own documentation discourages it; it throws on expiry rather
// than resolving; and it answers a different question. A page can be network-idle and mid-hydration.
// It is also unusable here in particular: the sweep runs against `next dev`, whose every page holds a
// hot-reload socket open, so no page it ever visits goes idle.
//
// WHY THE CEILING IS A TIMER. `requestAnimationFrame` does not fire in a page the browser has
// backgrounded, so a frame-counted ceiling is not a ceiling. A throttled background timer still fires.
// The race is inside the page for the same reason the hit-target probe does its work in one
// `evaluate`: a Node-side race would leave the in-page promise pending against a context the next
// navigation destroys.
const SETTLE_BUDGET_MS: number = 1000

// The browser surface the page function touches, declared rather than pulled in with lib.dom. This
// package builds under `lib: ["ES2023"]`, and `tsconfig.lint.json` compiles every package as ONE
// program - so adding "DOM" here would put `document` in scope for `@ploaness/governance` too, a
// package whose whole claim is that it cannot reach a browser. It would also pair lib.dom's `fetch`,
// `Response` and `WebSocket` against the same names from `@types/node`. Three identifiers do not buy
// that. They resolve in the PAGE at run time, where they are real. Same move, same reason, as the
// declaration `ambient.d.ts` makes for a plugin that ships no types.
declare const document: {
  readonly fonts: { readonly ready: Promise<unknown> } | undefined
  readonly querySelectorAll: (selectors: string) => { readonly length: number }
}
declare const requestAnimationFrame: (callback: () => void) => number
declare const setTimeout: (callback: () => void, delayMs: number) => unknown

// Everything this function needs is inside it. Playwright ships a page function to the browser as its
// own source text, so a reference to anything at module scope here would be a ReferenceError in the
// page rather than a compile error in this file - the one mistake this shape cannot be checked for.
const settleInPage = async (budgetMs: number): Promise<void> => {
  const quietFrames: number = 2
  const nextFrame = async (): Promise<void> => {
    await new Promise<void>((resolve: () => void): void => {
      requestAnimationFrame((): void => {
        resolve()
      })
    })
  }
  // Recursive rather than a loop over a counter, because there is no mutable binding to count with:
  // this repository bans `let` and in-place mutation in its own source as well as in a consumer's. Each
  // step awaits a frame, so what grows is frames rather than stack - an awaited recursion returns to
  // the microtask queue every time.
  const stable = async (previous: number, remaining: number): Promise<void> => {
    await nextFrame()
    const current: number = document.querySelectorAll('*').length
    if (current !== previous) {
      await stable(current, quietFrames)
      return
    }
    if (remaining > 1) {
      await stable(current, remaining - 1)
    }
  }
  const settled = async (): Promise<void> => {
    // The union covers a document carrying no font set at all, which must skip the wait rather than
    // fail the settle.
    const fonts: { readonly ready: Promise<unknown> } | undefined = document.fonts
    if (fonts !== undefined) {
      await fonts.ready
    }
    await stable(document.querySelectorAll('*').length, quietFrames)
  }
  const deadline = async (): Promise<void> => {
    await new Promise<void>((resolve: () => void): void => {
      setTimeout((): void => {
        resolve()
      }, budgetMs)
    })
  }
  await Promise.race([settled(), deadline()])
}

/**
 * Wait for a page to finish rendering, before anything measures it.
 *
 * Call it after a navigation, and after a state change a scan is about to judge. A still document
 * costs two animation frames; a document that never stops changing costs the budget and no more, so a
 * page nobody can settle slows the sweep rather than hanging it.
 * @param page the page about to be scanned, left on whatever route it holds.
 * @returns nothing. It resolves whether the page settled or the budget ran out.
 */
export const settleForScan = async (page: Page): Promise<void> => {
  try {
    await page.evaluate(settleInPage, SETTLE_BUDGET_MS)
  } catch {
    // A route that redirects on mount destroys the execution context while this is in flight, and a
    // closed page cannot be asked anything. Neither is an accessibility finding, and neither should end
    // a sweep: the scan that follows then runs on whatever the page holds, which is what every call
    // site did before this function existed. A page that is genuinely broken still fails at `analyze`,
    // with an axe result to read rather than a protocol error naming no route.
  }
}
