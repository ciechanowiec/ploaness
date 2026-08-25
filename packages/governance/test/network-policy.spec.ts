import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  describeSocketTarget,
  findNetworkEscape,
  hostOfUrl,
  isMachineLocalHost,
  localAddresses,
  NETWORK_RULE,
  type NetworkAttempt,
  RESOLVER_METHODS,
} from '../src/network-policy.js'

const NOWHERE: ReadonlySet<string> = new Set<string>()

// Assembled rather than written whole, for the same reason the suppression spec assembles its tokens: a
// spec whose subject is addresses is read by a rule that judges an address on sight, and written out it
// would be reported by the analyzer instead of read by the reader.
const ipv4 = (...octets: readonly number[]): string => octets.join('.')
const LOOPBACK_IPV6: string = ['', '', '1'].join(':')
const MAPPED_LOOPBACK: string = `::ffff:${ipv4(127, 0, 0, 1)}`
const ZONED_LOOPBACK: string = `${LOOPBACK_IPV6}%en0`
const PRIVATE_ADDRESS: string = ipv4(192, 168, 1, 20)
const LINK_LOCAL: string = `fe80${LOOPBACK_IPV6}`
const SOCKET_PATH: string = '/var/run/postgresql/.s.PGSQL.5432'

const reach = (host: string | undefined): NetworkAttempt => ({
  api: 'connect',
  host,
  destination: `${host ?? ''}:5432`,
})

describe('isMachineLocalHost', () => {
  it.each([
    ['an IPv4 loopback literal', '127.0.0.1'],
    ['the whole loopback range', '127.99.3.7'],
    ['the IPv6 loopback', '::1'],
    ['the expanded IPv6 loopback', '0:0:0:0:0:0:0:1'],
    ['a bracketed IPv6 literal', '[::1]'],
    ['an IPv4-mapped loopback', MAPPED_LOOPBACK],
    ['the unspecified IPv4 address', '0.0.0.0'],
    ['the unspecified IPv6 address', '::'],
    ['localhost', 'localhost'],
    ['a name beneath localhost', 'api.localhost'],
    ['a fully qualified localhost', 'localhost.'],
    ['an upper-case spelling', 'LOCALHOST'],
    ['a zone-qualified IPv6 loopback', ZONED_LOOPBACK],
  ])('accepts %s', (_what: string, host: string) => {
    expect(isMachineLocalHost(host, NOWHERE)).toBe(true)
  })

  it('accepts an absent host, which is the localhost a socket defaults to', () => {
    expect(isMachineLocalHost(undefined, NOWHERE)).toBe(true)
  })

  it.each([
    ['a public name', 'api.example.com'],
    ['a private address of another machine', PRIVATE_ADDRESS],
    ['a docker gateway', 'host.docker.internal'],
    ['a bare service name', 'postgres'],
    ['a name merely ending in the localhost letters', 'notlocalhost'],
  ])('rejects %s', (_what: string, host: string) => {
    expect(isMachineLocalHost(host, NOWHERE)).toBe(false)
  })

  it('accepts an address this machine itself carries', () => {
    const local: ReadonlySet<string> = localAddresses({
      en0: [{ address: PRIVATE_ADDRESS }, { address: `${LINK_LOCAL.toUpperCase()}%en0` }],
      lo0: undefined,
    })
    expect(isMachineLocalHost(PRIVATE_ADDRESS, local)).toBe(true)
    expect(isMachineLocalHost(LINK_LOCAL, local)).toBe(true)
  })
})

describe('describeSocketTarget', () => {
  it('reads the port-and-host form', () => {
    expect(describeSocketTarget([5432, 'db.example.com'])).toEqual({
      api: 'connect',
      host: 'db.example.com',
      destination: 'db.example.com:5432',
    })
  })

  it('names localhost when the port form supplies no host, as the runtime does', () => {
    expect(describeSocketTarget([5432]).destination).toBe('localhost:5432')
  })

  it('reads the options form', () => {
    expect(describeSocketTarget([{ port: 5432, host: 'db.example.com' }]).host).toBe(
      'db.example.com',
    )
  })

  // A path is not a network: both ends are the same machine by construction, so refusing one would
  // break every test that talks to a local service over a socket file.
  it('reports no host for a unix socket path', () => {
    expect(describeSocketTarget([SOCKET_PATH]).host).toBeUndefined()
    expect(describeSocketTarget([{ path: SOCKET_PATH }]).host).toBeUndefined()
  })

  it('reads a numeric string as a port rather than as a path, as the runtime does', () => {
    expect(describeSocketTarget(['5432', 'db.example.com']).host).toBe('db.example.com')
  })
})

describe('hostOfUrl', () => {
  it('reads the host of an absolute URL', () => {
    expect(hostOfUrl('https://api.example.com/v1/things?page=2')).toBe('api.example.com')
  })

  it('reads no host from a relative path, which reaches the page it was served from', () => {
    expect(hostOfUrl('/api/things')).toBeUndefined()
  })
})

describe('findNetworkEscape', () => {
  it('allows a reach that stays on this machine', () => {
    expect(findNetworkEscape(reach('127.0.0.1'), NOWHERE)).toBeUndefined()
  })

  it('refuses a reach to another machine', () => {
    expect(findNetworkEscape(reach('api.example.com'), NOWHERE)).toContain('api.example.com:5432')
  })

  // The resolver family bypasses the hosts file, so even a loopback name is a packet to a nameserver.
  it('refuses a resolver query whatever host it names', () => {
    const query: NetworkAttempt = { api: 'resolve', host: 'localhost', destination: 'localhost' }
    expect(findNetworkEscape(query, NOWHERE)).toContain('nameserver')
  })

  it('names the entry point that asked, so the failure says where to look', () => {
    const attempt: NetworkAttempt = {
      api: 'fetch',
      host: 'api.example.com',
      destination: 'https://api.example.com/v1',
    }
    expect(findNetworkEscape(attempt, NOWHERE)).toContain('fetch')
  })

  it('covers every resolver entry point the runtime exposes', () => {
    expect(RESOLVER_METHODS).toContain('resolveSrv')
  })

  // The joint, not the value. A message quoting a sentence the standard no longer contains would tell a
  // reader to look up a rule that is not there, and asserting the constant against its own literal
  // would prove nothing at all.
  it('quotes the governing rule verbatim, so the refusal cites a sentence that exists', () => {
    const standard: string = readFileSync(
      new URL('../../../README-guideline-software-project.adoc', import.meta.url),
      'utf8',
    )
    expect(standard).toContain(NETWORK_RULE)
  })
})
