// A Next application whose pages read the clock, for the verification clock's contracts. One page is
// prerendered by the build and one is rendered per request; both print the year they saw. A sign-in
// route issues a signed session whose expiry the server checks against its own clock and whose cookie
// carries an absolute expiry the browser checks against its own - the two halves a shifted clock could
// break. The spec it writes reads the expected year from `EXPECTED_YEAR`.
//
// Run after `create-a11y-page.ts`, which gives the case its server address, root layout and Next
// configuration; this replaces its home page with one linking to every page here.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { asRecord } from '@ploaness/governance'

const ARGUMENT_OFFSET: number = 2

const [directory]: readonly (string | undefined)[] = process.argv.slice(ARGUMENT_OFFSET)
if (directory === undefined) {
  throw new Error('Expected a fixture directory')
}

const YEAR_PAGE = (rendering: string): string => `export const dynamic = '${rendering}'

export default function Page(): React.JSX.Element {
  return <main><h1>Clock</h1><p data-testid="year">{String(new Date().getUTCFullYear())}</p></main>
}
`

const SESSION_LIBRARY: string = `import { createHmac } from 'node:crypto'

const SIGNING_MATERIAL = 'ploaness-clock-fixture'
const LIFETIME_MS: number = 2 * 60 * 60 * 1000

const signatureOf = (expiry: string): string => createHmac('sha256', SIGNING_MATERIAL).update(expiry).digest('hex')

export const issueSession = (): { readonly value: string; readonly expires: Date } => {
  const expires: Date = new Date(Date.now() + LIFETIME_MS)
  const expiry: string = String(expires.getTime())
  return { value: expiry + '.' + signatureOf(expiry), expires }
}

export const isLiveSession = (value: string | undefined): boolean => {
  const [expiry = '', signature = ''] = (value ?? '').split('.')
  return signature === signatureOf(expiry) && Number(expiry) > Date.now()
}
`

const SIGN_IN_ROUTE: string = `import { issueSession } from '../../../session'

export function GET(): Response {
  const session = issueSession()
  return new Response(null, {
    status: 303,
    headers: {
      location: '/session/account',
      'set-cookie':
        'session=' + session.value + '; Path=/; HttpOnly; SameSite=Lax; Expires=' + session.expires.toUTCString(),
    },
  })
}
`

const ACCOUNT_PAGE: string = `import { cookies } from 'next/headers'
import { isLiveSession } from '../../../session'

export const dynamic = 'force-dynamic'

export default async function Page(): Promise<React.JSX.Element> {
  const session: string | undefined = (await cookies()).get('session')?.value
  return <main><h1>Account</h1><p>{isLiveSession(session) ? 'Signed in' : 'Signed out'}</p></main>
}
`

const HOME_PAGE: string = `export default function Page(): React.JSX.Element {
  return (
    <main>
      <h1>Clock contract</h1>
      <ul>
        <li><a href="/clock/static">Prerendered year</a></li>
        <li><a href="/clock/dynamic">Rendered year</a></li>
        <li><a href="/session/account">Account</a></li>
      </ul>
    </main>
  )
}
`

const SPEC: string = `import { expect, test } from '@playwright/test'

test('the application runs at the verification clock', async ({ page }) => {
  const year: string = process.env['EXPECTED_YEAR'] ?? ''
  // The worker running this spec reads the same clock as the application it drives.
  expect(String(new Date().getUTCFullYear())).toBe(year)
  await page.goto('/clock/static')
  await expect(page.getByTestId('year')).toHaveText(year)
  await page.goto('/clock/dynamic')
  await expect(page.getByTestId('year')).toHaveText(year)
  await page.goto('/session/sign-in')
  await expect(page.getByText('Signed in')).toBeVisible()
})
`

const writeModule = (file: string, source: string): void => {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, source)
}

const appRoot: string = path.join(directory, 'src', 'app')
writeModule(path.join(appRoot, 'page.tsx'), HOME_PAGE)
writeModule(path.join(appRoot, 'clock', 'static', 'page.tsx'), YEAR_PAGE('force-static'))
writeModule(path.join(appRoot, 'clock', 'dynamic', 'page.tsx'), YEAR_PAGE('force-dynamic'))
writeModule(path.join(appRoot, 'session', 'sign-in', 'route.ts'), SIGN_IN_ROUTE)
writeModule(path.join(appRoot, 'session', 'account', 'page.tsx'), ACCOUNT_PAGE)
writeModule(path.join(directory, 'src', 'session.ts'), SESSION_LIBRARY)
writeModule(path.join(directory, 'tests', 'e2e', 'clock.e2e.spec.ts'), SPEC)
// This minimal Next application serves no Payload endpoint for the access-boundary sweep to ask.
rmSync(path.join(directory, 'tests', 'e2e', 'access-boundary.e2e.spec.ts'), { force: true })
// A prerendered page cannot carry the per-request nonce the seeded policy admits scripts by, so it does
// not hydrate there; the spec above reads its server-rendered year, and the sweep leaves it out.
const manifestPath: string = path.join(directory, 'package.json')
const manifest: Record<string, unknown> = asRecord(JSON.parse(readFileSync(manifestPath, 'utf8')))
const JSON_INDENT: number = 2
writeFileSync(
  manifestPath,
  `${JSON.stringify(
    {
      ...manifest,
      ploaness: {
        ...asRecord(manifest['ploaness']),
        accessibilitySkipRoutes: [
          { pattern: '/clock/static', reason: 'a prerendered page cannot carry the per-request script nonce' },
        ],
      },
    },
    null,
    JSON_INDENT,
  )}\n`,
)
