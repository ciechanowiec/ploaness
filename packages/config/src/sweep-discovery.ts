// The sweep's discovery pass: what the later passes scan, read from the running application.
import { type APIResponse, expect, type Page, type Response, test } from '@playwright/test'
import {
  type AlternateLink,
  alternateHrefs,
  BROKEN_LINK_RULE,
  type BrowserFinding,
  breakpointEdges,
  type DiscoveredStory,
  distinctFindings,
  findingAt,
  findingLine,
  localAddress,
  onOrigin,
  type SitemapEntries,
  securityHeaderProblems,
  sitemapEntries,
  storiesOfIndex,
  storyLocation,
  storyUrl,
  templateSamples,
} from '@ploaness/governance'
import { declaredRoutes, isSkippedSweepRoute, MAX_SWEEP_ROUTES, unsweptRoutes } from './a11y.js'
import { projectSettings } from './project-settings.js'
import { engineOf } from './scanner.js'
import { settleForScan } from './settle.js'
import {
  armBudget,
  type Budget,
  CONTROLS,
  type CssRule,
  DESKTOP,
  type Discovery,
  type DomElement,
  type DomWindow,
  discoveryFile,
  loadLocation,
  origin,
  type PassReport,
  placeAt,
  preparePage,
  reportFile,
  type SweepLocation,
  writeJson,
} from './sweep-shared.js'

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
  readonly hasDarkClass: boolean
  readonly controls: number
  readonly hrefs: readonly string[]
  readonly alternates: readonly AlternateLink[]
}

// Read through the CSSOM, so a breakpoint in any stylesheet the page loaded counts, nested at-rules
// included. A stylesheet from another origin cannot be read and has already been blocked anyway.
const pageFactsInPage = (controls: string): PageFacts => {
  const page: DomWindow = globalThis as unknown as DomWindow
  const rulesOf = (sheet: { readonly cssRules?: ArrayLike<CssRule> }): readonly CssRule[] => {
    try {
      return Array.from(sheet.cssRules ?? []).flatMap((rule: CssRule): readonly CssRule[] => [rule, ...rulesOf(rule)])
    } catch {
      return []
    }
  }
  const rules: readonly CssRule[] = Array.from(page.document.styleSheets).flatMap(
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
      return page.document.querySelector(selector === '' ? '*' : selector) !== null
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
    canonical: page.document.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? '',
    hasDarkMedia: mediaRules.some((rule: CssRule): boolean =>
      (rule.media?.mediaText ?? '').includes('prefers-color-scheme'),
    ),
    hasDarkClass: rules.some((rule: CssRule): boolean =>
      /(?:^|[\s,>+~(])\.dark(?![\w-])/u.test(rule.selectorText ?? ''),
    ),
    controls: page.document.querySelectorAll(controls).length,
    hrefs: Array.from(
      page.document.querySelectorAll('a[href]'),
      (anchor: DomElement): string => anchor.getAttribute('href') ?? '',
    ),
    alternates: Array.from(
      page.document.querySelectorAll('link[rel="alternate"][hreflang]'),
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
    location: queued.route,
    url: `${origin}${queued.route}`,
    isStory: false,
    edges: breakpointEdges(facts.mediaTexts),
    hasDarkMedia: facts.hasDarkMedia,
    hasDarkClass: facts.hasDarkClass,
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

const fetched = async (page: Page, url: string): Promise<APIResponse | undefined> => {
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
  const response: APIResponse | undefined = await fetched(page, url)
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
      const response: APIResponse | undefined = await fetched(page, `${serverOrigin}/index.json`)
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

const storyLocationOf = async (page: Page, story: DiscoveredStory): Promise<SweepLocation> => {
  const location: SweepLocation = {
    location: storyLocation(story),
    url: storyUrl(story),
    isStory: true,
    edges: [],
    hasDarkMedia: false,
    hasDarkClass: false,
    controls: 0,
  }
  await loadLocation(page, location, DESKTOP, placeAt(page, location, undefined, 'discovery'))
  await settleForScan(page)
  const facts: PageFacts = await page.evaluate(pageFactsInPage, CONTROLS)
  return {
    ...location,
    edges: breakpointEdges(facts.mediaTexts),
    hasDarkMedia: facts.hasDarkMedia,
    hasDarkClass: facts.hasDarkClass,
    controls: facts.controls,
  }
}

const storyLocations = async (page: Page, stories: readonly DiscoveredStory[]): Promise<readonly SweepLocation[]> =>
  await stories.reduce(
    async (earlier: Promise<readonly SweepLocation[]>, story: DiscoveredStory): Promise<readonly SweepLocation[]> => [
      ...(await earlier),
      await storyLocationOf(page, story),
    ],
    Promise.resolve<readonly SweepLocation[]>([]),
  )

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

/**
 * Discover every page the sweep scans, and fail when the discovery is incomplete.
 *
 * Routes come from a link crawl from `/`, every same-origin `hreflang` alternate, and `sitemap.xml`;
 * stories from each auxiliary server that answers `/index.json`; breakpoints and colour schemes from
 * each page's stylesheets. A crawled internal link that does not answer is a broken link.
 * @param page the test's page.
 */
export const expectDiscoveredSite = async (page: Page): Promise<void> => {
  const budget: Budget = armBudget('discovery', MAX_SWEEP_ROUTES)
  await preparePage(page)
  const fromSitemap: readonly string[] = await sitemapPages(page, [`${origin}/sitemap.xml`])
  const crawled: CrawlState = await crawl(page, crawlStart(fromSitemap))
  const routes: readonly string[] = crawled.reachable.map((location: SweepLocation): string => location.location)
  const stories: readonly DiscoveredStory[] = await storiesOf(page)
  const discovery: Discovery = {
    routes,
    stories,
    locations: [...crawled.reachable, ...(await storyLocations(page, stories))],
    samples: templateSamples(routes, declaredRoutes()),
  }
  writeJson(discoveryFile(test.info()), discovery)
  writeJson(reportFile(test.info(), 'discovery'), {
    pass: 'discovery',
    engine: engineOf(page),
    findings: crawled.findings,
    used: [],
    declared: [],
    judgedRules: [],
    places: crawled.answered.size + stories.length,
    elapsedMs: Math.round(performance.now() - budget.startedAt),
    locations: discovery.locations.map((location: SweepLocation): string => location.location),
    notes: [],
  } satisfies PassReport)
  expect.soft(crawled.answered.has(SEED_ROUTE), `the crawl could not start: ${SEED_ROUTE} did not answer`).toBe(true)
  expect
    .soft(
      crawled.dropped.size,
      `the sweep reached the ${String(MAX_SWEEP_ROUTES)}-route cap; raise the harness limit only after ` +
        'measuring the resulting run time',
    )
    .toBe(0)
  expect
    .soft(unsweptRoutes(routes, [...crawled.answered]), 'pages this project declares that nothing scans')
    .toEqual([])
  expect(
    distinctFindings(crawled.findings).map((finding: BrowserFinding): string => findingLine(finding)),
    'discovery findings',
  ).toEqual([])
}
