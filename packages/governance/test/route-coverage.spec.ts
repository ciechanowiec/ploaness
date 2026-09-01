import { describe, expect, it } from 'vitest'
import type { SpecSource } from '../src/axe-coverage.js'
import { findUnsweptRoutes, type RouteSweep, type UnsweptRoute } from '../src/route-coverage.js'
import type { DeclaredRoute } from '../src/route-map.js'

// The pages the crawl never reached, and whether anything else looked at them.
//
// The three shapes that matter are all ordinary: a page linked from nowhere, a page whose link renders
// only for a signed-in visitor, and a page whose address does not exist until a record is created.
// The second and third are the normal architecture of an application with accounts, which is why the
// answer cannot be "link everything".

// A fixture whose whole point is to CONTAIN a template placeholder cannot be written as one: a plain
// string holding the opening pair reads as a placeholder somebody forgot to interpolate, and the lint
// pass is right to say so. The pair is assembled from its halves instead.
const DOLLAR: string = '$'
const HOLE: string = `${DOLLAR}{`

const routeOf = (route: string, isDynamic: boolean = false): DeclaredRoute => ({
  file: `src/app${route === '/' ? '' : route}/page.tsx`,
  route,
  isDynamic,
})

const SCANNING_SPEC: SpecSource = {
  path: 'tests/e2e/pages.e2e.spec.ts',
  source: "await page.goto('/profile')\nconst scan = await new AxeBuilder({ page }).analyze()",
}

const sweepOf = (sweep: Partial<RouteSweep>): RouteSweep => ({
  declaredRoutes: [],
  visitedRoutes: [],
  answeredRoutes: [],
  skippedPrefixes: ['/admin', '/api'],
  specs: [],
  everyFile: [],
  ...sweep,
})

const rulesOf = (sweep: Partial<RouteSweep>): readonly string[] =>
  findUnsweptRoutes(sweepOf(sweep)).map((unswept: UnsweptRoute): string => unswept.rule)

const routesOf = (sweep: Partial<RouteSweep>): readonly string[] =>
  findUnsweptRoutes(sweepOf(sweep)).map((unswept: UnsweptRoute): string => unswept.route)

describe('a page the crawl reached', () => {
  it('is covered by the sweep itself', () => {
    expect(rulesOf({ declaredRoutes: [routeOf('/about')], visitedRoutes: ['/about'] })).toEqual([])
  })

  it('is covered whichever way the trailing slash was written', () => {
    expect(rulesOf({ declaredRoutes: [routeOf('/about')], visitedRoutes: ['/about/'] })).toEqual([])
  })

  it('says nothing about a project that declares no routes', () => {
    expect(rulesOf({ visitedRoutes: ['/'] })).toEqual([])
  })
})

describe('a page the crawl never reached', () => {
  it('is reported when nothing drives it', () => {
    expect(rulesOf({ declaredRoutes: [routeOf('/welcome')], visitedRoutes: ['/'] })).toEqual([
      'route-unswept',
    ])
  })

  it('names the address, so the report says which page to answer for', () => {
    expect(routesOf({ declaredRoutes: [routeOf('/welcome')], visitedRoutes: ['/'] })).toEqual([
      '/welcome',
    ])
  })

  it('is covered by a specification that drives it and scans it', () => {
    expect(
      rulesOf({
        declaredRoutes: [routeOf('/profile')],
        visitedRoutes: ['/'],
        specs: [SCANNING_SPEC],
        everyFile: [SCANNING_SPEC],
      }),
    ).toEqual([])
  })

  // The sharper of the two verdicts, and the one worth telling apart: a page somebody thought about
  // and left unverified is a different mistake from a page nobody thought about.
  it('is reported differently when a specification drives it but scans nothing', () => {
    const driving: SpecSource = {
      path: 'tests/e2e/pages.e2e.spec.ts',
      source: "await page.goto('/profile')",
    }
    expect(
      rulesOf({
        declaredRoutes: [routeOf('/profile')],
        visitedRoutes: ['/'],
        specs: [driving],
        everyFile: [driving],
      }),
    ).toEqual(['route-unscanned'])
  })

  it('names all three ways to answer, so the report is actionable', () => {
    const found: readonly UnsweptRoute[] = findUnsweptRoutes(
      sweepOf({ declaredRoutes: [routeOf('/welcome')], visitedRoutes: ['/'] }),
    )
    const reason: string = found[0]?.reason ?? ''
    expect(reason).toContain('link it')
    expect(reason).toContain('axe')
    expect(reason).toContain('accessibilitySkipRoutes')
  })
})

describe('a page the project declared out of scope', () => {
  // Payload puts the admin panel behind a page file of its own, and the crawl is told to skip that
  // prefix. Reporting it would be the harness disagreeing with itself.
  it('is not reported when its address sits under a skipped prefix', () => {
    expect(
      rulesOf({ declaredRoutes: [routeOf('/admin/[[...segments]]', true)], visitedRoutes: ['/'] }),
    ).toEqual([])
  })

  it('is not reported when the project declared the prefix itself', () => {
    expect(
      rulesOf({
        declaredRoutes: [routeOf('/preview')],
        visitedRoutes: ['/'],
        skippedPrefixes: ['/admin', '/api', '/preview'],
      }),
    ).toEqual([])
  })
})

describe('a page that only forwards somewhere else', () => {
  // It answered, and the crawl did not keep it: it landed outside the public surface. There is nothing
  // at that address for axe to judge, and whatever it forwarded to has a declaration of its own.
  it('is not reported, because there is nothing there to scan', () => {
    expect(
      rulesOf({
        declaredRoutes: [routeOf('/dashboard')],
        visitedRoutes: ['/'],
        answeredRoutes: ['/', '/dashboard'],
      }),
    ).toEqual([])
  })

  it('is still reported when it never answered at all', () => {
    expect(
      rulesOf({
        declaredRoutes: [routeOf('/dashboard')],
        visitedRoutes: ['/'],
        answeredRoutes: ['/'],
      }),
    ).toEqual(['route-unswept'])
  })
})

describe('a dynamic page', () => {
  // The case that decides whether a content site is covered at all: the crawl reaching one post has
  // scanned the file behind every post.
  it('is covered when the crawl scanned an address it produces', () => {
    expect(
      rulesOf({
        declaredRoutes: [routeOf('/posts/[slug]', true)],
        visitedRoutes: ['/', '/posts/hello'],
      }),
    ).toEqual([])
  })

  it('is reported when the crawl only reached its parent', () => {
    expect(
      rulesOf({ declaredRoutes: [routeOf('/play/[id]', true)], visitedRoutes: ['/', '/play'] }),
    ).toEqual(['route-unswept'])
  })

  it('is covered by a specification that builds an address beneath it and scans', () => {
    const building: SpecSource = {
      path: 'tests/e2e/game.e2e.spec.ts',
      source: `await page.goto(\`/play/${HOLE}String(gameId)}\`)\nnew AxeBuilder({ page })`,
    }
    expect(
      rulesOf({
        declaredRoutes: [routeOf('/play/[id]', true)],
        visitedRoutes: ['/', '/play'],
        specs: [building],
        everyFile: [building],
      }),
    ).toEqual([])
  })

  // The false pass this rule cannot be allowed to have. Visiting the parent of a family scans none of
  // its members, so a specification that only visits `/play` must not answer for `/play/[id]`.
  it('is not covered by a specification that only visits its parent', () => {
    const parentOnly: SpecSource = {
      path: 'tests/e2e/game.e2e.spec.ts',
      source: "await page.goto('/play')\nnew AxeBuilder({ page })",
    }
    expect(
      rulesOf({
        declaredRoutes: [routeOf('/play/[id]', true)],
        visitedRoutes: ['/', '/play'],
        specs: [parentOnly],
        everyFile: [parentOnly],
      }),
    ).toEqual(['route-unswept'])
  })
})

describe('every declared page is judged on its own', () => {
  it('reports the uncovered one and leaves the covered one alone', () => {
    expect(
      routesOf({
        declaredRoutes: [routeOf('/'), routeOf('/welcome'), routeOf('/leaderboard')],
        visitedRoutes: ['/', '/leaderboard'],
      }),
    ).toEqual(['/welcome'])
  })
})
