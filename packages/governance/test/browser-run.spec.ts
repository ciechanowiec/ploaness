import { describe, expect, it } from 'vitest'
import {
  clockOf,
  DEFAULT_CLOCK_INSTANT,
  partBudgetMs,
  passBudgetMs,
  pinnedBrowserEndpoint,
  pinnedBrowserServerArguments,
  playwrightImageOf,
  REAL_CLOCK,
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

describe('the budget of one part of a pass', () => {
  it('is the budget of an equal share of the whole pass, rounded up to a whole unit', () => {
    expect([
      partBudgetMs('resting', 8, { index: 0, count: 4 }),
      partBudgetMs('resting', 9, { index: 3, count: 4 }),
      partBudgetMs('resting', 0, { index: 0, count: 4 }),
    ]).toEqual([passBudgetMs('resting', 2), passBudgetMs('resting', 3), passBudgetMs('resting', 0)])
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
        secret: 'f3a9',
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
      '--path=/f3a9',
    ])
    expect(pinnedBrowserEndpoint(4100, 'f3a9')).toBe('ws://127.0.0.1:4100/f3a9')
  })

  it('shares the host network instead of publishing a port where the host network reaches loopback', () => {
    const hostArguments: readonly string[] = pinnedBrowserServerArguments({
      image: 'mcr.microsoft.com/playwright:v1.64.1-noble',
      name: 'ploaness-browsers-4100',
      port: 4100,
      playwrightCore: '/repo/node_modules/playwright-core',
      isHostNetwork: true,
      secret: 'f3a9',
    })
    expect([
      hostArguments.includes('--network=host'),
      hostArguments.some((part: string): boolean => part.startsWith('--publish')),
      hostArguments.at(-2),
    ]).toEqual([true, false, '--host=127.0.0.1'])
  })
})
