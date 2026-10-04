import { describe, expect, it } from 'vitest'
import {
  type BrowserServerEndpoint,
  browserServerConnectionFailure,
  browserServerEndpoint,
  browserServerProblem,
  canReuseBrowserServer,
  combineBrowserServerProbes,
} from '../src/browser-server-policy.js'
import { VERIFICATION_ENVIRONMENT_VARIABLE } from '../src/wiring-policy.js'

describe('browser server reuse', () => {
  it('allows a direct local run to reuse its servers', () => {
    expect(canReuseBrowserServer({})).toBe(true)
    expect(canReuseBrowserServer({ CI: '' })).toBe(true)
  })

  it.each(['1', '0', ''])('refuses verification reuse even with marker %j', (marker: string) => {
    expect(canReuseBrowserServer({ [VERIFICATION_ENVIRONMENT_VARIABLE]: marker })).toBe(false)
  })

  it.each(['true', '1', 'false'])('preserves the CI prohibition for CI=%s', (value: string) => {
    expect(canReuseBrowserServer({ CI: value })).toBe(false)
    expect(canReuseBrowserServer({ CI: value, [VERIFICATION_ENVIRONMENT_VARIABLE]: '1' })).toBe(false)
  })
})

describe('browser server endpoints', () => {
  it.each([
    ['http://localhost:3000', 'localhost', 3000],
    ['http://127.0.0.1:4820/health', '127.0.0.1', 4820],
    ['http://localhost/health', 'localhost', 80],
    ['https://localhost/health', 'localhost', 443],
    ['http://[::1]:3100/health', '::1', 3100],
  ])('finds the TCP endpoint of %s', (url: string, host: string, port: number) => {
    expect(browserServerEndpoint(url)).toEqual({ url, host, port })
  })

  it.each(['not a url', 'file:///tmp/server', 'http://localhost:0', 'http://localhost:99999'])(
    'rejects a URL that cannot identify a browser server: %s',
    (url: string) => {
      expect(() => browserServerEndpoint(url)).toThrow()
    },
  )
})

describe('browser server probe evidence', () => {
  it('accepts only an explicit connection refusal as vacancy', () => {
    expect(browserServerConnectionFailure('ECONNREFUSED', 'refused')).toEqual({ status: 'vacant' })
    expect(browserServerConnectionFailure('EACCES', 'permission denied')).toEqual({
      status: 'unknown',
      detail: 'permission denied',
    })
    expect(browserServerConnectionFailure(undefined, 'unexplained failure')).toEqual({
      status: 'unknown',
      detail: 'unexplained failure',
    })
  })

  it('requires refusal from every resolved address', () => {
    expect(combineBrowserServerProbes([{ status: 'vacant' }, { status: 'vacant' }])).toEqual({
      status: 'vacant',
    })
    expect(combineBrowserServerProbes([{ status: 'vacant' }, { status: 'unknown', detail: 'timeout' }])).toEqual({
      status: 'unknown',
      detail: 'timeout',
    })
    expect(combineBrowserServerProbes([])).toEqual({
      status: 'unknown',
      detail: 'the hostname resolved to no addresses',
    })
  })

  it('reports any listener even when another address is vacant or inconclusive', () => {
    expect(combineBrowserServerProbes([{ status: 'vacant' }, { status: 'occupied' }])).toEqual({
      status: 'occupied',
    })
    expect(combineBrowserServerProbes([{ status: 'occupied' }, { status: 'unknown', detail: 'timeout' }])).toEqual({
      status: 'occupied',
    })
  })
})

describe('browser server repair messages', () => {
  const endpoint: BrowserServerEndpoint = browserServerEndpoint('http://localhost:3000')

  it('has no finding when the endpoint is vacant', () => {
    expect(browserServerProblem(endpoint, { status: 'vacant' })).toBeUndefined()
  })

  it('names the occupied port and tells the user to stop the existing server', () => {
    expect(browserServerProblem(endpoint, { status: 'occupied' })).toBe(
      'port 3000 at http://localhost:3000 is in use; stop the existing server before rerunning verification',
    )
  })

  it('retains the cause when vacancy could not be established', () => {
    expect(browserServerProblem(endpoint, { status: 'unknown', detail: 'lookup failed' })).toBe(
      'cannot check port 3000 at http://localhost:3000: lookup failed; ' +
        'fix the address or connectivity and rerun verification',
    )
  })
})
