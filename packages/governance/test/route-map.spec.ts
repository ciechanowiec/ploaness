import { describe, expect, it } from 'vitest'
import {
  appRootOf,
  type DeclaredRoute,
  declaredRouteOf,
  declaredRoutesOf,
  matchesRoute,
  normalisedRoute,
  staticPrefixOf,
} from '../src/route-map.js'

// What a Next.js file tree says about the addresses an application serves.
//
// Every case below is a folder convention that changes the address, or removes it: a route group, a
// parallel slot, an intercepting route, three kinds of dynamic segment. Each is ordinary in a real
// project, and each one read wrongly produces an address no server serves - which would be reported
// forever as a page nothing scans, with no way for the project to answer.

const routeOf = (file: string): string | undefined => declaredRouteOf(file)?.route

const routesIn = (paths: readonly string[], appRoot: string): readonly string[] =>
  declaredRoutesOf(paths, appRoot).map((route: DeclaredRoute): string => route.route)

describe('which directory holds the routes', () => {
  it('prefers src/app, where a Payload application puts it', () => {
    expect(appRootOf(['src/app/layout.tsx', 'src/app/page.tsx'])).toBe('src/app')
  })

  it('accepts a bare app directory', () => {
    expect(appRootOf(['app/layout.tsx', 'app/page.tsx'])).toBe('app')
  })

  // The layout of a Payload application. Every one of its layouts sits inside a route group, so there
  // is no `src/app/layout.tsx` at all - and requiring one found no app directory in the commonest
  // project this harness governs, leaving the whole check passing by doing nothing.
  it('accepts a root layout that sits inside route groups', () => {
    const paths: readonly string[] = [
      'src/app/(frontend)/layout.tsx',
      'src/app/(frontend)/page.tsx',
      'src/app/(payload)/layout.tsx',
    ]
    expect(appRootOf(paths)).toBe('src/app')
  })

  // A root layout is required of an application and of nothing else, so it is what tells an app
  // directory apart from a library module that happens to be called `app`.
  it('refuses a directory carrying no root layout', () => {
    expect(appRootOf(['src/app/helpers.ts', 'src/app/nested/layout.tsx'])).toBeUndefined()
  })

  it('does not read a layout further down the tree as the root one', () => {
    expect(appRootOf(['src/app/(frontend)/dashboard/layout.tsx'])).toBeUndefined()
  })

  it('says nothing about a package that declares no routes at all', () => {
    expect(appRootOf(['src/index.ts'])).toBeUndefined()
  })
})

describe('the address one file answers at', () => {
  it('reads the root page', () => {
    expect(routeOf('page.tsx')).toBe('/')
  })

  it('reads a nested page', () => {
    expect(routeOf('leaderboard/page.tsx')).toBe('/leaderboard')
  })

  it('drops a route group, which organises the tree and names no address', () => {
    expect(routeOf('(frontend)/profile/page.tsx')).toBe('/profile')
  })

  it('reads a page whose every ancestor is a route group as the root', () => {
    expect(routeOf('(frontend)/page.tsx')).toBe('/')
  })

  it('keeps a dynamic segment in its file-tree spelling, and says it is dynamic', () => {
    expect(declaredRouteOf('play/[id]/page.tsx')).toEqual({
      file: 'play/[id]/page.tsx',
      route: '/play/[id]',
      isDynamic: true,
    })
  })

  it('accepts every extension Next.js reads a page from', () => {
    expect(routeOf('about/page.mdx')).toBe('/about')
    expect(routeOf('about/page.js')).toBe('/about')
  })

  it('is not a route file when it is a request handler', () => {
    expect(routeOf('api/games/route.ts')).toBeUndefined()
  })

  it('is not a route file when it is a layout or a component beside one', () => {
    expect(routeOf('leaderboard/layout.tsx')).toBeUndefined()
    expect(routeOf('leaderboard/Table.tsx')).toBeUndefined()
  })

  it('serves nothing from a folder Next.js treats as private', () => {
    expect(routeOf('_components/page.tsx')).toBeUndefined()
  })

  // An intercepting route renders in place of another one during a soft navigation. On a hard
  // navigation the INTERCEPTED route renders, and that route has a declaration of its own, so this
  // file names no address a crawl could ever reach.
  it('declares no address of its own when it intercepts another', () => {
    expect(routeOf('feed/(.)photo/page.tsx')).toBeUndefined()
    expect(routeOf('feed/(..)photo/page.tsx')).toBeUndefined()
    expect(routeOf('feed/(...)photo/page.tsx')).toBeUndefined()
    expect(routeOf('feed/(..)(..)photo/page.tsx')).toBeUndefined()
  })

  it('drops a parallel slot, whose page is the slot default rather than an address', () => {
    expect(routeOf('@modal/page.tsx')).toBe('/')
  })
})

describe('every address a file tree declares', () => {
  it('reads only the files beneath the app directory', () => {
    const paths: readonly string[] = [
      'src/app/page.tsx',
      'src/app/leaderboard/page.tsx',
      'src/lib/page.tsx',
      'tests/e2e/page.tsx',
    ]
    expect(routesIn(paths, 'src/app')).toEqual(['/', '/leaderboard'])
  })

  // A slot and the page beside it reduce to the same address, and reporting it twice would ask a
  // project to answer for one page under two file names.
  it('reports one address once, however many files reduce to it', () => {
    const paths: readonly string[] = ['src/app/page.tsx', 'src/app/@modal/page.tsx']
    expect(routesIn(paths, 'src/app')).toEqual(['/'])
  })

  it('carries the whole path of the file that declared it', () => {
    const declared: readonly DeclaredRoute[] = declaredRoutesOf(
      ['src/app/(frontend)/welcome/page.tsx'],
      'src/app',
    )
    expect(declared[0]?.file).toBe('src/app/(frontend)/welcome/page.tsx')
  })

  it('says nothing about a tree with no pages in it', () => {
    expect(routesIn(['src/app/layout.tsx'], 'src/app')).toEqual([])
  })
})

describe('the static part of an address', () => {
  it('is the whole of a static address', () => {
    expect(staticPrefixOf('/leaderboard')).toBe('/leaderboard')
  })

  it('stops at the first dynamic segment', () => {
    expect(staticPrefixOf('/play/[id]')).toBe('/play')
    expect(staticPrefixOf('/posts/[slug]/comments')).toBe('/posts')
  })

  it('is the root when the first segment is already dynamic', () => {
    expect(staticPrefixOf('/[[...slug]]')).toBe('/')
  })
})

describe('normalising an address', () => {
  it('drops a trailing slash', () => {
    expect(normalisedRoute('/about/')).toBe('/about')
  })

  it('leaves the root alone, which is nothing but its slash', () => {
    expect(normalisedRoute('/')).toBe('/')
  })
})

describe('whether a visited address is a page a route produces', () => {
  it('matches a static address against itself', () => {
    expect(matchesRoute('/leaderboard', '/leaderboard')).toBe(true)
    expect(matchesRoute('/leaderboard', '/profile')).toBe(false)
  })

  it('ignores a trailing slash on either side', () => {
    expect(matchesRoute('/about', '/about/')).toBe(true)
  })

  it('matches one segment against a dynamic segment', () => {
    expect(matchesRoute('/play/[id]', '/play/7')).toBe(true)
  })

  // The parent of a family is not a member of it: nothing about visiting `/play` scans the page
  // `/play/[id]` produces.
  it('does not let the parent of a dynamic route answer for it', () => {
    expect(matchesRoute('/play/[id]', '/play')).toBe(false)
  })

  it('does not let a deeper address answer for a single dynamic segment', () => {
    expect(matchesRoute('/play/[id]', '/play/7/moves')).toBe(false)
  })

  it('matches one or more segments against a catch-all', () => {
    expect(matchesRoute('/docs/[...path]', '/docs/a')).toBe(true)
    expect(matchesRoute('/docs/[...path]', '/docs/a/b/c')).toBe(true)
    expect(matchesRoute('/docs/[...path]', '/docs')).toBe(false)
  })

  // The pattern a content site is built on, and the reason a dynamic route must be checked rather than
  // excused: scanning the home page of such a site has scanned a page this file produces.
  it('matches the root itself against an optional catch-all', () => {
    expect(matchesRoute('/[[...slug]]', '/')).toBe(true)
    expect(matchesRoute('/[[...slug]]', '/posts/hello')).toBe(true)
  })

  it('holds the static part of a mixed address to itself', () => {
    expect(matchesRoute('/posts/[slug]', '/pages/hello')).toBe(false)
  })
})
