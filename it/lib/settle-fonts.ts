// The settle waits for the font of text that appears while it runs, in every pinned engine. The text
// appears after the settle's first wait for fonts has passed, as a story or a revealed panel does, and
// its face answers only after two seconds. Settled, the face must have finished: loaded, or failed for the
// font rule to report, never still unloaded or loading for the rule to report as missing.
//
// Run from the repository root after `pnpm run build`, with the pinned Playwright image present.
import { settleForScan } from '../../packages/config/dist/settle.js'
import { type Browser, type Page, type PinnedServer, startPinnedServer } from './pinned-server.ts'

type Route = Parameters<Parameters<Page['route']>[1]>[0]

// The one browser call the page function below makes; the lint project compiles without the DOM lib.
declare const document: {
  readonly fonts: Iterable<{ readonly family: string; readonly status: string }> | undefined
}

const lateFaceStatusInPage = (): string =>
  Array.from(document.fonts ?? [])
    .filter((face: { readonly family: string }): boolean => face.family.replaceAll('"', '') === 'Late')
    .map((face: { readonly status: string }): string => face.status)
    .join(',')

const ORIGIN: string = 'http://settle-fonts.test'
const FONT_DELAY_MS: number = 2000
// The animation holds the settle while the text appears a tenth of a second in, after the settle's first
// wait for fonts and before it ends.
const PAGE: string =
  '<!doctype html><html lang="en"><title>Late font</title><style>' +
  "@font-face { font-family: Late; src: url('/late.woff2') format('woff2'); } " +
  '.late { font-family: Late, sans-serif; } ' +
  'main { animation: hold 400ms linear; } @keyframes hold { to { opacity: 0.99; } }' +
  '</style><main><p>Ready</p></main><script>setTimeout(() => { const late = document.createElement("p"); ' +
  'late.className = "late"; late.append("Late text"); document.querySelector("main").append(late) }, 100)</script>'
const ENGINES: readonly string[] = ['chromium', 'firefox', 'webkit']
const FINISHED: ReadonlySet<string> = new Set<string>(['loaded', 'error'])

const server: PinnedServer = await startPinnedServer('settle-fonts')

const shortfallOf = async (engine: string): Promise<readonly string[]> => {
  const browser: Browser = await server.connect(engine)
  try {
    const page: Page = await browser.newPage()
    await page.route(`${ORIGIN}/**`, async (route: Route): Promise<void> => {
      if (route.request().url().endsWith('.woff2')) {
        await new Promise<void>((resolve): void => {
          setTimeout(resolve, FONT_DELAY_MS)
        })
        await route.fulfill({ status: 404, body: '' })
        return
      }
      await route.fulfill({ contentType: 'text/html', body: PAGE })
    })
    await page.goto(`${ORIGIN}/`)
    const outcome: string = await settleForScan(page)
    const status: string = await page.evaluate(lateFaceStatusInPage)
    return outcome === 'settled' && FINISHED.has(status) ? [] : [`${engine} settled ${outcome} with the face ${status}`]
  } finally {
    await browser.close()
  }
}

try {
  const perEngine: readonly (readonly string[])[] = await Promise.all(
    ENGINES.map(async (engine: string): Promise<readonly string[]> => await shortfallOf(engine)),
  )
  const shortfalls: readonly string[] = perEngine.flat()
  if (shortfalls.length > 0) {
    throw new Error(`The settle must wait for the font of text that appears while it runs: ${shortfalls.join('; ')}`)
  }
  console.info('every pinned engine settles with the late text font finished')
} finally {
  server.stop()
}
