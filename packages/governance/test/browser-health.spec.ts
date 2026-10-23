import { describe, expect, it } from 'vitest'
import {
  allowedOrigins,
  consolePageError,
  isAllowedRequest,
  isFailedStatus,
  reportedText,
} from '../src/browser-health.js'

const ORIGINS: readonly string[] = allowedOrigins(['http://localhost:3100', 'http://localhost:3000/', 'not a url'])

describe('the browser network guard', () => {
  it('derives each allowed origin once from the server URLs', () => {
    expect(ORIGINS).toEqual(['http://localhost:3100', 'http://localhost:3000'])
  })

  it('lets the application, its auxiliary servers and in-browser URLs through', () => {
    expect(
      [
        'http://localhost:3100/_next/app.js',
        'http://localhost:3000/api/media/a.png',
        'data:image/png;base64,AA',
        'blob:x',
      ].map((url: string): boolean => isAllowedRequest(url, ORIGINS)),
    ).toEqual([true, true, true, true])
  })

  it('blocks a third-party host, another port and an unparsable URL', () => {
    expect(
      ['https://fonts.googleapis.com/css2', 'http://localhost:4000/', '::'].map((url: string): boolean =>
        isAllowedRequest(url, ORIGINS),
      ),
    ).toEqual([false, false, false])
  })
})

describe('console page errors', () => {
  it('reports every console.error and every hydration warning', () => {
    expect([
      consolePageError({ type: 'error', text: 'TypeError: x is undefined' }),
      consolePageError({ type: 'warning', text: 'A tree hydrated but some attributes did not match' }),
    ]).toEqual([
      'console.error: TypeError: x is undefined',
      'hydration warning: A tree hydrated but some attributes did not match',
    ])
  })

  it('leaves a failed resource to the failed-request rule, and ignores other messages', () => {
    expect([
      consolePageError({ type: 'error', text: 'Failed to load resource: the server responded with a status of 404' }),
      consolePageError({ type: 'warning', text: 'deprecated option' }),
      consolePageError({ type: 'log', text: 'ready' }),
    ]).toEqual([undefined, undefined, undefined])
  })

  it('cuts a long message to its first line', () => {
    expect([reportedText(` ${'a'.repeat(301)}\nstack`), reportedText('short\nstack')]).toEqual([
      `${'a'.repeat(300)}...`,
      'short',
    ])
  })
})

describe('failed responses', () => {
  it('fails a 4xx or 5xx status and passes a redirect', () => {
    expect([404, 500, 302, 200].map((status: number): boolean => isFailedStatus(status))).toEqual([
      true,
      true,
      false,
      false,
    ])
  })
})
