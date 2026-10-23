import { describe, expect, it } from 'vitest'
import {
  alternateHrefs,
  axeRulesExcludedAt,
  type DiscoveredStory,
  DOCUMENT_AXE_RULES,
  localAddress,
  onOrigin,
  sitemapEntries,
  storiesOfIndex,
  storyLocation,
  storySamples,
  storyUrl,
  templateSamples,
} from '../src/browser-discovery.js'
import type { DeclaredRoute } from '../src/route-map.js'

describe('sitemap discovery', () => {
  it('reads the pages of a url set, decoding entities and repeating none', () => {
    expect(
      sitemapEntries(
        '<urlset><url><loc> http://localhost:3100/en </loc></url>' +
          '<url><loc>http://localhost:3100/en?a=1&amp;b=2</loc></url>' +
          '<url><loc>http://localhost:3100/en</loc></url></urlset>',
      ),
    ).toEqual({ pages: ['http://localhost:3100/en', 'http://localhost:3100/en?a=1&b=2'], sitemaps: [] })
  })

  it('reads the nested sitemaps of an index', () => {
    expect(
      sitemapEntries('<sitemapindex><sitemap><loc>http://localhost:3100/sitemaps/1</loc></sitemap></sitemapindex>'),
    ).toEqual({
      pages: [],
      sitemaps: ['http://localhost:3100/sitemaps/1'],
    })
  })
})

describe('locale discovery', () => {
  it('follows every alternate that names a language, x-default included', () => {
    expect(
      alternateHrefs([
        { hreflang: 'en', href: '/en/teams' },
        { hreflang: 'x-default', href: '/en/teams' },
        { hreflang: 'tr', href: ' /tr/takimlar ' },
        { hreflang: '', href: '/feed' },
      ]),
    ).toEqual(['/en/teams', '/tr/takimlar'])
  })
})

describe('story discovery', () => {
  const server: string = 'http://localhost:6106'

  it('lists each story and leaves docs entries out', () => {
    expect(
      storiesOfIndex(
        {
          v: 5,
          entries: {
            'ui-button--primary': { type: 'story', id: 'ui-button--primary', title: 'UI/Button', name: 'Primary' },
            'ui-button--docs': { type: 'docs', id: 'ui-button--docs', title: 'UI/Button', name: 'Docs' },
            broken: { type: 'story' },
          },
        },
        server,
      ),
    ).toEqual([{ id: 'ui-button--primary', title: 'UI/Button', name: 'Primary', server }])
  })

  it('answers undefined for a document that is not a Storybook index', () => {
    expect([storiesOfIndex({ entries: null }, server), storiesOfIndex([], server)]).toEqual([undefined, undefined])
  })

  it('addresses a story alone and reports it by its id', () => {
    expect([storyUrl({ id: 'ui-button--primary', server }), storyLocation({ id: 'ui-button--primary' })]).toEqual([
      'http://localhost:6106/iframe.html?id=ui-button--primary&viewMode=story',
      'story:ui-button--primary',
    ])
  })
})

describe('template sampling', () => {
  const declared: readonly DeclaredRoute[] = [
    { file: 'src/app/page.tsx', route: '/', isDynamic: false },
    { file: 'src/app/teams/[slug]/page.tsx', route: '/teams/[slug]', isDynamic: true },
  ]

  it('picks the first crawled route of each template and counts the rest', () => {
    expect(templateSamples(['/', '/teams/ajax', '/teams/psv', '/rewritten'], declared)).toEqual([
      { template: '/', route: '/', routes: 1 },
      { template: '/teams/[slug]', route: '/teams/ajax', routes: 2 },
      { template: '/rewritten', route: '/rewritten', routes: 1 },
    ])
  })
})

describe('sitemap locations on the run origin', () => {
  it('reads the path of a canonical public URL on the application under test', () => {
    expect([
      onOrigin('https://www.example.com/en/teams?page=2', 'http://127.0.0.1:3100'),
      onOrigin('/sitemaps/1', 'http://127.0.0.1:3100'),
      onOrigin('https://[', 'http://127.0.0.1:3100'),
    ]).toEqual(['http://127.0.0.1:3100/en/teams?page=2', 'http://127.0.0.1:3100/sitemaps/1', undefined])
  })
})

describe('links on the application under test', () => {
  const origin: string = 'http://localhost:3100'
  const page: string = 'http://localhost:3100/en'

  it('keeps a same-origin link, and reads one under the canonical host on the run origin', () => {
    expect([
      localAddress('/en/news', page, 'https://www.example.com/en', origin),
      localAddress('https://www.example.com/tr/haberler', page, 'https://www.example.com/en', origin),
    ]).toEqual(['http://localhost:3100/en/news', 'http://localhost:3100/tr/haberler'])
  })

  it('leaves out another site, any absolute link without a canonical, and a malformed href', () => {
    expect([
      localAddress('https://partner.example.org/', page, 'https://www.example.com/en', origin),
      localAddress('https://www.example.com/en', page, '', origin),
      localAddress('https://[', page, '', origin),
    ]).toEqual([undefined, undefined, undefined])
  })
})

const story = (id: string, title: string, server: string = 'http://localhost:6106'): DiscoveredStory => ({
  id,
  title,
  name: id,
  server,
})

describe('story sampling', () => {
  it('picks the first story of each component on each server', () => {
    expect(
      storySamples([
        story('button--primary', 'UI/Button'),
        story('button--ghost', 'UI/Button'),
        story('card--default', 'UI/Card'),
        story('button--other', 'UI/Button', 'http://localhost:6107'),
      ]).map((sampled: DiscoveredStory): string => sampled.id),
    ).toEqual(['button--primary', 'card--default', 'button--other'])
  })
})

describe('axe rules for a story', () => {
  it('leaves out the document rules for a story and keeps every rule for a route', () => {
    expect([axeRulesExcludedAt('story:ui-button--primary'), axeRulesExcludedAt('/en')]).toEqual([
      DOCUMENT_AXE_RULES,
      [],
    ])
  })
})
