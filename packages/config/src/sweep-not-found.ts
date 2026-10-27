// Missing-address probes join the ordinary sweep, so they use the application's real layout and
// every existing browser rule. Their expected document 404 is distinguished from broken subresources.
import type { Page, Response } from '@playwright/test'
import { NOT_FOUND_LOCATION_PREFIX, type NotFoundBoundary, notFoundProbes } from '@ploaness/governance'
import { declaredNotFoundBoundaries, isSkippedSweepRoute } from './a11y.js'
import { settleForScan } from './settle.js'
import { CONTROLS, origin, type SweepLocation } from './sweep-shared.js'

/** Discovered error states and boundaries for which no concrete URL was available. */
export interface NotFoundDiscovery {
  readonly locations: readonly SweepLocation[]
  readonly problems: readonly string[]
}

const STREAMED_PAGE_STATUS: number = 200
const MISSING_PAGE_STATUS: number = 404
const PAGE_STATUSES: ReadonlySet<number> = new Set<number>([STREAMED_PAGE_STATUS, MISSING_PAGE_STATUS])

const probe = async (page: Page, route: string): Promise<SweepLocation> => {
  const response: Response | null = await page.goto(`${origin}${route}`)
  if (response === null || !PAGE_STATUSES.has(response.status())) {
    throw new Error(`Not-found probe ${route} did not return HTML with status 200 or 404`)
  }
  if (response.headers()['content-type']?.includes('text/html') !== true) {
    throw new Error(`Not-found probe ${route} did not return HTML`)
  }
  await settleForScan(page)
  return {
    location: `${NOT_FOUND_LOCATION_PREFIX}${new URL(page.url()).pathname}`,
    url: page.url(),
    isStory: false,
    edges: [],
    hasDarkMedia: false,
    controls: await page.locator(CONTROLS).count(),
  }
}

/**
 * Discover missing-page states using concrete locale and route prefixes from the public crawl.
 * @param page the discovery page.
 * @param visited the public URLs already reached.
 * @returns the error pages to scan and any unresolved boundaries.
 */
export const discoverNotFound = async (page: Page, visited: readonly string[]): Promise<NotFoundDiscovery> => {
  const boundaries: readonly NotFoundBoundary[] = declaredNotFoundBoundaries()
  const probes: readonly string[] = [
    ...new Set<string>(
      boundaries.flatMap((boundary: NotFoundBoundary): readonly string[] => notFoundProbes(boundary, visited)),
    ),
  ].filter((route: string): boolean => !isSkippedSweepRoute(route))
  const locations: readonly SweepLocation[] = await probes.reduce(
    async (earlier: Promise<readonly SweepLocation[]>, route: string): Promise<readonly SweepLocation[]> => [
      ...(await earlier),
      await probe(page, route),
    ],
    Promise.resolve<readonly SweepLocation[]>([]),
  )
  return {
    locations,
    problems: boundaries
      .filter((boundary: NotFoundBoundary): boolean => notFoundProbes(boundary, visited).length === 0)
      .map(
        (boundary: NotFoundBoundary): string =>
          `${boundary.file}: no concrete public prefix reaches its not-found state`,
      ),
  }
}
