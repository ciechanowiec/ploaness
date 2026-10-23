// Measure one fixed page in the pinned Playwright image, on whatever architecture this machine runs, and
// write the snapshot. Two runs on arm64 and amd64 must agree within the geometry tolerance; the
// comparison is `compare-geometry.ts`. The page is the layout an application ships most - headings,
// wrapped paragraphs, a flex row and a grid - so a difference in text shaping between the two builds
// of one image shows as moved boxes.
//
// Run from the repository root after `pnpm run build`: it measures through the built config package,
// so the snapshot is exactly what the sweep would judge.
import { execFileSync } from 'node:child_process'
import { realpathSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pinnedBrowserEndpoint, pinnedBrowserServerArguments, playwrightImageOf } from '@ploaness/governance'
import type { measurePage as MeasurePage } from '../../packages/config/src/layout.ts'

// Playwright's types, reached through the config package that declares Playwright.
type Page = Parameters<typeof MeasurePage>[0]
type Browser = NonNullable<ReturnType<ReturnType<Page['context']>['browser']>>
type BrowserType = ReturnType<Browser['browserType']>

// The one browser name the page function below reads; the lint project compiles without the DOM lib.
declare const document: { readonly fonts: { readonly ready: Promise<unknown> } }

const fontsReadyInPage = async (): Promise<void> => {
  await document.fonts.ready
}

const ARGUMENT_OFFSET: number = 2
const [output]: readonly (string | undefined)[] = process.argv.slice(ARGUMENT_OFFSET)
if (output === undefined) {
  throw new Error('Expected the snapshot file to write')
}

const PORT: number = 4173
const START_ATTEMPTS: number = 60
const RETRY_MS: number = 1000
const JSON_INDENT: number = 2
const VIEWPORT: { readonly width: number; readonly height: number } = { width: 390, height: 844 }

const PAGE: string = `<!doctype html><html lang="en"><head><title>Geometry</title><style>
body { margin: 0; font-family: sans-serif; }
main { display: flex; flex-direction: column; gap: 16px; padding: 16px; }
.row { display: flex; gap: 8px; flex-wrap: wrap; }
.row span { padding: 4px 8px; border: 1px solid #333; }
.grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
</style></head><body><main>
<h1>Fixtures and results this weekend</h1>
<p>Saturday brings three matches across two venues, and the late kick-off moves to Sunday afternoon
because the floodlights at the northern ground are being replaced before the cup tie next month.</p>
<div class="row"><span>Home</span><span>Teams</span><span>Fixtures</span>
<span>Standings</span><span>Contact</span></div>
<div class="grid"><p>Played 12</p><p>Won 8</p><p>Drawn 3</p><p>Lost 1</p><p>Goals 27</p><p>Points 27</p></div>
</main></body></html>`

// Playwright is the config package's own pinned dependency, so it is resolved from there.
const configRequire: NodeJS.Require = createRequire(path.resolve('packages/config/package.json'))
// A CommonJS package imported dynamically, so its exports arrive as the default export.
const { chromium } = (
  (await import(configRequire.resolve('@playwright/test'))) as {
    readonly default: { readonly chromium: BrowserType }
  }
).default
const coreManifest: string = createRequire(configRequire.resolve('@playwright/test/package.json')).resolve(
  'playwright-core/package.json',
)
const { version } = configRequire(coreManifest) as { readonly version: string }
const name: string = `ploaness-geometry-${String(process.pid)}`
const playwrightCore: string = realpathSync(path.dirname(coreManifest))
const serverArguments: readonly string[] = pinnedBrowserServerArguments({
  image: playwrightImageOf(version),
  name,
  port: PORT,
  playwrightCore,
  // The page is set directly, so it makes no request that a tunnel or a shared network would carry.
  isHostNetwork: false,
  secret: 'geometry',
})
execFileSync('docker', serverArguments)

const connect = async (attempt: number): Promise<Browser> => {
  try {
    return await chromium.connect(pinnedBrowserEndpoint(PORT, 'geometry'))
  } catch (error) {
    if (attempt >= START_ATTEMPTS) {
      throw error
    }
    await new Promise<void>((resolve): void => {
      setTimeout(resolve, RETRY_MS)
    })
    return await connect(attempt + 1)
  }
}

try {
  const { measurePage } = (await import(path.resolve('packages/config/dist/layout.js'))) as {
    readonly measurePage: typeof MeasurePage
  }
  const browser: Browser = await connect(1)
  const page: Page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 })
  await page.setContent(PAGE)
  await page.evaluate(fontsReadyInPage)
  writeFileSync(output, `${JSON.stringify(await measurePage(page, '/geometry'), null, JSON_INDENT)}\n`)
  await browser.close()
} finally {
  execFileSync('docker', ['rm', '--force', name])
}
