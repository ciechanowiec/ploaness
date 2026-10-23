// What the sweep reads from the running application to decide what to scan: the routes a sitemap
// lists, the locales a page links as alternates, the stories a Storybook serves, and the template each
// route renders. Nothing here is declared by the project; each value is derived from what it serves.
import { type DeclaredRoute, resolvedRouteOf } from './route-map.js'

const LOC: RegExp = /<loc>([^<]+)<\/loc>/giu

const XML_ENTITIES: Readonly<Record<string, string>> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
}

const decodeXml = (text: string): string =>
  text.replaceAll(/&(?:amp|lt|gt|quot|apos);/gu, (entity: string): string => XML_ENTITIES[entity] ?? entity)

/** What one sitemap document lists. */
export interface SitemapEntries {
  /** Page URLs, from a `<urlset>`. */
  readonly pages: readonly string[]
  /** Nested sitemap URLs, from a `<sitemapindex>`. */
  readonly sitemaps: readonly string[]
}

/**
 * The URLs a sitemap document lists, split into pages and nested sitemaps.
 * @param xml the document.
 * @returns the page and sitemap URLs, each once, in document order.
 */
export const sitemapEntries = (xml: string): SitemapEntries => {
  const locations: readonly string[] = [
    ...new Set<string>(
      [...xml.matchAll(LOC)].map((match: RegExpExecArray): string => decodeXml((match[1] ?? '').trim())),
    ),
  ]
  return /<sitemapindex[\s>]/u.test(xml) ? { pages: [], sitemaps: locations } : { pages: locations, sitemaps: [] }
}

/** A `<link rel="alternate" hreflang>` as the page carries it. */
export interface AlternateLink {
  readonly hreflang: string
  readonly href: string
}

/**
 * The alternate-locale hrefs of a page, `x-default` included.
 * @param links the page's alternate links.
 * @returns each href that carries a language, once.
 */
export const alternateHrefs = (links: readonly AlternateLink[]): readonly string[] => [
  ...new Set<string>(
    links
      .filter((link: AlternateLink): boolean => link.hreflang.trim().length > 0 && link.href.trim().length > 0)
      .map((link: AlternateLink): string => link.href.trim()),
  ),
]

/** One story a Storybook serves. */
export interface DiscoveredStory {
  readonly id: string
  readonly title: string
  readonly name: string
  /** The origin of the Storybook that serves it. */
  readonly server: string
}

const asRecord = (value: unknown): Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : {}

const asText = (value: unknown): string => (typeof value === 'string' ? value : '')

/**
 * The stories a Storybook `index.json` lists, docs entries left out.
 * @param index the parsed document.
 * @param server the origin it was read from.
 * @returns one entry per story, or undefined when the document is not a Storybook index.
 */
export const storiesOfIndex = (index: unknown, server: string): readonly DiscoveredStory[] | undefined => {
  const entries: unknown = asRecord(index)['entries']
  if (typeof entries !== 'object' || entries === null) {
    return undefined
  }
  return Object.values(asRecord(entries))
    .map((entry: unknown): Readonly<Record<string, unknown>> => asRecord(entry))
    .filter(
      (entry: Readonly<Record<string, unknown>>): boolean => entry['type'] === 'story' && asText(entry['id']) !== '',
    )
    .map(
      (entry: Readonly<Record<string, unknown>>): DiscoveredStory => ({
        id: asText(entry['id']),
        title: asText(entry['title']),
        name: asText(entry['name']),
        server,
      }),
    )
}

/** The location a story is reported under. */
export const storyLocation = (story: Pick<DiscoveredStory, 'id'>): string => `story:${story.id}`

/**
 * The address that renders one story alone.
 * @param story the story.
 * @returns its isolated preview URL.
 */
export const storyUrl = (story: Pick<DiscoveredStory, 'id' | 'server'>): string =>
  `${story.server}/iframe.html?id=${encodeURIComponent(story.id)}&viewMode=story`

/**
 * The render phases at which a story has stopped: rendered, played, and its `afterEach` run, or failed.
 * Storybook exposes the phase as `__STORYBOOK_PREVIEW__.currentRender.phase`.
 */
export const SETTLED_STORY_PHASES: readonly string[] = ['finished', 'errored', 'aborted']

/** A route chosen to stand for every route of its template. */
export interface TemplateSample {
  /** The declared route pattern, or the route itself when no declaration admits it. */
  readonly template: string
  readonly route: string
  /** How many crawled routes the template has. */
  readonly routes: number
}

/**
 * One route per template, the first one crawled, for the passes that sample instead of covering all.
 * @param routes the crawled routes, in crawl order.
 * @param declared the routes the file tree declares.
 * @returns one sample per template, in the order its first route was crawled.
 */
export const templateSamples = (
  routes: readonly string[],
  declared: readonly DeclaredRoute[],
): readonly TemplateSample[] => {
  const templateOf = (route: string): string => resolvedRouteOf(declared, route)?.route ?? route
  const templates: readonly string[] = [...new Set<string>(routes.map((route: string): string => templateOf(route)))]
  return templates.map((template: string): TemplateSample => {
    const members: readonly string[] = routes.filter((route: string): boolean => templateOf(route) === template)
    return { template, route: members[0] ?? template, routes: members.length }
  })
}

/**
 * A sitemap location on the application under test.
 *
 * A sitemap lists the application's own pages under its canonical public host, which a verification
 * run does not serve. Its path is what names the page, so the path is read on the run's origin.
 * @param location a `<loc>` value.
 * @param origin the origin the application answers at.
 * @returns the same path and query on that origin, or undefined when the value is not a URL.
 */
export const onOrigin = (location: string, origin: string): string | undefined => {
  try {
    const url: URL = new URL(location, origin)
    return `${origin}${url.pathname}${url.search}`
  } catch {
    return undefined
  }
}
