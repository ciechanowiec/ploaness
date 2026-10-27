// Error boundaries are rendered states, not ordinary links a crawler will discover.
import { type DeclaredRoute, declaredRouteOf, matchesRoute, normalisedRoute } from './route-map.js'

export const NOT_FOUND_LOCATION_PREFIX: string = 'not-found:'
const MISSING_SEGMENT: string = '__ploaness_missing_page__'
const NOT_FOUND_FILE: RegExp = /(?:^|\/)not-found\.(?:tsx?|jsx?)$/u

/** One authored not-found boundary and the URL prefix whose layout contains it. */
export interface NotFoundBoundary {
  readonly file: string
  readonly route: string
}

/**
 * Find authored not-found modules using the same route-group and slot rules as ordinary pages.
 * @param files the member's files.
 * @param appRoot the selected Next app root.
 * @returns the boundaries whose error state requires a scan.
 */
export const notFoundBoundaries = (files: readonly string[], appRoot: string): readonly NotFoundBoundary[] =>
  files.flatMap((file: string): readonly NotFoundBoundary[] => {
    if (!(file.startsWith(`${appRoot}/`) && NOT_FOUND_FILE.test(file))) {
      return []
    }
    const relative: string = file.slice(appRoot.length + 1).replace(/not-found\.[^.]+$/u, 'page.tsx')
    const route: DeclaredRoute | undefined = declaredRouteOf(relative)
    return route === undefined ? [] : [{ file, route: route.route }]
  })

/**
 * Concrete missing addresses under one boundary, substituting dynamic prefixes from visited pages.
 * @param boundary the authored boundary.
 * @param visited the public URLs discovered in this run.
 * @returns one probe per concrete prefix; none means the project must exercise that boundary itself.
 */
export const notFoundProbes = (boundary: NotFoundBoundary, visited: readonly string[]): readonly string[] => {
  const segments: readonly string[] = boundary.route.split('/').filter((segment: string): boolean => segment !== '')
  const candidates: readonly string[] = boundary.route.includes('[')
    ? visited.map((route: string): string => `/${route.split('/').filter(Boolean).slice(0, segments.length).join('/')}`)
    : [boundary.route]
  return [...new Set<string>(candidates)]
    .filter((prefix: string): boolean => matchesRoute(boundary.route, prefix))
    .map((prefix: string): string => `${prefix === '/' ? '' : normalisedRoute(prefix)}/${MISSING_SEGMENT}`)
}
