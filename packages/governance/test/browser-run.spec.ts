import { describe, expect, it } from 'vitest'
import {
  clockOf,
  DEFAULT_CLOCK_INSTANT,
  passBudgetMs,
  pinnedBrowserEndpoint,
  pinnedBrowserServerArguments,
  playwrightImageOf,
  REAL_CLOCK,
  type ShardItem,
  shardOf,
  shiftedTime,
} from '../src/browser-run.js'
import { readSettings } from '../src/settings.js'

describe('the verification clock', () => {
  it('starts at the default instant unless a project names another or the real clock', () => {
    expect([clockOf(undefined), clockOf('2031-05-06T08:00:00+02:00'), clockOf('real')]).toEqual([
      DEFAULT_CLOCK_INSTANT,
      '2031-05-06T06:00:00.000Z',
      REAL_CLOCK,
    ])
  })

  it('reads a malformed value as the default, so a typo cannot unpin it', () => {
    expect([clockOf('Real'), clockOf('2031-13-45T99:00Z'), clockOf('2031-05-06'), clockOf(1)]).toEqual([
      DEFAULT_CLOCK_INSTANT,
      DEFAULT_CLOCK_INSTANT,
      DEFAULT_CLOCK_INSTANT,
      DEFAULT_CLOCK_INSTANT,
    ])
  })

  it('is read from the ploaness settings', () => {
    expect([readSettings({}).clock, readSettings({ ploaness: { clock: 'real' } }).clock]).toEqual([
      DEFAULT_CLOCK_INSTANT,
      REAL_CLOCK,
    ])
  })

  it('advances from its instant at the real rate', () => {
    expect(shiftedTime(1000, 50, 80)).toBe(1030)
  })
})

describe('the pinned browsers and the pass budgets', () => {
  it('names the Playwright image of the pinned version', () => {
    expect(playwrightImageOf('1.64.1')).toBe('mcr.microsoft.com/playwright:v1.64.1-noble')
  })

  it('grows a pass budget with the work it discovered', () => {
    expect([passBudgetMs('resting', 0), passBudgetMs('resting', 10), passBudgetMs('width-sweep', -1)]).toEqual([
      60_000, 180_000, 60_000,
    ])
  })
})

describe('the shards of a sweep pass', () => {
  const items: readonly string[] = ['a', 'b', 'c', 'd', 'e']
  const shards: readonly (readonly ShardItem<string>[])[] = [0, 1, 2].map(
    (index: number): readonly ShardItem<string>[] => shardOf(items, { index, count: 3 }),
  )

  it('deals the items round-robin and keeps the index each had in the whole pass', () => {
    expect(shards).toEqual([
      [
        { item: 'a', index: 0 },
        { item: 'd', index: 3 },
      ],
      [
        { item: 'b', index: 1 },
        { item: 'e', index: 4 },
      ],
      [{ item: 'c', index: 2 }],
    ])
  })

  it('visits every item exactly once across the shards', () => {
    expect(
      shards
        .flat()
        .map((visited: ShardItem<string>): number => visited.index)
        .toSorted((left: number, right: number): number => left - right),
    ).toEqual([0, 1, 2, 3, 4])
  })

  it('leaves a shard beyond the items empty', () => {
    expect(shardOf(['a'], { index: 1, count: 2 })).toEqual([])
  })
})

describe('the pinned browser server', () => {
  it('runs the host Playwright, read-only, against the image browsers on a loopback port', () => {
    expect(
      pinnedBrowserServerArguments({
        image: 'mcr.microsoft.com/playwright:v1.64.1-noble',
        name: 'ploaness-browsers-4100',
        port: 4100,
        playwrightCore: '/repo/node_modules/playwright-core',
        isHostNetwork: false,
      }),
    ).toEqual([
      'run',
      '--detach',
      '--rm',
      '--init',
      '--ipc=host',
      '--name=ploaness-browsers-4100',
      '--publish=127.0.0.1:4100:4100',
      '--volume=/repo/node_modules/playwright-core:/ploaness/playwright-core:ro',
      '--workdir=/tmp',
      'mcr.microsoft.com/playwright:v1.64.1-noble',
      'node',
      '/ploaness/playwright-core/cli.js',
      'run-server',
      '--port=4100',
      '--host=0.0.0.0',
    ])
    expect(pinnedBrowserEndpoint(4100)).toBe('ws://127.0.0.1:4100/')
  })

  it('shares the host network instead of publishing a port where the host network reaches loopback', () => {
    const hostArguments: readonly string[] = pinnedBrowserServerArguments({
      image: 'mcr.microsoft.com/playwright:v1.64.1-noble',
      name: 'ploaness-browsers-4100',
      port: 4100,
      playwrightCore: '/repo/node_modules/playwright-core',
      isHostNetwork: true,
    })
    expect([
      hostArguments.includes('--network=host'),
      hostArguments.some((part: string): boolean => part.startsWith('--publish')),
      hostArguments.at(-1),
    ]).toEqual([true, false, '--host=127.0.0.1'])
  })
})
