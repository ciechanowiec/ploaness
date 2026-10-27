// The sweep's discovery pass: what the later passes scan, read from the running application.
import { type APIResponse, expect, type Page, type Response, test } from '@playwright/test'
import {
  type AlternateLink,
  alternateHrefs,
  BROKEN_LINK_RULE,
  type BrowserFinding,
  breakpointEdges,
  type DeclaredRoute,
  type DiscoveredStory,
  findingAt,
  isSweepScope,
  localAddress,
  onOrigin,
  routeReason,
  type SitemapEntries,
  SWEEP_SCOPE_ENVIRONMENT_VARIABLE,
  type SweepScope,
  scopeHeadline,
  securityHeaderProblems,
  sitemapEntries,
  storiesOfIndex,
  storyFileOf,
  storyLocation,
  storyReason,
  storyUrl,
  templateSamples,
} from '@ploaness/governance'
import { declaredRoutes, isSkippedSweepRoute, MAX_SWEEP_ROUTES } from './a11y.js'
import { projectSettings } from './project-settings.js'
import { clearCompletedScans } from './scan-evidence.js'
import { engineOf } from './scanner.js'
import { settleForScan } from './settle.js'
import { discoverNotFound, type NotFoundDiscovery } from './sweep-not-found.js'
import {
  armBudget,
  type Budget,
  CONTROLS,
  type CssRule,
  DESKTOP,
  type Discovery,
  type DiscoveryReport,
  type DomDocument,
  type DomElement,
  discoveryFile,
  discoveryReportFile,
  loadLocation,
  origin,
  placeAt,
  preparePage,
  readJson,
  type ScopeRecord,
  type SweepLocation,
  WHOLE_PASS,
  writeJson,
} from './sweep-shared.js'

// The browser surface the page functions below touch, declared for the reason `settle.ts` records.
declare const document: DomDocument

const SEED_ROUTE: string = '/'

const STATIC_ASSET: RegExp = /\.[a-z\d]+$/iu

const parseUrl = (href: string): URL | undefined => {
  try {
    return new URL(href, origin)
  } catch {
    return undefined
  }
}

const toRoute = (href: string): string | undefined => {
  const url: URL | undefined = parseUrl(href)
  if (url?.origin !== origin) {
    return undefined
  }
  return isSkippedSweepRoute(url.pathname) || STATIC_ASSET.test(url.pathname) ? undefined : url.pathname
}

interface PageFacts {
  /** The width conditions of the media rules that style an element of this page. */
  readonly mediaTexts: readonly string[]
  /** The page's `<link rel="canonical">` href, or empty. */
  readonly canonical: string
  readonly hasDarkMedia: boolean
  readonly controls: number
  readonly hrefs: readonly string[]
  readonly alternates: readonly AlternateLink[]
}

// Read through the CSSOM, so a breakpoint in any stylesheet the page loaded counts, nested at-rules
// included. A stylesheet from another origin cannot be read and has already been blocked anyway.
const pageFactsInPage = (controls: string): PageFacts => {
  const rulesOf = (sheet: { readonly cssRules?: ArrayLike<CssRule> }): readonly CssRule[] => {
    try {
      return Array.from(sheet.cssRules ?? []).flatMap((rule: CssRule): readonly CssRule[] => [rule, ...rulesOf(rule)])
    } catch {
      return []
    }
  }
  const rules: readonly CssRule[] = Array.from(document.styleSheets).flatMap(
    (sheet: { readonly cssRules?: ArrayLike<CssRule> }): readonly CssRule[] => rulesOf(sheet),
  )
  // A media rule moves this page only when a rule inside it styles an element here. A stylesheet
  // shipping every breakpoint of a utility framework would otherwise add edges no element responds
  // to. State and pseudo-element parts are removed before matching, which can only widen the match.
  const isStyling = (rule: CssRule): boolean => {
    const selector: string = (rule.selectorText ?? '').replaceAll(/(?<!\\)::?[a-z-]+(?:\([^)]*\))?/giu, '').trim()
    if (rule.selectorText === undefined) {
      return false
    }
    try {
      return document.querySelector(selector === '' ? '*' : selector) !== null
    } catch {
      return true
    }
  }
  const mediaRules: readonly CssRule[] = rules.filter((rule: CssRule): boolean => rule.media !== undefined)
  const mediaTexts: readonly string[] = mediaRules
    .filter((rule: CssRule): boolean => rulesOf(rule).some((inner: CssRule): boolean => isStyling(inner)))
    .flatMap((rule: CssRule): readonly string[] => [rule.media?.mediaText ?? ''])
  return {
    mediaTexts: [...new Set<string>(mediaTexts)],
    canonical: document.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? '',
    hasDarkMedia: mediaRules.some((rule: CssRule): boolean =>
      (rule.media?.mediaText ?? '').includes('prefers-color-scheme'),
    ),
    controls: document.querySelectorAll(controls).length,
    hrefs: Array.from(
      document.querySelectorAll('a[href]'),
      (anchor: DomElement): string => anchor.getAttribute('href') ?? '',
    ),
    alternates: Array.from(
      document.querySelectorAll('link[rel="alternate"][hreflang]'),
      (link: DomElement): AlternateLink => ({
        hreflang: link.getAttribute('hreflang') ?? '',
        href: link.getAttribute('href') ?? '',
      }),
    ),
  }
}

interface Queued {
  readonly route: string
  /** The page or sitemap that linked it, for a broken link's report. */
  readonly from: string
}

interface CrawlState {
  readonly queue: readonly Queued[]
  readonly seen: ReadonlySet<string>
  readonly dropped: ReadonlySet<string>
  readonly answered: ReadonlySet<string>
  readonly reachable: readonly SweepLocation[]
  readonly findings: readonly BrowserFinding[]
}

const enqueue = (state: CrawlState, hrefs: readonly string[], from: string): CrawlState =>
  hrefs.reduce((current: CrawlState, href: string): CrawlState => {
    const route: string | undefined = toRoute(href)
    if (route === undefined || current.seen.has(route) || current.dropped.has(route)) {
      return current
    }
    return current.seen.size >= MAX_SWEEP_ROUTES
      ? { ...current, dropped: new Set<string>([...current.dropped, route]) }
      : {
          ...current,
          seen: new Set<string>([...current.seen, route]),
          queue: [...current.queue, { route, from }],
        }
  }, state)

const linkFinding = (queued: Queued, page: Page, reason: string): BrowserFinding =>
  findingAt(
    { location: queued.from, state: 'discovery', engine: engineOf(page), viewport: undefined },
    BROKEN_LINK_RULE,
    `link to ${queued.route} ${reason}`,
  )

const htmlHeaderFindings = (response: Response, route: string, page: Page): readonly BrowserFinding[] =>
  response.headers()['content-type']?.includes('text/html') === true
    ? securityHeaderProblems(response.headers()).map(
        (problem: string): BrowserFinding =>
          findingAt(
            { location: route, state: 'discovery', engine: engineOf(page), viewport: undefined },
            'security-headers',
            problem,
          ),
      )
    : []

const visited = async (page: Page, url: string): Promise<Response | null> => {
  try {
    return await page.goto(url)
  } catch {
    return null
  }
}

const crawl = async (page: Page, state: CrawlState): Promise<CrawlState> => {
  const [queued, ...rest] = state.queue
  if (queued === undefined) {
    return state
  }
  const next: CrawlState = { ...state, queue: rest }
  const response: Response | null = await visited(page, `${origin}${queued.route}`)
  if (response?.ok() !== true) {
    const reason: string = response === null ? 'did not answer' : `answered ${String(response.status())}`
    return await crawl(
      page,
      queued.route === SEED_ROUTE ? next : { ...next, findings: [...next.findings, linkFinding(queued, page, reason)] },
    )
  }
  const answered: CrawlState = { ...next, answered: new Set<string>([...next.answered, queued.route]) }
  if (toRoute(page.url()) === undefined) {
    return await crawl(page, answered)
  }
  await settleForScan(page)
  const facts: PageFacts = await page.evaluate(pageFactsInPage, CONTROLS)
  const location: SweepLocation = {
    location: new URL(page.url()).pathname,
    url: page.url(),
    isStory: false,
    edges: breakpointEdges(facts.mediaTexts),
    hasDarkMedia: facts.hasDarkMedia,
    controls: facts.controls,
  }
  return await crawl(
    page,
    enqueue(
      {
        ...answered,
        reachable: [...answered.reachable, location],
        findings: [...answered.findings, ...htmlHeaderFindings(response, queued.route, page)],
      },
      [...facts.hrefs, ...alternateHrefs(facts.alternates)].flatMap((href: string): readonly string[] => {
        const address: string | undefined = localAddress(href, page.url(), facts.canonical, origin)
        return address === undefined ? [] : [address]
      }),
      queued.route,
    ),
  )
}

const MAX_SITEMAPS: number = 50

const fetched = async (page: Page, url: string): Promise<APIResponse<unknown> | undefined> => {
  try {
    return await page.request.get(url)
  } catch {
    return undefined
  }
}

const NO_ENTRIES: SitemapEntries = { pages: [], sitemaps: [] }

const sitemapAt = async (page: Page, url: string, read: number): Promise<SitemapEntries> => {
  if (read >= MAX_SITEMAPS || parseUrl(url)?.origin !== origin) {
    return NO_ENTRIES
  }
  const response: APIResponse<unknown> | undefined = await fetched(page, url)
  return response?.ok() === true ? sitemapEntries(await response.text()) : NO_ENTRIES
}

const sitemapPages = async (page: Page, urls: readonly string[], read: number = 0): Promise<readonly string[]> => {
  const [url, ...rest] = urls
  if (url === undefined) {
    return []
  }
  const entries: SitemapEntries = await sitemapAt(page, url, read)
  const local = (locations: readonly string[]): readonly string[] =>
    locations.flatMap((location: string): readonly string[] => {
      const address: string | undefined = onOrigin(location, origin)
      return address === undefined ? [] : [address]
    })
  return [...local(entries.pages), ...(await sitemapPages(page, [...rest, ...local(entries.sitemaps)], read + 1))]
}

const storiesOf = async (page: Page): Promise<readonly DiscoveredStory[]> => {
  const lists: readonly (readonly DiscoveredStory[])[] = await Promise.all(
    projectSettings.auxiliaryServers.map(async (server): Promise<readonly DiscoveredStory[]> => {
      const serverOrigin: string = new URL(server.url).origin
      const response: APIResponse<unknown> | undefined = await fetched(page, `${serverOrigin}/index.json`)
      if (response?.ok() !== true) {
        return []
      }
      try {
        return storiesOfIndex(await response.json(), serverOrigin) ?? []
      } catch {
        return []
      }
    }),
  )
  return lists.flat()
}

const readStoryLocation = async (page: Page, story: DiscoveredStory): Promise<SweepLocation> => {
  const location: SweepLocation = {
    location: storyLocation(story),
    url: storyUrl(story),
    isStory: true,
    edges: [],
    hasDarkMedia: false,
    controls: 0,
  }
  await loadLocation(page, location, DESKTOP, placeAt(page, location, undefined, 'discovery'))
  await settleForScan(page)
  const facts: PageFacts = await page.evaluate(pageFactsInPage, CONTROLS)
  return {
    ...location,
    edges: breakpointEdges(facts.mediaTexts),
    hasDarkMedia: facts.hasDarkMedia,
    controls: facts.controls,
  }
}

// Each story is read on a page of its own, so a story's state cannot reach the next one.
const storyLocationOf = async (page: Page, story: DiscoveredStory): Promise<SweepLocation> => {
  const storyPage: Page = await page.context().newPage()
  try {
    await preparePage(storyPage)
    return await readStoryLocation(storyPage, story)
  } finally {
    await storyPage.close()
  }
}

// Stories are read this many at a time. Each read is one load, independent of the others; the route
// crawl stays sequential, because the routes it visits next depend on the links it has read.
const STORY_CONCURRENCY: number = 4

const storyLocations = async (page: Page, stories: readonly DiscoveredStory[]): Promise<readonly SweepLocation[]> => {
  if (stories.length === 0) {
    return []
  }
  const batch: readonly SweepLocation[] = await Promise.all(
    stories
      .slice(0, STORY_CONCURRENCY)
      .map(async (story: DiscoveredStory): Promise<SweepLocation> => await storyLocationOf(page, story)),
  )
  return [...batch, ...(await storyLocations(page, stories.slice(STORY_CONCURRENCY)))]
}

// The seed route first, then every page the sitemaps list.
const crawlStart = (fromSitemap: readonly string[]): CrawlState =>
  enqueue(
    {
      queue: [{ route: SEED_ROUTE, from: SEED_ROUTE }],
      seen: new Set<string>([SEED_ROUTE]),
      dropped: new Set<string>(),
      answered: new Set<string>(),
      reachable: [],
      findings: [],
    },
    fromSitemap,
    'sitemap.xml',
  )

const wasRecorded = (file: string, value: unknown): boolean => {
  try {
    writeJson(file, value)
    return true
  } catch {
    return false
  }
}

const problemsOf = (crawled: CrawlState): readonly string[] => [
  ...(crawled.answered.has(SEED_ROUTE) ? [] : [`the crawl could not start: ${SEED_ROUTE} did not answer`]),
  ...(crawled.dropped.size === 0
    ? []
    : [
        `the sweep reached the ${String(MAX_SWEEP_ROUTES)}-route cap; raise the harness limit only after ` +
          'measuring the resulting run time',
      ]),
]

/** The scope a `delta` run named, or why it could not be read. */
interface NamedScope {
  readonly scope: SweepScope | undefined
  readonly problem: string | undefined
}

// A scope that cannot be read is a problem the summary fails on, and the sweep covers everything.
const namedScope = (): NamedScope => {
  const file: string | undefined = process.env[SWEEP_SCOPE_ENVIRONMENT_VARIABLE]
  if (file === undefined) {
    return { scope: undefined, problem: undefined }
  }
  const scope: SweepScope | undefined = readJson(file, isSweepScope)
  return {
    scope,
    problem:
      scope === undefined ? `the change scope ${file} could not be read, so the sweep covered everything` : undefined,
  }
}

/** Something discovery found, and why the scope sweeps it. */
interface Chosen<Item> {
  readonly item: Item
  readonly reason: string
}

const chosen = <Item>(items: readonly Item[], reasonOf: (item: Item) => string | undefined): readonly Chosen<Item>[] =>
  items.flatMap((item: Item): readonly Chosen<Item>[] => {
    const reason: string | undefined = reasonOf(item)
    return reason === undefined ? [] : [{ item, reason }]
  })

// The directory a story's Storybook runs in, relative to this application, which its import path is
// relative to.
const storyDirectory = (story: DiscoveredStory): string =>
  projectSettings.auxiliaryServers.find((server): boolean => new URL(server.url).origin === story.server)?.cwd ?? '.'

const storyFile = (story: DiscoveredStory): string =>
  story.importPath === '' ? '' : storyFileOf(story.importPath, storyDirectory(story))

/** What discovery found, and what of it the scope sweeps. */
interface ScopedFinds {
  readonly routes: readonly Chosen<SweepLocation>[]
  readonly stories: readonly Chosen<DiscoveredStory>[]
  readonly everyRoute: number
  readonly everyStory: number
}

const scopeRecordOf = (scope: SweepScope | undefined, finds: ScopedFinds): ScopeRecord => {
  if (scope === undefined) {
    return { isScoped: false, lines: ['complete: no change scope was given, so every route and story is swept'] }
  }
  const changed: readonly string[] = scope.changed.map((file: string): string => `  changed ${file}`)
  if (scope.isComplete) {
    return { isScoped: false, lines: [scopeHeadline(scope), ...changed, '  swept every route and story'] }
  }
  const unreached: string =
    `  not swept: ${String(finds.everyRoute - finds.routes.length)} of ${String(finds.everyRoute)} routes and ` +
    `${String(finds.everyStory - finds.stories.length)} of ${String(finds.everyStory)} stories, which the change ` +
    'does not reach'
  return {
    isScoped: true,
    lines: [
      scopeHeadline(scope),
      ...changed,
      ...finds.routes.map((route: Chosen<SweepLocation>): string => `  swept ${route.item.location}: ${route.reason}`),
      ...finds.stories.map(
        (story: Chosen<DiscoveredStory>): string => `  swept ${storyLocation(story.item)}: ${story.reason}`,
      ),
      unreached,
    ],
  }
}

const discoveryOf = async (page: Page, finds: ScopedFinds, declared: readonly DeclaredRoute[]): Promise<Discovery> => {
  const routes: readonly string[] = finds.routes.map((route: Chosen<SweepLocation>): string => route.item.location)
  const stories: readonly DiscoveredStory[] = finds.stories.map(
    (story: Chosen<DiscoveredStory>): DiscoveredStory => story.item,
  )
  return {
    routes,
    stories,
    locations: [
      ...finds.routes.map((route: Chosen<SweepLocation>): SweepLocation => route.item),
      ...(await storyLocations(page, stories)),
    ],
    samples: templateSamples(routes, declared),
  }
}

/**
 * Discover every page the sweep scans, and record it with whatever made the discovery incomplete.
 *
 * Routes come from a link crawl from `/`, every same-origin `hreflang` alternate, and `sitemap.xml`;
 * stories from each auxiliary server that answers `/index.json`; breakpoints and colour schemes from
 * each page's stylesheets. A crawled internal link that does not answer is a broken link. Under a
 * `delta` run's change scope the crawl still reaches and checks every route, and the passes are handed
 * only the routes and stories the change reaches, each with the reason it is swept. Every pass depends
 * on this test, so it fails only when it could not write its record; the summary judges the findings
 * and problems it recorded.
 * @param page the test's page.
 */
export const expectDiscoveredSite = async (page: Page): Promise<void> => {
  clearCompletedScans()
  const budget: Budget = armBudget(page, 'discovery', WHOLE_PASS, MAX_SWEEP_ROUTES)
  await preparePage(page)
  const { scope, problem }: NamedScope = namedScope()
  const declared: readonly DeclaredRoute[] = declaredRoutes()
  const fromSitemap: readonly string[] = await sitemapPages(page, [`${origin}/sitemap.xml`])
  const crawled: CrawlState = await crawl(page, crawlStart(fromSitemap))
  const missing: NotFoundDiscovery = await discoverNotFound(
    page,
    crawled.reachable.map((location: SweepLocation): string => location.location),
  )
  const everyStory: readonly DiscoveredStory[] = await storiesOf(page)
  const finds: ScopedFinds = {
    routes: chosen([...crawled.reachable, ...missing.locations], (location: SweepLocation): string | undefined =>
      scope === undefined ? '' : routeReason(scope, declared, location.location),
    ),
    stories: chosen(everyStory, (story: DiscoveredStory): string | undefined =>
      scope === undefined ? '' : storyReason(scope, storyFile(story)),
    ),
    everyRoute: crawled.reachable.length + missing.locations.length,
    everyStory: everyStory.length,
  }
  const discovery: Discovery = await discoveryOf(page, finds, declared)
  const stories: readonly DiscoveredStory[] = discovery.stories
  const report: DiscoveryReport = {
    visitedRoutes: crawled.reachable.map((location: SweepLocation): string => location.location),
    answeredRoutes: [...crawled.answered],
    findings: crawled.findings,
    problems: [...missing.problems, ...problemsOf(crawled), ...(problem === undefined ? [] : [problem])],
    places: crawled.answered.size + stories.length,
    locations: discovery.locations.map((location: SweepLocation): string => location.location),
    elapsedMs: Math.round(performance.now() - budget.startedAt),
    scope: scopeRecordOf(scope, finds),
  }
  const isRecorded: boolean =
    wasRecorded(discoveryReportFile(test.info()), report) && wasRecorded(discoveryFile(test.info()), discovery)
  expect(isRecorded, 'discovery could not write its record to the test output directory').toBe(true)
}
