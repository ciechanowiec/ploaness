// Which files of a Next.js application declare a page, and what address each one answers at.
//
// The accessibility sweep discovers routes by following links from the home page. To say what it
// MISSED, something has to say what exists, and the only statement of that a project always carries is
// its own file tree: `app/.../page.tsx` is the one declaration Next.js reads.
//
// This is string work over relative paths that were already listed, which is why it is here rather
// than beside the walker that lists them. The mapping is the error-prone half - route groups, parallel
// slots, intercepting routes, three kinds of dynamic segment - and a rule kept out of this package is
// a rule kept out of the coverage measurement.
//
// What it deliberately does NOT do is read `next.config`. `basePath`, `trailingSlash`, `rewrites`,
// `redirects` and a custom `pageExtensions` all change the address a file answers at, and the config
// cannot be evaluated without importing the application. A project that uses one of those tells the
// sweep so through `accessibilitySkipRoutes`; the limitation is stated in the guide rather than
// guessed at here.

/** A page a project's file tree declares, and the address it answers at. */
export interface DeclaredRoute {
  /** The file declaring it, relative to the member root. */
  readonly file: string
  /** The address, with dynamic segments left in their file-tree spelling. */
  readonly route: string
  /** Whether that address carries a dynamic segment, and so names a family rather than one page. */
  readonly isDynamic: boolean
}

// Next.js reads a page from any of these; `pageExtensions` can add more, which is one of the reasons
// the module comment above declines to guess at a configured project.
const PAGE_FILES: ReadonlySet<string> = new Set<string>([
  'page.tsx',
  'page.ts',
  'page.jsx',
  'page.js',
  'page.mdx',
])

// A root layout is required of a Next.js application and of nothing else, so it is what tells an app
// directory apart from a directory that happens to be called `app`.
const ROOT_LAYOUTS: ReadonlySet<string> = new Set<string>([
  'layout.tsx',
  'layout.ts',
  'layout.jsx',
  'layout.js',
])

// `src/app` first, because that is where a Payload application puts it and where a stray top-level
// `app/` is least likely to be mistaken for one.
const APP_ROOTS: readonly string[] = ['src/app', 'app']

const ROOT_ROUTE: string = '/'

const SEGMENT_SEPARATOR: string = '/'

// Whether a path is the ROOT layout of a candidate app directory. Next.js requires one, and allows it
// to sit inside route groups rather than at the top: a Payload application has no `src/app/layout.tsx`
// at all, because `(frontend)` and `(payload)` each carry their own. Requiring the top-level file
// found no app directory in the commonest project this harness governs, and the check then passed by
// doing nothing - which is the one way a rule like this fails that nobody notices.
const isRootLayout = (path: string, root: string): boolean => {
  const prefix: string = `${root}${SEGMENT_SEPARATOR}`
  if (!path.startsWith(prefix)) {
    return false
  }
  const segments: readonly string[] = path.slice(prefix.length).split(SEGMENT_SEPARATOR)
  const addressed: readonly string[] = segments.filter(
    (segment: string): boolean => !isRouteGroup(segment),
  )
  return addressed.length === 1 && ROOT_LAYOUTS.has(addressed[0] ?? '')
}

/**
 * Which directory holds the application's routes.
 *
 * Chosen from the conventional two rather than searched for, and confirmed by the root layout Next.js
 * requires, so a library with a `src/app` module of its own is not mistaken for an application.
 * @param paths every file of the member, relative to its root, separated by forward slashes.
 * @returns the app directory, or nothing when the member declares no routes.
 */
export const appRootOf = (paths: readonly string[]): string | undefined =>
  APP_ROOTS.find((root: string): boolean =>
    paths.some((path: string): boolean => isRootLayout(path, root)),
  )

// A segment wholly inside parentheses is a route group: it organises the tree and contributes nothing
// to the address. `(.)photo` is not one - it is an intercepting route, and it opens with a parenthesis
// without closing on one, which is exactly what tells the two apart.
const isRouteGroup = (segment: string): boolean => segment.startsWith('(') && segment.endsWith(')')

// `(.)`, `(..)`, `(...)` and `(..)(..)`, each followed by the segment being intercepted. A file behind
// one of these declares no independently reachable address: on a hard navigation the INTERCEPTED route
// renders instead, and that route has a declaration of its own. So the file is skipped rather than
// mapped to an address no server serves.
const isIntercepting = (segment: string): boolean =>
  segment.startsWith('(') && !segment.endsWith(')')

// A slot of a parallel route. Its own `page` file is the slot's default content, rendered by the
// parent's layout rather than at an address of its own, so the segment is dropped and the address that
// results is the parent's - which the parent already declares, and which the dedup below collapses.
const isParallelSlot = (segment: string): boolean => segment.startsWith('@')

// Next.js serves nothing from a folder whose name opens with an underscore.
const isPrivate = (segment: string): boolean => segment.startsWith('_')

const isDynamicSegment = (segment: string): boolean =>
  segment.startsWith('[') && segment.endsWith(']')

/**
 * Strip a trailing slash, so an address written with one and an address written without are one.
 *
 * The crawl records whatever `URL.pathname` gave it and a link may be written either way, while a file
 * tree never produces a trailing slash at all. Comparing the two without this reports every page of a
 * project that sets `trailingSlash`.
 * @param route the address to normalise.
 * @returns the address without its trailing slash, and the root route unchanged.
 */
export const normalisedRoute = (route: string): string =>
  route.length > 1 && route.endsWith(SEGMENT_SEPARATOR) ? route.slice(0, -1) : route

/**
 * The address one file answers at, if it declares a page at all.
 * @param file the file, relative to the app directory.
 * @returns the declared route, or nothing when the file declares no independently reachable address.
 */
export const declaredRouteOf = (file: string): DeclaredRoute | undefined => {
  const parts: readonly string[] = file.split(SEGMENT_SEPARATOR)
  if (!PAGE_FILES.has(parts.at(-1) ?? '')) {
    return undefined
  }
  const directories: readonly string[] = parts.slice(0, -1)
  if (
    directories.some((segment: string): boolean => isPrivate(segment) || isIntercepting(segment))
  ) {
    return undefined
  }
  const addressed: readonly string[] = directories.filter(
    (segment: string): boolean => !(isRouteGroup(segment) || isParallelSlot(segment)),
  )
  return {
    file,
    route:
      addressed.length === 0
        ? ROOT_ROUTE
        : `${SEGMENT_SEPARATOR}${addressed.join(SEGMENT_SEPARATOR)}`,
    isDynamic: addressed.some((segment: string): boolean => isDynamicSegment(segment)),
  }
}

/**
 * Every address a member's file tree declares.
 *
 * Deduplicated by address, because a parallel route's slot and the page beside it reduce to the same
 * one and reporting it twice would ask a project to answer for the same page under two file names.
 * @param paths every file of the member, relative to its root, separated by forward slashes.
 * @param appRoot the app directory, as `appRootOf` chose it.
 * @returns one entry per declared address, in the order the paths were given.
 */
export const declaredRoutesOf = (
  paths: readonly string[],
  appRoot: string,
): readonly DeclaredRoute[] => {
  const prefix: string = `${appRoot}${SEGMENT_SEPARATOR}`
  const declared: readonly DeclaredRoute[] = paths.flatMap((file: string): DeclaredRoute[] => {
    if (!file.startsWith(prefix)) {
      return []
    }
    const found: DeclaredRoute | undefined = declaredRouteOf(file.slice(prefix.length))
    return found === undefined ? [] : [{ ...found, file }]
  })
  return declared.filter(
    (route: DeclaredRoute, index: number): boolean =>
      declared.findIndex((other: DeclaredRoute): boolean => other.route === route.route) === index,
  )
}

/**
 * The part of an address before its first dynamic segment.
 *
 * What a specification can be searched for when the address itself cannot be: a spec never contains
 * `/posts/[slug]`, it contains `/posts/` and then a value.
 * @param route the declared address.
 * @returns the leading static part, which is the root route when the first segment is dynamic.
 */
export const staticPrefixOf = (route: string): string => {
  const segments: readonly string[] = route.split(SEGMENT_SEPARATOR).slice(1)
  const upTo: number = segments.findIndex((segment: string): boolean => isDynamicSegment(segment))
  const kept: readonly string[] = upTo === -1 ? segments : segments.slice(0, upTo)
  return kept.length === 0 ? ROOT_ROUTE : `${SEGMENT_SEPARATOR}${kept.join(SEGMENT_SEPARATOR)}`
}

// An address as the segments it is made of, with the leading slash and any trailing one gone. The root
// route is no segments at all, which is what lets an optional catch-all match it.
const segmentsOf = (route: string): readonly string[] =>
  normalisedRoute(route)
    .split(SEGMENT_SEPARATOR)
    .filter((segment: string): boolean => segment !== '')

const isCatchAll = (segment: string): boolean => segment.startsWith('[...') && segment.endsWith(']')

const isOptionalCatchAll = (segment: string): boolean =>
  segment.startsWith('[[...') && segment.endsWith(']]')

// Segment by segment, because a catch-all is the only one whose width is not one and Next.js allows it
// only in the last position. Written as a recursion rather than a regular expression: the address a
// project declares is attacker-adjacent text in no sense, but a pattern built by concatenation is one
// nobody can read afterwards, and the whole point of this module is that its edge cases are legible.
const matchesSegments = (pattern: readonly string[], actual: readonly string[]): boolean => {
  const [head, ...rest] = pattern
  if (head === undefined) {
    return actual.length === 0
  }
  if (isOptionalCatchAll(head)) {
    return true
  }
  if (isCatchAll(head)) {
    return actual.length > 0
  }
  if (isDynamicSegment(head)) {
    return actual.length > 0 && matchesSegments(rest, actual.slice(1))
  }
  return actual[0] === head && matchesSegments(rest, actual.slice(1))
}

/**
 * Whether one visited address is a page the declared route produces.
 *
 * A static route matches itself. A dynamic one matches any address its segments admit, which is what
 * lets the crawl answer for it: if the sweep scanned `/posts/hello`, the file behind `/posts/[slug]`
 * has been scanned, whatever else it can also serve.
 * @param route the declared address, dynamic segments in their file-tree spelling.
 * @param visited an address the crawl reached.
 * @returns true when scanning that address scanned this route.
 */
export const matchesRoute = (route: string, visited: string): boolean =>
  matchesSegments(segmentsOf(route), segmentsOf(visited))
