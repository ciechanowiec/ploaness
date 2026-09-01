import { containsBuiltRoute, containsRoute, reachesAxe, type SpecSource } from './axe-coverage.js'
import { type DeclaredRoute, matchesRoute, staticPrefixOf } from './route-map.js'

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
  readonly specs: readonly SpecSource[]
  readonly everyFile: readonly SpecSource[]
}

/** A declared page nothing looked at. */
export interface UnsweptRoute {
  readonly file: string
  readonly route: string
  readonly rule: string
  readonly reason: string
}

const REMEDIES: string =
  'link it from a page the crawl reaches, scan it in a specification of your own with axe, or ' +
  'declare it in `ploaness.accessibilitySkipRoutes` with the reason it is out of scope'

// The same plain prefix test the crawl itself applies in `toRoute`, deliberately. A stricter one -
// requiring the prefix to end on a segment boundary - would report a route the crawl was told to skip
// and did skip, which is a finding about the harness disagreeing with itself.
const isSkipped = (route: string, prefixes: readonly string[]): boolean =>
  prefixes.some((prefix: string): boolean => route.startsWith(prefix))

// A page the crawl asked for, that answered, and that forwarded somewhere outside the public surface.
// There is nothing at that address for axe to judge - what renders is wherever it forwarded to, which
// has a declaration of its own - so a redirect is covered rather than unswept.
const isRedirect = (sweep: RouteSweep, route: DeclaredRoute): boolean =>
  sweep.answeredRoutes.some((answered: string): boolean => matchesRoute(route.route, answered)) &&
  !sweep.visitedRoutes.some((visited: string): boolean => matchesRoute(route.route, visited))

const isScanned = (sweep: RouteSweep, route: DeclaredRoute): boolean =>
  sweep.visitedRoutes.some((visited: string): boolean => matchesRoute(route.route, visited))

// What counts as a specification driving this route. A static address can be looked for as itself; a
// dynamic one cannot, because a spec never contains `/posts/[slug]` - it contains `/posts/` and then a
// value it computed. See `containsBuiltRoute` for why the prefix alone is not enough.
const isDrivenBy = (spec: SpecSource, route: DeclaredRoute): boolean =>
  route.isDynamic
    ? containsBuiltRoute(spec.source, staticPrefixOf(route.route))
    : containsRoute(spec.source, route.route)

const unsweptRoute = (sweep: RouteSweep, route: DeclaredRoute): UnsweptRoute[] => {
  const driving: readonly SpecSource[] = sweep.specs.filter((spec: SpecSource): boolean =>
    isDrivenBy(spec, route),
  )
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
  return driving.some((spec: SpecSource): boolean => reachesAxe(spec, sweep.everyFile))
    ? []
    : [
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

/**
 * The declared pages the sweep did not cover and nothing else scans.
 * @param sweep what the crawl reached, what the project declares, and where a scan would be written.
 * @returns one violation per page nothing looked at, in the order the routes were declared.
 */
export const findUnsweptRoutes = (sweep: RouteSweep): readonly UnsweptRoute[] =>
  sweep.declaredRoutes.flatMap((route: DeclaredRoute): UnsweptRoute[] => {
    if (isSkipped(route.route, sweep.skippedPrefixes) || isScanned(sweep, route)) {
      return []
    }
    return isRedirect(sweep, route) ? [] : unsweptRoute(sweep, route)
  })
