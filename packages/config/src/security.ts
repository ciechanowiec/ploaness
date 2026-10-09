import { expect } from '@playwright/test'
import { securityHeaderProblems } from '@ploaness/governance'

/** Both Playwright navigation responses and request responses expose this surface. */
export interface SecurityResponse {
  readonly headers: () => Record<string, string>
  readonly url: () => string
}

/** Assert the existing HTML response baseline using the response that the test actually received. */
export const expectSecurityHeaders = (response: SecurityResponse): void => {
  expect(securityHeaderProblems(response.headers()), `security headers on ${response.url()}`).toEqual([])
}
