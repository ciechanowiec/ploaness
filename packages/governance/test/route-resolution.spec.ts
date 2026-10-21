import { describe, expect, it } from 'vitest'
import { type DeclaredRoute, resolvedRouteOf } from '../src/route-map.js'

const declaration = (route: string): DeclaredRoute => ({
  file: `src/app${route}/page.tsx`,
  route,
  isDynamic: route.includes('['),
})

describe('Next route specificity', () => {
  it.each([
    { patterns: ['/posts/[slug]', '/posts/new'], visited: '/posts/new/', selected: '/posts/new' },
    { patterns: ['/posts/[slug]', '/posts/new'], visited: '/posts/article', selected: '/posts/[slug]' },
    { patterns: ['/posts/[...parts]', '/posts/[slug]'], visited: '/posts/article', selected: '/posts/[slug]' },
    { patterns: ['/posts/[slug]', '/posts/[...parts]'], visited: '/posts/one/two', selected: '/posts/[...parts]' },
    { patterns: ['/docs/[[...parts]]', '/docs/help'], visited: '/docs/help', selected: '/docs/help' },
    { patterns: ['/docs/help', '/docs/[[...parts]]'], visited: '/docs/', selected: '/docs/[[...parts]]' },
    { patterns: ['/a/[slug]', '/[section]/b'], visited: '/a/b', selected: '/a/[slug]' },
    { patterns: ['/a/[slug]/c', '/a/b/[slug]'], visited: '/a/b/c', selected: '/a/b/[slug]' },
  ])('selects $selected at $visited independently of declaration order', ({ patterns, visited, selected }) => {
    const routes: readonly DeclaredRoute[] = patterns.map((route: string): DeclaredRoute => declaration(route))
    expect(resolvedRouteOf(routes, visited)?.route).toBe(selected)
    expect(resolvedRouteOf(routes.toReversed(), visited)?.route).toBe(selected)
  })

  // Declarations can be read before Next rejects an ambiguous exact/optional pair.
  it('prefers an exact endpoint when an optional tail admits it too', () => {
    expect(resolvedRouteOf([declaration('/[[...parts]]'), declaration('/')], '/')?.route).toBe('/')
  })

  it('returns no declaration for an unmatched URL', () => {
    expect(resolvedRouteOf([declaration('/about')], '/elsewhere')).toBeUndefined()
  })

  it('returns no declaration for an empty route set', () => {
    expect(resolvedRouteOf([], '/')).toBeUndefined()
  })

  it('retains the first declaration when patterns are identical', () => {
    const first: DeclaredRoute = declaration('/posts/new')
    expect(resolvedRouteOf([first, { ...first, file: 'another/page.tsx' }], '/posts/new')).toBe(first)
  })
})
