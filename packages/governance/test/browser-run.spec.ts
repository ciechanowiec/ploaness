import { describe, expect, it } from 'vitest'
import {
  type BrowserServerOwner,
  clockOf,
  DEFAULT_CLOCK_INSTANT,
  isOrphanedBrowserServer,
  itemLimitMs,
  listedBrowserServers,
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

const OWNER: BrowserServerOwner = { pid: 4321, started: 'Mon Oct 26 09:52:44 2026', host: 'builder' }

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
        owner: OWNER,
      }),
    ).toEqual([
      'run',
      '--detach',
      '--rm',
      '--init',
      '--ipc=host',
      '--name=ploaness-browsers-4100',
      '--label=ploaness.owner.pid=4321',
      '--label=ploaness.owner.started=Mon Oct 26 09:52:44 2026',
      '--label=ploaness.owner.host=builder',
      '--publish=127.0.0.1:4100:4100',
      '--volume=/repo/node_modules/playwright-core:/ploaness/playwright-core:ro',
      '--env=MOZ_WEBGL_FORCE_EGL=1',
      '--workdir=/tmp',
      'mcr.microsoft.com/playwright:v1.64.1-noble',
      'sh',
      '-c',
      'for config in /ms-playwright/firefox-*/firefox/playwright.cfg; do ' +
        String.raw`printf "\npref(\"webgl.force-enabled\", true);\n" >> "$config"; done; ` +
        'exec node "$0" run-server "$@"',
      '/ploaness/playwright-core/cli.js',
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
      owner: OWNER,
    })
    expect([
      hostArguments.includes('--network=host'),
      hostArguments.some((part: string): boolean => part.startsWith('--publish')),
      hostArguments.at(-2),
    ]).toEqual([true, false, '--host=127.0.0.1'])
  })
})

describe('a browser server left behind by its run', () => {
  it('is read from the listing with its owner, and without one when a label is missing', () => {
    expect(
      listedBrowserServers(
        [
          'ploaness-browsers-4100|4321|Mon Oct 26 09:52:44 2026|builder',
          '',
          'ploaness-browsers-4200||Mon Oct 26 09:52:44 2026|builder',
          'ploaness-browsers-4300|0|Mon Oct 26 09:52:44 2026|builder',
        ].join('\n'),
      ),
    ).toEqual([
      { name: 'ploaness-browsers-4100', owner: OWNER },
      { name: 'ploaness-browsers-4200', owner: undefined },
      { name: 'ploaness-browsers-4300', owner: undefined },
    ])
  })

  it('is an orphan once no process holds its owner PID, or one that started at another time does', () => {
    expect([
      isOrphanedBrowserServer(OWNER, 'builder', undefined),
      isOrphanedBrowserServer(OWNER, 'builder', 'Mon Oct 26 10:01:07 2026'),
    ]).toEqual([true, true])
  })

  it('is kept while its owner runs, and whenever it was started on another machine', () => {
    expect([
      isOrphanedBrowserServer(OWNER, 'builder', OWNER.started),
      isOrphanedBrowserServer(OWNER, 'another-machine', undefined),
    ]).toEqual([false, false])
  })
})

describe('the time one item of a pass may take', () => {
  it('is a minute at least, so a page that hangs costs a minute rather than the whole budget of its part', () => {
    expect([itemLimitMs('engine', 1), itemLimitMs('resting', 1), itemLimitMs('width-sweep', 0)]).toEqual([
      60_000, 60_000, 60_000,
    ])
  })

  it('grows with the work an item carries, so a page with many controls is not cut short', () => {
    expect([itemLimitMs('interaction', 21), itemLimitMs('width-sweep', 50)]).toEqual([420_000, 400_000])
  })
})
