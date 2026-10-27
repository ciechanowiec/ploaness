import { containsBuiltRoute, containsRoute, reachesAxe, reachesLayoutScan, type SpecSource } from './axe-coverage.js'
import { isSkippedRoute } from './route-exclusions.js'
import { type DeclaredRoute, resolvedRouteOf, staticPrefixOf } from './route-map.js'

// The pages the accessibility sweep never reached, and nobody was told about.
//
// The sweep finds routes by following links from the home page, anonymously. That is what keeps it
// default-safe as a site grows - a page linked anywhere is checked the moment it exists, with no test
// to add - and it is also its blind spot: a page the crawl cannot reach is not scanned, and until this
// rule existed it was not reported either. A passing sweep read the same whether it had covered a
// whole site or half of one.
//
// Three shapes of page fall outside the crawl, and all three are ordinary rather than exotic: one
// linked from nowhere, one whose link renders only for a signed-in visitor, and one whose address does
// not exist until a record is created. The first is an oversight, the second and third are the normal
// architecture of an application with accounts.
//
// So this asks the question `admin-view-coverage` asks of a custom admin view, one layer out: ploaness
// cannot reach the page, so the project is required to have reached it somewhere a check can see.
// There are three honest answers - link it, scan it in a specification of the project's own, or
// declare it out of scope - and the finding names all three, because a rule that reports a defect
// without naming its repair is half a rule.

/** Everything the coverage question is answered from. */
export interface RouteSweep {
  readonly declaredRoutes: readonly DeclaredRoute[]
  /** The addresses the crawl reached AND scanned. */
  readonly visitedRoutes: readonly string[]
  /** The addresses that answered, including those that forwarded off the public surface. */
  readonly answeredRoutes: readonly string[]
  readonly skippedPrefixes: readonly string[]
  /** Explicit project prefixes; legacy callers infer non-framework entries from skippedPrefixes. */
  readonly customSkippedPrefixes?: readonly string[] | undefined
  readonly specs: readonly SpecSource[]
  readonly everyFile: readonly SpecSource[]
  /** Present at teardown, when actual execution must back any source-level scan evidence. */
  readonly completedRoutes?: readonly string[] | undefined
}

/** A declared page nothing looked at. */
export interface UnsweptRoute {
  readonly file: string
  readonly route: string
  readonly rule: string
  readonly reason: string
}

const REMEDIES: string =
  'link it from a page the crawl reaches, scan it in a specification of your own with ' +
  '`expectSweptPage(page)` from `ploaness/a11y`, or declare it in `ploaness.accessibilitySkipRoutes` ' +
  'with the reason it is out of scope'

// An answered redirect is covered at its source address even if it leaves the public surface.
// Both visits and redirects credit only the declaration selected from the complete route set.
const coveredFiles = (sweep: RouteSweep): ReadonlySet<string> =>
  new Set(
    [...sweep.visitedRoutes, ...sweep.answeredRoutes, ...(sweep.completedRoutes ?? [])].flatMap(
      (visited: string): readonly string[] => {
        const route: DeclaredRoute | undefined = resolvedRouteOf(sweep.declaredRoutes, visited)
        return route === undefined ? [] : [route.file]
      },
    ),
  )

// What counts as a specification driving this route. A static address can be looked for as itself; a
// dynamic one cannot, because a spec never contains `/posts/[slug]` - it contains `/posts/` and then a
// value it computed. See `containsBuiltRoute` for why the prefix alone is not enough.
const isDrivenBy = (spec: SpecSource, route: DeclaredRoute): boolean =>
  route.isDynamic
    ? containsBuiltRoute(spec.source, staticPrefixOf(route.route))
    : containsRoute(spec.source, route.route)

const executionFindings = (sweep: RouteSweep, route: DeclaredRoute): UnsweptRoute[] => {
  return sweep.completedRoutes === undefined
    ? []
    : [
        {
          file: route.file,
          route: route.route,
          rule: 'route-unexecuted',
          reason:
            `no completed expectSweptPage scan reached "${route.route}" in this run; ` +
            'run its browser specification',
        },
      ]
}

const unsweptRoute = (sweep: RouteSweep, route: DeclaredRoute): UnsweptRoute[] => {
  const driving: readonly SpecSource[] = sweep.specs.filter((spec: SpecSource): boolean => isDrivenBy(spec, route))
  if (driving.length === 0) {
    return [
      {
        file: route.file,
        route: route.route,
        rule: 'route-unswept',
        reason:
          `the accessibility sweep never reached "${route.route}", and no specification drives it ` +
          `either, so this page has no accessibility coverage at all: ${REMEDIES}`,
      },
    ]
  }
  if (!driving.some((spec: SpecSource): boolean => reachesAxe(spec, sweep.everyFile))) {
    return [
      {
        file: route.file,
        route: route.route,
        rule: 'route-unscanned',
        reason:
          `the accessibility sweep never reached "${route.route}". A specification drives it but ` +
          `nothing scans it with axe, so this page has no accessibility coverage: ${REMEDIES}`,
      },
    ]
  }
  if (!driving.some((spec: SpecSource): boolean => reachesLayoutScan(spec, sweep.everyFile))) {
    return [
      {
        file: route.file,
        route: route.route,
        rule: 'route-unmeasured',
        reason:
          `the sweep never reached "${route.route}". A specification scans it with axe but ` +
          `nothing measures its layout, so this page has no layout coverage: ${REMEDIES}`,
      },
    ]
  }
  return executionFindings(sweep, route)
}

/**
 * The declared pages the sweep did not cover and nothing else scans.
 * @param sweep what the crawl reached, what the project declares, and where a scan would be written.
 * @returns one violation per page nothing looked at, in the order the routes were declared.
 */
export const findUnsweptRoutes = (sweep: RouteSweep): readonly UnsweptRoute[] => {
  const covered: ReadonlySet<string> = coveredFiles(sweep)
  return sweep.declaredRoutes.flatMap((route: DeclaredRoute): UnsweptRoute[] =>
    isSkippedRoute(route.route, sweep.skippedPrefixes, sweep.customSkippedPrefixes) || covered.has(route.file)
      ? []
      : unsweptRoute(sweep, route),
  )
}
