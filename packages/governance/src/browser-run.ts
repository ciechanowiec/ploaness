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
// viewport for the interaction and disclosure passes, a width for the sweep. A disclosure visit costs in
// proportion to the controls on the page: a story with eight of them took four seconds and one with 192
// over a minute, so a fixed cost per page left the heavy ones short of both their item's limit and the
// part's budget.
const ALLOWANCES_MS: Readonly<Record<SweepPass, number>> = {
  discovery: 30_000,
  resting: 12_000,
  interaction: 5000,
  disclosures: 1000,
  'text-stress': 15_000,
  'width-sweep': 2000,
  'dark-scheme': 10_000,
  engine: 15_000,
}

// What a pass costs before its first unit: starting the browser and loading its plan.
const PASS_OVERHEAD_MS: number = 60_000

/** The rule a pass that ran out of time reports. */
export const PASS_BUDGET_RULE: string = 'pass-budget'

/** The rule an item reports when its visit did not finish within the item's limit. */
export const ITEM_LIMIT_RULE: string = 'item-limit'

// An item may take this many times its pass's allowance, and never less than the floor: generous enough
// for a slow agent, while a page that hangs - an axe run that never returns - holds its part for a
// minute or so rather than for the part's whole budget.
const ITEM_ALLOWANCE_FACTOR: number = 4
const ITEM_LIMIT_FLOOR_MS: number = 60_000

/**
 * The time one item of a pass may take before the part gives up on it and moves on.
 * @param pass the pass.
 * @param units how many units of work the item carries.
 * @returns the limit in milliseconds.
 */
export const itemLimitMs = (pass: SweepPass, units: number): number =>
  Math.max(ITEM_LIMIT_FLOOR_MS, ITEM_ALLOWANCE_FACTOR * ALLOWANCES_MS[pass] * Math.max(1, units))

/**
 * The time a pass may take, derived from the work it discovered.
 * @param pass the pass.
 * @param units how many units of work it has.
 * @returns its budget in milliseconds.
 */
export const passBudgetMs = (pass: SweepPass, units: number): number =>
  PASS_OVERHEAD_MS + ALLOWANCES_MS[pass] * Math.max(0, units)

// Every sweep test loads its pages fresh and judges each one alone, so which worker runs it, and what
// runs beside it, cannot change a verdict; the project's own specs are held to one worker separately,
// because they may share database state. The parts of a pass share one queue, so the sweep takes about
// as long as its work divided by the workers, and a machine with more to give should give it: a worker
// for every two processors and every two gigabytes of memory - a browser at work holds about one - but
// never fewer than four, which a hosted agent with four processors and sixteen gigabytes runs today,
// and never more than eight, beyond which one browser server is the limit rather than the machine.
const MIN_SWEEP_WORKERS: number = 4
const MAX_SWEEP_WORKERS: number = 8
const PROCESSORS_PER_WORKER: number = 2
const BYTES_PER_GIBIBYTE: number = 1_073_741_824
const GIBIBYTES_PER_WORKER: number = 2

/**
 * How many workers a browser run spreads the sweep over, and so how many parts each pass has.
 * @param processors the processors the machine offers.
 * @param memoryBytes the memory it has.
 * @returns the workers, between four and eight.
 */
export const sweepWorkersFor = (processors: number, memoryBytes: number): number => {
  const byProcessors: number = Math.floor(processors / PROCESSORS_PER_WORKER)
  const byMemory: number = Math.floor(memoryBytes / (GIBIBYTES_PER_WORKER * BYTES_PER_GIBIBYTE))
  return Math.min(MAX_SWEEP_WORKERS, Math.max(MIN_SWEEP_WORKERS, Math.min(byProcessors, byMemory)))
}

/** What a machine offers the sweep. */
export interface MachineCapacity {
  readonly processors: number
  readonly memoryBytes: number
}

/** The variable carrying the workers a run decided on to the suite and each of its workers. */
export const SWEEP_WORKERS_ENVIRONMENT_VARIABLE: string = 'PLOANESS_SWEEP_WORKERS'

/** The `docker` arguments that report the processors and memory the browsers' machine has. */
export const dockerCapacityArguments: readonly string[] = ['info', '--format', '{{.NCPU}} {{.MemTotal}}']

/**
 * Read what `dockerCapacityArguments` reports.
 * @param output what `docker` wrote.
 * @returns the capacity, or undefined when the output is not two positive whole numbers.
 */
export const dockerCapacityOf = (output: string): MachineCapacity | undefined => {
  const [processors, memoryBytes]: readonly number[] = output.trim().split(/\s+/u).map(Number)
  return processors !== undefined && memoryBytes !== undefined && processors > 0 && memoryBytes > 0
    ? { processors, memoryBytes }
    : undefined
}

/**
 * The workers a run can give the sweep: the fewer of what the host affords, where the runner, the servers
 * and the test workers live, and what the browsers' machine affords. On Linux the two are one machine;
 * Docker Desktop and Colima run the browsers in a virtual machine smaller than the host, and eight
 * browsers in a machine of nine processors made every pass slower than four did.
 * @param host the machine the run starts on.
 * @param browsers the machine the browsers run on, when it is known.
 * @returns the workers.
 */
export const sweepWorkersAcross = (host: MachineCapacity, browsers: MachineCapacity | undefined): number =>
  Math.min(
    sweepWorkersFor(host.processors, host.memoryBytes),
    browsers === undefined ? MAX_SWEEP_WORKERS : sweepWorkersFor(browsers.processors, browsers.memoryBytes),
  )

/**
 * The workers a run decided on, as its environment carries them.
 * @param value the variable's value.
 * @returns the workers, or undefined when the value is not a worker count the sweep allows.
 */
export const declaredSweepWorkers = (value: string | undefined): number | undefined => {
  const workers: number = Number(value)
  return Number.isSafeInteger(workers) && workers >= MIN_SWEEP_WORKERS && workers <= MAX_SWEEP_WORKERS
    ? workers
    : undefined
}

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
 * The time one part of a pass may take. The parts take the pass's items from one queue, so each does an
 * equal share of the work whatever items it happens to take.
 * @param pass the pass.
 * @param units how many units of work the whole pass has.
 * @param shard the part.
 * @returns its budget in milliseconds.
 */
export const partBudgetMs = (pass: SweepPass, units: number, shard: Shard): number =>
  passBudgetMs(pass, Math.ceil(units / shard.count))

// The pinned WebKit draws every page in software, so a heavy page holds a processor for seconds per frame,
// and as many such pages at once as the sweep has workers starve one another until one stops answering.
// Its engine pass runs in half as many parts, each with the budget of its larger share.
const SOFTWARE_DRAWN_ENGINE: string = 'webkit'
const SOFTWARE_DRAWN_SHARE: number = 2

/**
 * How many parts an engine's engine pass runs in.
 * @param engine the engine.
 * @param parts the parts every other pass runs in.
 * @returns the parts, at least one.
 */
export const enginePassParts = (engine: string, parts: number): number =>
  engine === SOFTWARE_DRAWN_ENGINE ? Math.max(1, Math.floor(parts / SOFTWARE_DRAWN_SHARE)) : parts

/** Where the container sees the host's Playwright, mounted read-only. */
const CONTAINER_PLAYWRIGHT: string = '/ploaness/playwright-core'

/**
 * The run that started a pinned browser server, recorded on its container. A run that is killed outright
 * cannot remove its container, so a later run removes it instead once this owner is gone.
 */
export interface BrowserServerOwner {
  readonly pid: number
  /** When the owner process started, as `ps` reports it, which a process that later reuses the PID does not share. */
  readonly started: string
  /** The machine the owner ran on: a PID means nothing on another machine sharing the Docker engine. */
  readonly host: string
}

/** The container labels that record a browser server's owner. */
export const BROWSER_SERVER_OWNER_LABELS: Readonly<Record<keyof BrowserServerOwner, string>> = {
  pid: 'ploaness.owner.pid',
  started: 'ploaness.owner.started',
  host: 'ploaness.owner.host',
}

const LISTING_SEPARATOR: string = '|'

/** The `docker` arguments that list every browser server recording its owner, one per line. */
export const browserServerListingArguments: readonly string[] = [
  'ps',
  '--all',
  `--filter=label=${BROWSER_SERVER_OWNER_LABELS.pid}`,
  `--format=${[
    '{{.Names}}',
    `{{.Label "${BROWSER_SERVER_OWNER_LABELS.pid}"}}`,
    `{{.Label "${BROWSER_SERVER_OWNER_LABELS.started}"}}`,
    `{{.Label "${BROWSER_SERVER_OWNER_LABELS.host}"}}`,
  ].join(LISTING_SEPARATOR)}`,
]

/** A listed browser server, and its owner when the labels name one completely. */
export interface ListedBrowserServer {
  readonly name: string
  readonly owner: BrowserServerOwner | undefined
}

const ownerOf = (pid: string, started: string, host: string): BrowserServerOwner | undefined =>
  started !== '' && host !== '' && /^[1-9]\d*$/u.test(pid) ? { pid: Number(pid), started, host } : undefined

/**
 * Read the listing `browserServerListingArguments` produces.
 * @param listing what `docker` wrote.
 * @returns each listed server.
 */
export const listedBrowserServers = (listing: string): readonly ListedBrowserServer[] =>
  listing
    .split('\n')
    .filter((line: string): boolean => line.trim() !== '')
    .map((line: string): ListedBrowserServer => {
      const [name = '', pid = '', started = '', host = '']: readonly string[] = line.split(LISTING_SEPARATOR)
      return { name: name.trim(), owner: ownerOf(pid.trim(), started.trim(), host.trim()) }
    })

/**
 * Whether a browser server was left behind by a run that no longer exists. Only a server started on this
 * machine is judged, and its owner is gone when no process holds the PID or the one holding it started at
 * another time.
 * @param owner the owner recorded on the container.
 * @param host this machine's name.
 * @param running when the process now holding the owner's PID started, or undefined when none does.
 * @returns true when the server may be removed.
 */
export const isOrphanedBrowserServer = (
  owner: BrowserServerOwner,
  host: string,
  running: string | undefined,
): boolean => running !== owner.started && owner.host === host

/** What starting the pinned browser server needs to know. */
export interface PinnedBrowserServer {
  readonly image: string
  readonly name: string
  readonly port: number
  readonly owner: BrowserServerOwner
  /** The host's resolved `playwright-core` directory, which the container runs. */
  readonly playwrightCore: string
  /**
   * Whether the container shares the host's network. It then reaches the application's loopback
   * origins directly; otherwise every request a page makes travels through the client's tunnel, which
   * costs several times the load itself.
   */
  readonly isHostNetwork: boolean
  /**
   * A random path the server answers on. The port is free when it is chosen and taken by the container
   * a moment later, so another local process could take it first and pose as the browser server; it
   * cannot complete the handshake on a path it was never told.
   */
  readonly secret: string
}

// Headless Firefox in the image finds no native OpenGL and draws no WebGL at all, while Chromium and
// WebKit draw it in software, so the Firefox pass judged a page without its WebGL effects - which almost
// no Firefox visitor sees - and reported the error a WebGL library logs without a context. Given EGL by
// the environment and WebGL forced on in the autoconfig file Playwright's Firefox reads, it draws WebGL
// through the image's Mesa as the other engines do. The preference is written inside the container
// before the server starts, so no client has to send it: a server that accepted client preferences would
// accept a client's choice of executable as well.
const FIREFOX_WEBGL: string =
  'for config in /ms-playwright/firefox-*/firefox/playwright.cfg; do ' +
  String.raw`printf "\npref(\"webgl.force-enabled\", true);\n" >> "$config"; done; ` +
  'exec node "$0" run-server "$@"'

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
  `--label=${BROWSER_SERVER_OWNER_LABELS.pid}=${String(server.owner.pid)}`,
  `--label=${BROWSER_SERVER_OWNER_LABELS.started}=${server.owner.started}`,
  `--label=${BROWSER_SERVER_OWNER_LABELS.host}=${server.owner.host}`,
  server.isHostNetwork ? '--network=host' : `--publish=127.0.0.1:${String(server.port)}:${String(server.port)}`,
  `--volume=${server.playwrightCore}:${CONTAINER_PLAYWRIGHT}:ro`,
  // The EGL path Firefox needs for software WebGL; see FIREFOX_WEBGL.
  '--env=MOZ_WEBGL_FORCE_EGL=1',
  '--workdir=/tmp',
  server.image,
  // The port and the path travel as arguments of the script rather than inside it, so nothing a run
  // chooses is ever read as shell.
  'sh',
  '-c',
  FIREFOX_WEBGL,
  `${CONTAINER_PLAYWRIGHT}/cli.js`,
  `--port=${String(server.port)}`,
  server.isHostNetwork ? '--host=127.0.0.1' : '--host=0.0.0.0',
  `--path=/${server.secret}`,
]

/**
 * The endpoint the suite connects to.
 * @param port the published port.
 * @param secret the path the server answers on.
 * @returns the WebSocket URL.
 */
export const pinnedBrowserEndpoint = (port: number, secret: string): string =>
  `ws://127.0.0.1:${String(port)}/${secret}`
