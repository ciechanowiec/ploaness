// What the shipped browser sweep cannot know about the project it runs in, and the scans a project's own
// specifications share with it.
//
// The sweep is a managed file, byte-identical in every consumer, so this module is the whole of its
// configuration surface. The first two entries are one-directional: a project may add a route prefix
// the crawl must not follow and may lower the route ceiling, and can do neither in the other
// direction.
//
// The rules are not configuration at all. They live in `@ploaness/governance`, where a spec exercises
// them against captured axe output, probe shapes and layout snapshots no browser has to produce on
// demand, and they are re-exported here because the sweep imports through one entry point.
//
// The scans are a third kind again: I/O the sweep cannot do without and cannot keep to itself. They are
// here rather than in `@ploaness/governance` because that package forbids I/O, and here rather than
// inside the sweep because a project has to write its own scans for the pages the crawl cannot discover
// - an unlinked page, a page behind a sign-in, a custom admin view - and two definitions of a scan would
// drift. `expectSweptPage` runs both of the sweep's scans, so one call covers such a page.

export type {
  HitTargetClassification,
  HitTargetProbe,
  HitTargetVerdict,
} from '@ploaness/governance'
export { classifyHitTarget, findDefiniteIncomplete } from '@ploaness/governance'
export { expectNoLayoutDefects, LAYOUT_SCAN_VIEWPORTS, layoutDefectsOf } from './layout.js'
export { settleForScan } from './settle.js'

import { type Dirent, existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { AxeBuilder } from '@axe-core/playwright'
import { expect, type Page } from '@playwright/test'
import {
  appRootOf,
  declaredRoutesOf,
  findDefiniteIncomplete,
  findUnsweptRoutes,
  type SpecSource,
  type UnsweptRoute,
} from '@ploaness/governance'
import { expectNoLayoutDefects } from './layout.js'
import { projectSettings } from './project-settings.js'
import { settleForScan } from './settle.js'

export const SKIPPED_ROUTE_PREFIXES: readonly string[] = projectSettings.accessibilitySkipRoutes

export const MAX_SWEEP_ROUTES: number = projectSettings.accessibilityRouteBudget

/** What axe answers, taken from the builder's own surface rather than from a transitive package. */
export type AxeResults = Awaited<ReturnType<AxeBuilder['analyze']>>

// Scan the site's semantic regions - chrome and content alike - but not a framework's dev-only overlay,
// which lives in a separate portal outside them and would otherwise raise findings about the framework.
// Only regions actually present are included, so a page carrying just <main> scans cleanly rather than
// erroring on a missing include target.
const REGIONS: readonly string[] = ['header', 'main', 'footer']

/**
 * An axe builder scoped to the page's semantic regions.
 * @param page the page to scan.
 * @returns a builder including each of `header`, `main` and `footer` the page has.
 */
export const scopedAxe = async (page: Page): Promise<AxeBuilder> => {
  const builder: AxeBuilder = new AxeBuilder({ page })
  for (const region of REGIONS) {
    if ((await page.locator(region).count()) > 0) {
      builder.include(region)
    }
  }
  return builder
}

// axe answers in three buckets. `incomplete` means "the check ran and could not decide", and an EXACTLY
// equal foreground and background is filed there rather than as a violation, because axe reads two
// identical colours as text hidden on purpose and defers to a human. `findDefiniteIncomplete` picks out
// only the entries that need no human - see its own module for why the list is one key long.
/**
 * Fail the calling test on an axe violation or a definite defect axe filed as undecided.
 * @param scan the axe result.
 * @param label what was scanned, for the failure message.
 */
export const expectNoAxeDefects = (scan: AxeResults, label: string): void => {
  expect(scan.violations, label).toEqual([])
  expect(findDefiniteIncomplete(scan.incomplete), `${label} (undecidable-but-definite)`).toEqual([])
}

/**
 * Run both of the sweep's scans on a page: axe in its default state, then layout at every viewport.
 *
 * The one call a project's own specification needs for a page the crawl cannot reach. The route
 * coverage check reads it as evidence of both scans.
 * @param page the page, already on the route and in the state to judge.
 * @returns nothing; it fails the test on the first scan that finds a defect.
 */
export const expectSweptPage = async (page: Page): Promise<void> => {
  await settleForScan(page)
  const builder: AxeBuilder = await scopedAxe(page)
  expectNoAxeDefects(
    await builder.analyze(),
    `default-state a11y on ${new URL(page.url()).pathname}`,
  )
  await expectNoLayoutDefects(page)
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
