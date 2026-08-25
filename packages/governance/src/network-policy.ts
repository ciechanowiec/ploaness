// The determinism rule that a test reaches no network beyond the machine it runs on, expressed as a
// decision rather than as prose in the agent guide.
//
// The rule was checkable all along: a test that leaves the machine has to go through a socket, a
// resolver, or fetch, and each of those hands the destination to the runtime before anything is sent.
// What was missing was somewhere to put the verdict. This module is that place, and it performs no I/O -
// the caller reads `os.networkInterfaces()` and intercepts the entry points, then asks here.
//
// The decision is host-shaped rather than allowlist-shaped on purpose. There is no setting that widens
// it, because "the database this suite needs happens to live elsewhere" is the exact case the rule
// exists to reject: a service that exists only outside the machine is exercised through a local
// component that implements its protocol.
import { isRecord } from './json-shapes.js'

/** The sentence of the governing standard this module decides, quoted back in every refusal. */
export const NETWORK_RULE: string = 'A test reaches no network beyond the machine it runs on.'

/** Which runtime entry point asked. Each reaches its verdict differently, so it is data, not a flag. */
export type NetworkApi = 'connect' | 'lookup' | 'resolve' | 'fetch'

/** One attempted reach, normalised from whichever entry point a test called. */
export interface NetworkAttempt {
  readonly api: NetworkApi
  /** The host as the caller wrote it, or undefined for a unix socket, which is not a network at all. */
  readonly host: string | undefined
  /** What a refusal names, for example `127.0.0.1:5432` or `https://api.example.com/v1`. */
  readonly destination: string
}

/** One entry of `os.networkInterfaces()`, narrowed to the single field this module reads. */
export interface NetworkInterfaceAddress {
  readonly address: string
}

/** The resolver entry points, every one of which queries a nameserver rather than reading a hosts file. */
export const RESOLVER_METHODS: readonly string[] = [
  'resolve',
  'resolve4',
  'resolve6',
  'resolveAny',
  'resolveCaa',
  'resolveCname',
  'resolveMx',
  'resolveNaptr',
  'resolveNs',
  'resolvePtr',
  'resolveSoa',
  'resolveSrv',
  'resolveTxt',
  'reverse',
]

// The prefix an IPv4 address wears when it is carried inside an IPv6 one.
const IPV4_MAPPED_PREFIX: string = '::ffff:'

const IPV4_LOOPBACK: RegExp = /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/
const ZONE_SEPARATOR: string = '%'
const OPENING_BRACKET: string = '['
const CLOSING_BRACKET: string = ']'
const DOT: string = '.'
// `localhost` and, per RFC 6761, every name beneath it. Written as two string tests rather than as one
// alternation, because the pattern that expresses it backtracks super-linearly on a long name.
const LOCALHOST: string = 'localhost'

const isLocalhostName = (host: string): boolean =>
  host === LOCALHOST || host.endsWith(`.${LOCALHOST}`)

// The unspecified address and the two spellings of the IPv6 loopback. Both name this machine.
const LOOPBACK_LITERALS: ReadonlySet<string> = new Set([
  '::1',
  '0:0:0:0:0:0:0:1',
  '0.0.0.0',
  '::',
  '0:0:0:0:0:0:0:0',
])

// One canonical spelling for a host, so an address read off this machine's interfaces and a host a test
// wrote compare as equals: lower case, no brackets around an IPv6 literal, no zone identifier, no
// trailing dot, and an IPv4-mapped IPv6 address reduced to the IPv4 address it carries.
// Written with string operations rather than with patterns: every pattern that expresses the same three
// trims backtracks super-linearly on a long host, and a host is attacker-shaped input in a suite that
// reads a URL out of a fixture.
const canonicalHost = (host: string): string => {
  const lowered: string = host
    .toLowerCase()
    .replaceAll(OPENING_BRACKET, '')
    .replaceAll(CLOSING_BRACKET, '')
  const withoutZone: string = lowered.split(ZONE_SEPARATOR)[0] ?? ''
  const rooted: string = withoutZone.endsWith(DOT) ? withoutZone.slice(0, -1) : withoutZone
  return rooted.startsWith(IPV4_MAPPED_PREFIX) ? rooted.slice(IPV4_MAPPED_PREFIX.length) : rooted
}

const isLoopback = (host: string): boolean =>
  IPV4_LOOPBACK.test(host) || LOOPBACK_LITERALS.has(host) || isLocalhostName(host)

/**
 * The addresses that name this machine, read out of an `os.networkInterfaces()` result.
 *
 * A test that connects to the box's own routable address is still on the machine it runs on, so those
 * addresses join the loopback range rather than being refused with everything else.
 * @param interfaces the interface map, as `os.networkInterfaces()` returns it.
 * @returns every address it carries, in the canonical spelling {@link isMachineLocalHost} compares against.
 */
export const localAddresses = (
  interfaces: Readonly<Record<string, readonly NetworkInterfaceAddress[] | undefined>>,
): ReadonlySet<string> =>
  new Set(
    Object.values(interfaces)
      .flatMap(
        (
          entries: readonly NetworkInterfaceAddress[] | undefined,
        ): readonly NetworkInterfaceAddress[] => entries ?? [],
      )
      .map((entry: NetworkInterfaceAddress): string => canonicalHost(entry.address)),
  )

/**
 * Whether a host names the machine the test runs on.
 *
 * A name that is not one of the localhost spellings is refused on its face rather than resolved, because
 * a resolution is itself the thing being refused. That is why a bare service name such as `postgres`,
 * and a docker gateway such as `host.docker.internal`, do not pass: neither can be shown to be this
 * machine without asking a nameserver.
 * @param host the host as the caller wrote it, or undefined when the caller named none.
 * @param local the addresses this machine carries, from {@link localAddresses}.
 * @returns true when the reach stays on this machine.
 */
export const isMachineLocalHost = (
  host: string | undefined,
  local: ReadonlySet<string>,
): boolean => {
  if (host === undefined || host.length === 0) {
    return true
  }
  const canonical: string = canonicalHost(host)
  return isLoopback(canonical) || local.has(canonical)
}

/**
 * The host a URL names.
 *
 * Undefined when the value names no host - a relative path, which under a DOM environment is the page's
 * own origin and reaches nothing, or a string that is not a URL at all.
 * @param rawUrl the value a test passed to fetch.
 * @returns the host, or undefined.
 */
export const hostOfUrl = (rawUrl: string): string | undefined => {
  try {
    return new URL(rawUrl).hostname
  } catch {
    return undefined
  }
}

// A string first argument is a pipe or socket path rather than a port, which is the same reading Node
// itself applies: anything that is not a number names a path.
const isPipeName = (value: string): boolean => Number.isNaN(Number(value))

const describePort = (port: unknown): string =>
  typeof port === 'number' || typeof port === 'string' ? String(port) : ''

const fromOptions = (options: Record<string, unknown>): NetworkAttempt => {
  const socketPath: unknown = options['path']
  if (typeof socketPath === 'string') {
    return { api: 'connect', host: undefined, destination: socketPath }
  }
  const declaredHost: unknown = options['host']
  const host: string | undefined = typeof declaredHost === 'string' ? declaredHost : undefined
  return {
    api: 'connect',
    host,
    destination: `${host ?? LOCALHOST}:${describePort(options['port'])}`,
  }
}

/**
 * Read one `net.Socket.prototype.connect` call, whichever of its three forms the caller used.
 *
 * A unix socket reports no host, because a path is not a network: the two ends are the same machine by
 * construction, and refusing one would break every test that talks to a local service over a socket file.
 * @param callArguments the arguments the call was made with.
 * @returns the attempt, normalised.
 */
export const describeSocketTarget = (callArguments: readonly unknown[]): NetworkAttempt => {
  const [first, second]: readonly unknown[] = callArguments
  if (isRecord(first)) {
    return fromOptions(first)
  }
  if (typeof first === 'string' && isPipeName(first)) {
    return { api: 'connect', host: undefined, destination: first }
  }
  const host: string | undefined = typeof second === 'string' ? second : undefined
  return {
    api: 'connect',
    host,
    destination: `${host ?? LOCALHOST}:${describePort(first)}`,
  }
}

const OFF_MACHINE_REASON: string = 'that host is not this machine'
const RESOLVER_REASON: string =
  'a resolver query is a packet to a nameserver, which no hosts file answers'

const refusal = (attempt: NetworkAttempt, reason: string): string =>
  `${NETWORK_RULE} A test reached ${attempt.destination} through ${attempt.api}, and ${reason}. ` +
  'Run a real component on this machine and point the test at it.'

/**
 * Decide one attempted reach.
 *
 * A resolver query is refused whatever host it names, loopback included. The resolver family bypasses
 * the hosts file and sends a packet to a nameserver, so `resolve4('localhost')` leaves the machine as
 * surely as any other name does.
 * @param attempt the reach to judge.
 * @param local the addresses this machine carries, from {@link localAddresses}.
 * @returns undefined when the reach is allowed, or the message a refusal should carry.
 */
export const findNetworkEscape = (
  attempt: NetworkAttempt,
  local: ReadonlySet<string>,
): string | undefined => {
  if (attempt.api === 'resolve') {
    return refusal(attempt, RESOLVER_REASON)
  }
  return isMachineLocalHost(attempt.host, local) ? undefined : refusal(attempt, OFF_MACHINE_REASON)
}
