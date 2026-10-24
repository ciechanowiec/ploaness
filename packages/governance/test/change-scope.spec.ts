import { describe, expect, it } from 'vitest'
import {
  type Baseline,
  baselineRemote,
  type ChangedFile,
  changeBaseline,
  coversEveryEngine,
  importGraphOf,
  isSweepScope,
  routeReason,
  type ScopeInputs,
  type SweepScope,
  scopeHeadline,
  scopeLines,
  storyFileOf,
  storyReason,
  sweepScopeOf,
  trackingBranch,
} from '../src/change-scope.js'
import { type DeclaredRoute, declaredRoutesOf } from '../src/route-map.js'

const APP: string = 'src/app/(frontend)'

// A small application: a root layout with its global stylesheet, a news section with its own layout,
// and two components with a story each. Every page and story imports what a real one would.
const GRAPH: Readonly<Record<string, readonly string[]>> = {
  [`${APP}/layout.tsx`]: [`${APP}/styles.css`],
  [`${APP}/styles.css`]: [],
  [`${APP}/page.tsx`]: ['src/components/Hero.tsx'],
  [`${APP}/news/layout.tsx`]: [],
  [`${APP}/news/page.tsx`]: ['src/components/Card.tsx'],
  [`${APP}/news/[slug]/page.tsx`]: ['src/lib/format.ts'],
  [`${APP}/about/page.tsx`]: [],
  'src/components/Card.tsx': ['src/components/Card.module.css', 'src/lib/format.ts'],
  'src/components/Card.module.css': [],
  'src/components/Card.stories.tsx': ['src/components/Card.tsx'],
  'src/components/Hero.tsx': [],
  'src/components/Hero.stories.tsx': ['src/components/Hero.tsx'],
  'src/lib/format.ts': [],
  'tests/int/format.int.spec.ts': ['src/lib/format.ts'],
}

const FILES: readonly string[] = [
  ...Object.keys(GRAPH),
  'src/content/tokens.json',
  'README.md',
  '.github/workflows/verify.yml',
  'next.config.ts',
  'public/logo.svg',
]

const BASELINE: Baseline = { commit: 'a1b2c3d4e5f6a7b8c9d0', branch: 'origin/main' }

const changes = (...paths: readonly string[]): readonly ChangedFile[] =>
  paths.map((path: string): ChangedFile => ({ path, isDeleted: false }))

const SOLE: ScopeInputs = {
  baseline: BASELINE,
  changed: [],
  member: '.',
  sourceRoots: ['src', 'tests', 'scripts'],
  members: ['.'],
  related: [],
  files: FILES,
  graph: GRAPH,
}

const scopeOf = (...paths: readonly string[]): SweepScope => sweepScopeOf({ ...SOLE, changed: changes(...paths) })

const targetsOf = (scope: SweepScope): Readonly<Record<string, readonly string[]>> =>
  scope.isComplete
    ? { complete: scope.reasons }
    : {
        routes: scope.routes.map((target) => target.target),
        stories: scope.stories.map((target) => target.target),
      }

describe('the change baseline', () => {
  it('reads the default branch of origin, or of the first remote when there is no origin', () => {
    expect([baselineRemote(['backup', 'origin']), baselineRemote(['upstream', 'fork']), baselineRemote([])]).toEqual([
      'origin',
      'upstream',
      undefined,
    ])
    expect([
      trackingBranch('origin', 'refs/remotes/origin/trunk'),
      trackingBranch('origin', undefined),
      trackingBranch('upstream', 'refs/remotes/origin/main'),
    ]).toEqual(['origin/trunk', 'origin/main', 'upstream/main'])
  })

  it('measures from the merge-base, and names why there is none', () => {
    expect(changeBaseline({ branch: 'origin/main', isShallow: false, mergeBase: 'abc' })).toEqual({
      commit: 'abc',
      branch: 'origin/main',
    })
    expect(
      [
        changeBaseline({ branch: undefined, isShallow: false, mergeBase: undefined }),
        changeBaseline({ branch: 'origin/main', isShallow: true, mergeBase: 'abc' }),
        changeBaseline({ branch: 'origin/main', isShallow: false, mergeBase: undefined }),
      ].map((baseline: Baseline): string => ('problem' in baseline ? baseline.problem : baseline.commit)),
    ).toEqual([
      'the repository has no remote-tracking default branch, such as origin/main',
      'the clone is shallow, so its merge-base with origin/main is unknown',
      'HEAD and origin/main share no merge-base',
    ])
  })

  it('sweeps everything when there is no baseline', () => {
    const scope: SweepScope = sweepScopeOf({
      ...SOLE,
      baseline: { commit: undefined, problem: 'the clone is shallow' },
      changed: changes('src/components/Card.tsx'),
    })
    expect(scope).toEqual({
      isComplete: true,
      baseline: undefined,
      branch: undefined,
      changed: ['src/components/Card.tsx'],
      reasons: ['the clone is shallow'],
    })
  })
})

describe('the pages a change reaches', () => {
  it('sweeps only the routes and stories whose modules import a changed component', () => {
    const scope: SweepScope = scopeOf('src/components/Card.tsx')
    expect(targetsOf(scope)).toEqual({ routes: ['/news'], stories: ['src/components/Card.stories.tsx'] })
    expect(scope.isComplete ? [] : scope.routes.map((target) => target.reason)).toEqual([
      `${APP}/news/page.tsx reaches src/components/Card.tsx`,
    ])
  })

  it('follows imports transitively and names every route that reaches the change', () => {
    expect(targetsOf(scopeOf('src/lib/format.ts'))).toEqual({
      routes: ['/news', '/news/[slug]'],
      stories: ['src/components/Card.stories.tsx'],
    })
  })

  it('sweeps every route below a changed segment layout and none beside it', () => {
    const scope: SweepScope = scopeOf(`${APP}/news/layout.tsx`)
    expect(targetsOf(scope)).toEqual({ routes: ['/news', '/news/[slug]'], stories: [] })
    expect(scope.isComplete ? '' : scope.routes[0]?.reason).toBe(`${APP}/news/layout.tsx changed`)
  })

  it('follows a stylesheet module through the component that imports it', () => {
    expect(targetsOf(scopeOf('src/components/Card.module.css'))).toEqual(targetsOf(scopeOf('src/components/Card.tsx')))
  })

  it('sweeps a changed story alone', () => {
    expect(targetsOf(scopeOf('src/components/Hero.stories.tsx'))).toEqual({
      routes: [],
      stories: ['src/components/Hero.stories.tsx'],
    })
  })

  it('counts every changed file a route reaches', () => {
    const scope: SweepScope = scopeOf('src/components/Card.tsx', 'src/lib/format.ts')
    expect(scope.isComplete ? '' : scope.routes[0]?.reason).toBe(
      `${APP}/news/page.tsx reaches src/components/Card.tsx and 1 more changed file(s)`,
    )
  })

  it('changes no page for documentation, workflows, tests, and a deleted module', () => {
    const scope: SweepScope = sweepScopeOf({
      ...SOLE,
      changed: [
        ...changes('README.md', '.github/workflows/verify.yml', 'tests/int/format.int.spec.ts'),
        { path: 'src/components/Old.tsx', isDeleted: true },
      ],
    })
    expect(targetsOf(scope)).toEqual({ routes: [], stories: [] })
    expect(scope.changed).toHaveLength(4)
  })
})

describe('a change that sweeps everything', () => {
  it.each([
    [`${APP}/styles.css`, `${APP}/styles.css is a global stylesheet`],
    [`${APP}/layout.tsx`, `${APP}/layout.tsx is the root layout`],
    ['next.config.ts', 'next.config.ts is the Next.js configuration'],
    ['postcss.config.mjs', 'postcss.config.mjs is the style tool configuration'],
    ['src/proxy.ts', 'src/proxy.ts is request handling every route passes through'],
    ['public/logo.svg', 'public/logo.svg is a public file pages may load'],
    ['.storybook/preview.tsx', '.storybook/preview.tsx is the Storybook configuration'],
    ['.env.example', '.env.example is an environment file'],
    ['pnpm-lock.yaml', 'pnpm-lock.yaml decides what is installed for every member'],
    ['package.json', 'package.json decides what is installed for every member'],
    ['src/content/tokens.json', 'src/content/tokens.json is not in the import graph, so what it reaches is unknown'],
  ])('sweeps everything when %s changes', (file: string, reason: string) => {
    expect(targetsOf(scopeOf('src/components/Card.tsx', file))).toEqual({ complete: [reason] })
  })
})

describe('an application in a workspace', () => {
  const graph: Readonly<Record<string, readonly string[]>> = {
    'src/app/layout.tsx': [],
    'src/app/page.tsx': ['src/components/Card.tsx'],
    'src/components/Card.tsx': [],
  }
  const frontend: ScopeInputs = {
    ...SOLE,
    member: 'fe',
    members: ['.', 'cms', 'fe', 'packages/unrelated'],
    related: ['cms'],
    files: Object.keys(graph),
    graph,
  }
  const scopeIn = (...paths: readonly string[]): SweepScope => sweepScopeOf({ ...frontend, changed: changes(...paths) })

  it('reads its own files relative to its directory', () => {
    expect(targetsOf(scopeIn('fe/src/components/Card.tsx'))).toEqual({ routes: ['/'], stories: [] })
  })

  it('sweeps everything when a member it runs beside changes', () => {
    expect(targetsOf(scopeIn('cms/src/collections/Pages.ts'))).toEqual({
      complete: ['cms/src/collections/Pages.ts belongs to cms, which this application runs beside or depends on'],
    })
  })

  it('changes no page for an unrelated member or the root member', () => {
    expect(targetsOf(scopeIn('packages/unrelated/src/index.ts', 'scripts/release.ts', 'fe/README.md'))).toEqual({
      routes: [],
      stories: [],
    })
  })

  it('sweeps everything when the repository manifest or the application manifest changes', () => {
    expect(targetsOf(scopeIn('package.json'))).toEqual({
      complete: ['package.json decides what is installed for every member'],
    })
    expect(targetsOf(scopeIn('fe/package.json'))).toEqual({ complete: ['fe/package.json is the manifest'] })
  })
})

describe('what the sweep scans under a scope', () => {
  const declared: readonly DeclaredRoute[] = declaredRoutesOf(FILES, 'src/app')
  const scope: SweepScope = scopeOf('src/lib/format.ts')

  it('scans a crawled route whose template is in scope, and names why', () => {
    expect(routeReason(scope, declared, '/news/first-story')).toBe(
      `${APP}/news/[slug]/page.tsx reaches src/lib/format.ts`,
    )
    expect(routeReason(scope, declared, '/about')).toBeUndefined()
  })

  it('scans a route no file declares, because what reaches it is unknown', () => {
    expect(routeReason(scope, declared, '/feed.xml/extra/deep')).toBe(
      'no route file declares it, so what reaches it is unknown',
    )
  })

  it('locates a story by its import path and scans it when the change reaches it', () => {
    expect(storyFileOf('./src/components/Card.stories.tsx', '.')).toBe('src/components/Card.stories.tsx')
    expect(storyReason(scope, storyFileOf('./src/components/Card.stories.tsx', '.'))).toBe(
      'src/components/Card.stories.tsx reaches src/lib/format.ts',
    )
    expect(storyReason(scope, storyFileOf('./src/components/Hero.stories.tsx', '.'))).toBeUndefined()
  })

  it('scans a story outside the application or in no named file', () => {
    expect(storyFileOf('./src/Button.stories.tsx', '../design')).toBe('../design/src/Button.stories.tsx')
    for (const file of ['../design/src/Button.stories.tsx', '']) {
      expect(storyReason(scope, file)).toBe('its file is outside this application, so what reaches it is unknown')
    }
  })

  it('scans everything under a complete scope', () => {
    const complete: SweepScope = scopeOf('public/logo.svg')
    expect([routeReason(complete, declared, '/about'), storyReason(complete, 'src/x.stories.tsx')]).toEqual([
      'the sweep is complete',
      'the sweep is complete',
    ])
  })
})

describe('the scope a run hands its sweep', () => {
  it('survives the file it travels in, and nothing else passes for it', () => {
    for (const scope of [scopeOf('src/lib/format.ts'), scopeOf('public/logo.svg')]) {
      const written: string = JSON.stringify(scope)
      expect(isSweepScope(JSON.parse(written))).toBe(true)
    }
    expect(
      [
        undefined,
        [],
        { isComplete: true, changed: [] },
        {
          isComplete: false,
          changed: [],
          baseline: 'a',
          branch: 'origin/main',
          routes: [{ target: '/' }],
          stories: [],
        },
        { isComplete: 'yes', changed: [], reasons: [] },
      ].map((value: unknown): boolean => isSweepScope(value)),
    ).toEqual([false, false, false, false, false])
  })

  it('states the level, the baseline, and what the change reaches', () => {
    expect(scopeHeadline(scopeOf('src/lib/format.ts'))).toBe(
      'delta since a1b2c3d4e5f6, the merge-base of HEAD and origin/main: 1 changed file(s) reach 2 route(s) ' +
        'and 1 story file(s)',
    )
    expect(scopeHeadline(scopeOf('public/logo.svg'))).toBe(
      'delta since a1b2c3d4e5f6, the merge-base of HEAD and origin/main, complete because public/logo.svg is a ' +
        'public file pages may load',
    )
  })

  it('runs the other engines only in an unscoped run with the pinned browsers', () => {
    expect([
      coversEveryEngine({ PLOANESS_BROWSER_ENDPOINT: 'wss://browsers.invalid/run' }),
      coversEveryEngine({
        PLOANESS_BROWSER_ENDPOINT: 'wss://browsers.invalid/run',
        PLOANESS_SWEEP_SCOPE: 'scope.json',
      }),
      coversEveryEngine({}),
    ]).toEqual([true, false, false])
  })
})

describe('the import graph and the scope report', () => {
  it('reads the graph the architecture analyzer reports, unresolved imports left out', () => {
    expect(
      importGraphOf({
        modules: [
          {
            source: 'src/a.ts',
            dependencies: [{ resolved: 'src/b.ts' }, { module: 'missing', couldNotResolve: true }],
          },
          { source: 'src/b.ts', dependencies: [] },
        ],
      }),
    ).toEqual({ 'src/a.ts': ['src/b.ts'], 'src/b.ts': [] })
    expect([importGraphOf(undefined), importGraphOf({ modules: [{ source: 1 }] }), importGraphOf({})]).toEqual([
      undefined,
      undefined,
      undefined,
    ])
  })

  it('lists every changed file and each route and story with its reason', () => {
    expect(scopeLines(scopeOf('src/components/Card.tsx'))).toEqual([
      'delta since a1b2c3d4e5f6, the merge-base of HEAD and origin/main: 1 changed file(s) reach 1 route(s) and 1 ' +
        'story file(s)',
      '  changed src/components/Card.tsx',
      `  route /news: ${APP}/news/page.tsx reaches src/components/Card.tsx`,
      '  story src/components/Card.stories.tsx: src/components/Card.stories.tsx reaches src/components/Card.tsx',
    ])
    expect(scopeLines(scopeOf('public/logo.svg'))).toHaveLength(2)
  })
})
