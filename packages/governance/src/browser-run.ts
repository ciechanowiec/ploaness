// How a browser verification run is made reproducible and bounded: the clock it runs at, the pinned
// browsers it connects to, the engines it measures in, and the time each pass may take.

/** The variable naming the instant the application's clock starts at, or absent for the real clock. */
export const CLOCK_ENVIRONMENT_VARIABLE: string = 'PLOANESS_CLOCK'

/**
 * The instant every verification run starts its clocks at.
 *
 * Far in the future on purpose. The browser's cookie store keeps real time, so a shifted server that
 * believed it was earlier than now would set absolute cookie expiries the browser already considers
 * past, and every sign-in would fail. Noon, so that a run lasting hours still sees one date.
 */
export const DEFAULT_CLOCK_INSTANT: string = '2100-01-01T12:00:00.000Z'

/** The clock setting that leaves every clock real. */
export const REAL_CLOCK: string = 'real'

const ISO_INSTANT: RegExp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/u

/**
 * The clock a project declared: an ISO instant, `"real"`, or the default instant for anything else.
 * @param declared the raw `ploaness.clock` value.
 * @returns the ISO instant to start at, or `"real"`.
 */
export const clockOf = (declared: unknown): string => {
  if (declared === REAL_CLOCK) {
    return REAL_CLOCK
  }
  return typeof declared === 'string' && ISO_INSTANT.test(declared) && !Number.isNaN(Date.parse(declared))
    ? new Date(Date.parse(declared)).toISOString()
    : DEFAULT_CLOCK_INSTANT
}

/**
 * The time a shifted clock reads: the instant it started at, advanced by the real time since.
 * @param instantMs the instant the clock started at.
 * @param startedMs the real time it started.
 * @param realMs the real time now.
 * @returns the shifted time now.
 */
export const shiftedTime = (instantMs: number, startedMs: number, realMs: number): number =>
  instantMs + (realMs - startedMs)

/** The variable naming the pinned browser server the suite connects to. */
export const BROWSER_ENDPOINT_ENVIRONMENT_VARIABLE: string = 'PLOANESS_BROWSER_ENDPOINT'

/**
 * The pinned Playwright image whose browsers a verification run measures in.
 * @param version the `@playwright/test` version ploaness pins.
 * @returns the image reference.
 */
export const playwrightImageOf = (version: string): string => `mcr.microsoft.com/playwright:v${version}-noble`

/** The engines a verification run measures in. Outside verification only the first runs. */
export const BROWSER_ENGINES: readonly string[] = ['chromium', 'firefox', 'webkit']

/** The passes the sweep runs, in order. */
export type SweepPass =
  | 'discovery'
  | 'resting'
  | 'interaction'
  | 'disclosures'
  | 'text-stress'
  | 'width-sweep'
  | 'dark-scheme'
  | 'engine'

// What one unit of each pass's work may cost, in milliseconds. A unit is what the pass multiplies:
// a route for discovery, a page at one viewport for the passes that load pages, a control at one
// viewport for the interaction pass, a width for the sweep.
const ALLOWANCES_MS: Readonly<Record<SweepPass, number>> = {
  discovery: 30_000,
  resting: 12_000,
  interaction: 5000,
  disclosures: 8000,
  'text-stress': 15_000,
  'width-sweep': 2000,
  'dark-scheme': 10_000,
  engine: 15_000,
}

// What a pass costs before its first unit: starting the browser and loading its plan.
const PASS_OVERHEAD_MS: number = 60_000

/** The rule a pass that ran out of time reports. */
export const PASS_BUDGET_RULE: string = 'pass-budget'

/**
 * The time a pass may take, derived from the work it discovered.
 * @param pass the pass.
 * @param units how many units of work it has.
 * @returns its budget in milliseconds.
 */
export const passBudgetMs = (pass: SweepPass, units: number): number =>
  PASS_OVERHEAD_MS + ALLOWANCES_MS[pass] * Math.max(0, units)

// Every sweep test loads its pages fresh and judges each one alone, so which worker runs it, and what
// runs beside it, cannot change a verdict. The project's own specs are held to one worker separately,
// because they may share database state.
/** The workers a browser run spreads the sweep's tests over. */
export const SWEEP_WORKERS: number = 4

/** How many tests each sweep pass is split into, so its parts run on parallel workers. */
export const SWEEP_SHARDS: number = 4

/** One part of a sweep pass: its zero-based index among `count` parts. */
export interface Shard {
  readonly index: number
  readonly count: number
}

/** An item a shard visits, with its index in the whole pass. */
export interface ShardItem<Item> {
  readonly item: Item
  readonly index: number
}

/**
 * The items one shard of a pass visits, dealt round-robin so every shard gets a similar mix.
 * @param items every item of the pass, in order.
 * @param shard the shard.
 * @returns the shard's items, each with its index in the whole pass.
 */
export const shardOf = <Item>(items: readonly Item[], shard: Shard): readonly ShardItem<Item>[] =>
  items.flatMap((item: Item, index: number): readonly ShardItem<Item>[] =>
    index % shard.count === shard.index ? [{ item, index }] : [],
  )

/** Where the container sees the host's Playwright, mounted read-only. */
const CONTAINER_PLAYWRIGHT: string = '/ploaness/playwright-core'

/** What starting the pinned browser server needs to know. */
export interface PinnedBrowserServer {
  readonly image: string
  readonly name: string
  readonly port: number
  /** The host's resolved `playwright-core` directory, which the container runs. */
  readonly playwrightCore: string
  /**
   * Whether the container shares the host's network. It then reaches the application's loopback
   * origins directly; otherwise every request a page makes travels through the client's tunnel, which
   * costs several times the load itself.
   */
  readonly isHostNetwork: boolean
}

/** The variable telling the suite its pinned browsers reach the application only through the tunnel. */
export const BROWSER_TUNNEL_ENVIRONMENT_VARIABLE: string = 'PLOANESS_BROWSER_TUNNEL'

/**
 * The `docker` arguments that start the pinned browser server.
 *
 * The container runs the host's own `playwright-core` against the image's browsers, so nothing is
 * fetched at test time and the protocol on both ends is one version. It listens on loopback only: on the
 * host's own when the container shares the host network, or on a port published to it.
 * @param server the server to start.
 * @returns the arguments after `docker`.
 */
export const pinnedBrowserServerArguments = (server: PinnedBrowserServer): readonly string[] => [
  'run',
  '--detach',
  '--rm',
  '--init',
  '--ipc=host',
  `--name=${server.name}`,
  server.isHostNetwork ? '--network=host' : `--publish=127.0.0.1:${String(server.port)}:${String(server.port)}`,
  `--volume=${server.playwrightCore}:${CONTAINER_PLAYWRIGHT}:ro`,
  '--workdir=/tmp',
  server.image,
  'node',
  `${CONTAINER_PLAYWRIGHT}/cli.js`,
  'run-server',
  `--port=${String(server.port)}`,
  server.isHostNetwork ? '--host=127.0.0.1' : '--host=0.0.0.0',
]

/**
 * The endpoint the suite connects to.
 * @param port the published port.
 * @returns the WebSocket URL.
 */
export const pinnedBrowserEndpoint = (port: number): string => `ws://127.0.0.1:${String(port)}/`
