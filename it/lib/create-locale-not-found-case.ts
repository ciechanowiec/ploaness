// A locale-root layout and a redirected home must still expose their authored missing-page state.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const ARGUMENT_OFFSET: number = 2
const [directory, mode]: readonly (string | undefined)[] = process.argv.slice(ARGUMENT_OFFSET)
if (directory === undefined || !['defects', 'valid'].includes(mode ?? '')) {
  throw new Error('Expected a fixture directory and defects or valid mode')
}
const app: string = path.join(directory, 'src/app')
const localized: string = path.join(app, '[language]')
mkdirSync(path.join(localized, '[...slug]'), { recursive: true })
const layout: string = readFileSync(path.join(app, 'layout.tsx'), 'utf8')
  .replace("'./globals.css'", "'../globals.css'")
  .replace('<body>{children}</body>', '<body><main>{children}</main></body>')
writeFileSync(path.join(localized, 'layout.tsx'), layout)
rmSync(path.join(app, 'layout.tsx'))
rmSync(path.join(app, 'page.tsx'))
writeFileSync(
  path.join(localized, 'page.tsx'),
  `
export default function Page() { return <><h1>Locale home</h1><a href="/en">English</a><a href="/fr">French</a></> }
`,
)
writeFileSync(
  path.join(localized, '[...slug]/page.tsx'),
  `
import { notFound } from 'next/navigation'
export default function Page() { notFound() }
`,
)
writeFileSync(
  path.join(localized, 'not-found.tsx'),
  mode === 'defects'
    ? 'export default function Missing() { return <main><h1>Missing page</h1></main> }\n'
    : 'export default function Missing() { return <><h1>Missing page</h1><a href="/en">Home</a></> }\n',
)
const config: string = path.join(directory, 'next.config.ts')
writeFileSync(
  config,
  readFileSync(config, 'utf8').replace(
    'export default {',
    'export default { async redirects() { return [{ source: "/", destination: "/en", permanent: false }] },',
  ),
)
const specs: string = path.join(directory, 'tests/e2e')
mkdirSync(specs, { recursive: true })
writeFileSync(
  path.join(specs, 'missing.e2e.spec.ts'),
  `
import { test } from '@playwright/test'
import { expectSweptPage } from 'ploaness/a11y'
test('scans a dynamic missing member', async ({ page }) => {
  await page.goto('/en/missing')
  await expectSweptPage(page)
})
`,
)
