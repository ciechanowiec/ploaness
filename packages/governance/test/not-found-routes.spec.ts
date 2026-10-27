import { describe, expect, it } from 'vitest'
import { notFoundBoundaries, notFoundProbes } from '../src/not-found-routes.js'

describe('not-found boundaries', () => {
  it('finds public boundaries inside route groups and omits private or unrelated files', () => {
    expect(
      notFoundBoundaries(
        [
          'src/app/(public)/not-found.tsx',
          'src/app/[locale]/not-found.tsx',
          'src/app/_private/not-found.tsx',
          'src/app/(.)photo/not-found.tsx',
          'src/components/not-found.tsx',
          'src/app/page.tsx',
        ],
        'src/app',
      ),
    ).toEqual([
      { file: 'src/app/(public)/not-found.tsx', route: '/' },
      { file: 'src/app/[locale]/not-found.tsx', route: '/[locale]' },
    ])
  })
  it('probes a static prefix without needing a link to a broken address', () => {
    expect(notFoundProbes({ file: 'not-found.tsx', route: '/' }, [])).toEqual(['/__ploaness_missing_page__'])
    expect(notFoundProbes({ file: 'help/not-found.tsx', route: '/help' }, [])).toEqual([
      '/help/__ploaness_missing_page__',
    ])
  })
  it('resolves each concrete locale once from the visited URLs', () => {
    expect(
      notFoundProbes({ file: '[locale]/not-found.tsx', route: '/[locale]' }, [
        '/en',
        '/en/about',
        '/tr/',
        '/tr/about',
        '/',
      ]),
    ).toEqual(['/en/__ploaness_missing_page__', '/tr/__ploaness_missing_page__'])
  })
  it('requires evidence for a dynamic prefix and rejects unrelated prefixes', () => {
    expect(notFoundProbes({ file: 'teams/[id]/not-found.tsx', route: '/teams/[id]' }, ['/other/42', '/teams'])).toEqual(
      [],
    )
    expect(notFoundProbes({ file: 'teams/[id]/not-found.tsx', route: '/teams/[id]' }, ['/teams/42/profile'])).toEqual([
      '/teams/42/__ploaness_missing_page__',
    ])
  })
})
