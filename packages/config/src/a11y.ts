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

import { type Dirent, existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { Page } from '@playwright/test'
import {
  appRootOf,
  declaredRoutesOf,
  findUnsweptRoutes,
  type SpecSource,
  type UnsweptRoute,
} from '@ploaness/governance'

import { projectSettings } from './project-settings.js'

export const SKIPPED_ROUTE_PREFIXES: readonly string[] = projectSettings.accessibilitySkipRoutes

export const MAX_SWEEP_ROUTES: number = projectSettings.accessibilityRouteBudget

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
interface PageAnimation {
  readonly playState: string
  readonly finished: Promise<unknown>
  readonly effect: { readonly getComputedTiming: () => { readonly iterations: number } } | null
}

declare const document: {
  readonly fonts: { readonly ready: Promise<unknown> } | undefined
  readonly getAnimations: (() => readonly PageAnimation[]) | undefined
  readonly querySelectorAll: (selectors: string) => { readonly length: number }
}
declare const requestAnimationFrame: (callback: () => void) => number
declare const setTimeout: (callback: () => void, delayMs: number) => unknown

// Everything this function needs is inside it. Playwright ships a page function to the browser as its
// own source text, so a reference to anything at module scope here would be a ReferenceError in the
// page rather than a compile error in this file - the one mistake this shape cannot be checked for.
// It is also why the animation wait below is written inline rather than as a helper of its own.
const settleInPage = async (budgetMs: number): Promise<void> => {
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
    if (current !== previous) {
      await stable(current, quietFrames)
      return
    }
    if (remaining > 1) {
      await stable(current, remaining - 1)
    }
  }
  const settled = async (): Promise<void> => {
    // The optional call covers a document carrying no font set at all, which must skip the wait
    // rather than fail the settle.
    await document.fonts?.ready
    // The element count FIRST, and this order is the whole of it. An animation does not exist until
    // something creates it, and on a hydrating page that something is the mount: measured before the
    // framework has mounted, `getAnimations` answers an honest empty list, and a settle that believed
    // it would scan the very frame the animation is about to start from. Waiting for the tree to stop
    // changing is waiting for the mount, which is what puts the animations on the page to be found.
    await stable(document.querySelectorAll('*').length, quietFrames)
    await Promise.all(
      (document.getAnimations?.() ?? [])
        .filter(
          (animation: PageAnimation): boolean =>
            animation.playState === 'running' &&
            animation.effect !== null &&
            Number.isFinite(animation.effect.getComputedTiming().iterations),
        )
        .map(async (animation: PageAnimation): Promise<void> => {
          try {
            await animation.finished
          } catch {
            // A cancelled animation rejects rather than resolving. The cancellation is a state change
            // like any other and the count below is what notices it.
          }
        }),
    )
    // And again afterwards, because an animation that ends by revealing a panel adds elements as it
    // finishes. This pass costs two frames on a page where nothing moved.
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
 * costs two animation frames; one that is animating costs however long its animations have left; a
 * document that never stops changing costs the budget and no more, so a page nobody can settle slows
 * the sweep rather than hanging it.
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

// What the sweep cannot work out from inside the browser: which pages this project declares.
//
// The crawl knows what it reached. Only the file tree knows what exists, so the completeness check
// needs both, and reading the tree is I/O - which is why the walk is here and every DECISION it feeds
// is in `@ploaness/governance`, where a coverage floor measures it. What follows is a directory walk
// and two file reads; which file is a route file, and what address it answers at, are not decided
// here.
//
// This is a function rather than the module-scope constants above it, and that is load-bearing.
// `ploaness/a11y` is imported by a project's own specs too - that is why `settleForScan` lives here -
// and a recursive walk evaluated at import time would run once per spec module, in every worker.

// Where a project's own code can be. Walking from the member root would descend into `node_modules`
// and `.next`, which are large, and into `dist`, which holds a compiled copy of the same routes.
const WALKED_ROOTS: readonly string[] = ['src', 'app', 'tests']

// The extensions a route file or a specification can have. Filtering here rather than in the rule
// keeps the corpus small; the rule still decides what a `page.tsx` means.
const READ_EXTENSIONS: readonly string[] = ['.ts', '.tsx', '.jsx', '.js', '.mdx']

/** Where a project's specifications live, which is a ploaness convention rather than a setting. */
const SPEC_ROOT: string = 'tests/'

const filesUnder = (root: string, relative: string): readonly string[] => {
  const entries: readonly Dirent[] = readdirSync(path.join(root, relative), {
    withFileTypes: true,
  })
  return entries.flatMap((entry: Dirent): readonly string[] => {
    // Forward slashes throughout, because the rules receive these paths as addresses-in-waiting and a
    // backslash from a Windows walk would split into segments nothing matches.
    const child: string = relative === '' ? entry.name : `${relative}/${entry.name}`
    if (entry.isDirectory()) {
      return filesUnder(root, child)
    }
    return READ_EXTENSIONS.some((extension: string): boolean => child.endsWith(extension))
      ? [child]
      : []
  })
}

const projectFiles = (root: string): readonly string[] =>
  WALKED_ROOTS.flatMap((walked: string): readonly string[] =>
    existsSync(path.join(root, walked)) ? filesUnder(root, walked) : [],
  )

const readSpecs = (root: string, paths: readonly string[]): readonly SpecSource[] =>
  paths
    .filter((file: string): boolean => file.startsWith(SPEC_ROOT))
    .map(
      (file: string): SpecSource => ({
        path: file,
        source: readFileSync(path.join(root, file), 'utf8'),
      }),
    )

/**
 * The pages this project declares that the sweep did not cover, each with what to do about it.
 *
 * Answers with nothing when the member declares no application routes at all, which is the honest
 * result for a package that has no app directory rather than a claim that its pages are covered.
 * @param visitedRoutes the addresses the crawl reached and scanned.
 * @param answeredRoutes the addresses that answered, forwarding ones included.
 * @returns one sentence per uncovered page, ready to be shown as a failure.
 */
export const unsweptRoutes = (
  visitedRoutes: readonly string[],
  answeredRoutes: readonly string[],
): readonly string[] => {
  const root: string = process.cwd()
  const paths: readonly string[] = projectFiles(root)
  const appRoot: string | undefined = appRootOf(paths)
  if (appRoot === undefined) {
    return []
  }
  const specs: readonly SpecSource[] = readSpecs(root, paths)
  return findUnsweptRoutes({
    declaredRoutes: declaredRoutesOf(paths, appRoot),
    visitedRoutes,
    answeredRoutes,
    skippedPrefixes: SKIPPED_ROUTE_PREFIXES,
    specs,
    everyFile: specs,
  }).map((unswept: UnsweptRoute): string => `${unswept.file} [${unswept.rule}] ${unswept.reason}`)
}
